import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { importHash, normalizePayee, parseAmountToCents, parseDate } from "../util.js";
import {
  applyMerchantCache,
  applyRules,
  rememberManualChoice
} from "../services/categorizer.js";

export function registerTransactionRoutes(app: FastifyInstance): void {
  app.get("/api/transactions", async (req) => {
    const q = req.query as {
      month?: string;
      category_id?: string;
      account_id?: string;
      q?: string;
      uncategorized?: string;
      flow?: string;
      limit?: string;
      offset?: string;
    };
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.month) {
      where.push("substr(t.date, 1, 7) = ?");
      params.push(q.month);
    }
    if (q.flow === "in") where.push("t.amount_cents > 0");
    if (q.flow === "out") where.push("t.amount_cents < 0");
    if (q.category_id) {
      where.push("t.category_id = ?");
      params.push(Number(q.category_id));
    }
    if (q.account_id) {
      where.push("t.account_id = ?");
      params.push(Number(q.account_id));
    }
    if (q.uncategorized === "1") {
      where.push("t.category_id IS NULL");
    }
    if (q.q) {
      where.push("(lower(t.payee) LIKE ? OR lower(t.memo) LIKE ?)");
      const like = `%${q.q.toLowerCase()}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

    const total = (
      db.prepare(`SELECT COUNT(*) AS n FROM transactions t ${whereSql}`).get(...params) as { n: number }
    ).n;
    const rows = db
      .prepare(
        `SELECT t.id, t.account_id, t.date, t.amount_cents, t.payee, t.memo,
                t.category_id, t.categorized_by,
                a.name AS account_name, c.name AS category_name, c.icon AS category_icon, c.grp AS category_grp
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         ${whereSql}
         ORDER BY t.date DESC, t.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    return { total, rows };
  });

  /**
   * Find likely duplicate transactions: same account, same amount, dates
   * within 3 days, similar payee. Exact-hash duplicates are already blocked at
   * import time — this catches CSV/SimpleFIN overlap and re-exports with
   * slightly different payee text. Groups are for human review, not auto-delete.
   */
  app.get("/api/transactions/duplicates", async () => {
    const pairs = db
      .prepare(
        `SELECT t1.id AS id1, t2.id AS id2,
                t1.payee_norm AS norm1, t2.payee_norm AS norm2,
                t1.date AS date1, t2.date AS date2,
                t1.external_id AS ext1, t2.external_id AS ext2
         FROM transactions t1
         JOIN transactions t2
           ON t1.account_id = t2.account_id
          AND t1.amount_cents = t2.amount_cents
          AND t1.id < t2.id
          AND abs(julianday(t1.date) - julianday(t2.date)) <= 3
         WHERE t1.amount_cents != 0
         LIMIT 2000`
      )
      .all() as Array<{
      id1: number;
      id2: number;
      norm1: string;
      norm2: string;
      date1: string;
      date2: string;
      ext1: string | null;
      ext2: string | null;
    }>;

    const similar = (a: string, b: string) =>
      a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));

    // Two settled bank transactions with distinct external ids are genuinely
    // separate (e.g. daily coffee) unless they landed on the same day twice.
    const suspicious = pairs.filter((p) => {
      if (!similar(p.norm1, p.norm2)) return false;
      if (p.ext1 && p.ext2 && p.ext1 !== p.ext2) return p.date1 === p.date2;
      return true;
    });

    // Union-find to cluster overlapping pairs into groups
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = parent.get(x) ?? x;
      if (r !== x) {
        r = find(r);
        parent.set(x, r);
      }
      return r;
    };
    const union = (a: number, b: number) => parent.set(find(a), find(b));
    for (const p of suspicious) union(p.id1, p.id2);

    const groupIds = new Map<number, number[]>();
    for (const p of suspicious) {
      for (const id of [p.id1, p.id2]) {
        const root = find(id);
        const g = groupIds.get(root) ?? [];
        if (!g.includes(id)) g.push(id);
        groupIds.set(root, g);
      }
    }

    const fetchTxn = db.prepare(
      `SELECT t.id, t.account_id, t.date, t.amount_cents, t.payee, t.memo,
              t.category_id, t.categorized_by, t.external_id, t.import_hash,
              a.name AS account_name, c.name AS category_name, c.icon AS category_icon
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`
    );
    const groups = [...groupIds.values()]
      .slice(0, 100)
      .map((ids) => ids.sort((a, b) => a - b).map((id) => fetchTxn.get(id)))
      .filter((g) => g.length >= 2);

    return { groups };
  });

  app.patch("/api/transactions/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { category_id?: number | null; memo?: string; payee?: string };
    const txn = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as
      | { id: number; payee_norm: string }
      | undefined;
    if (!txn) return reply.code(404).send({ error: "Transaction not found." });

    if (b.category_id !== undefined) {
      if (b.category_id === null) {
        db.prepare("UPDATE transactions SET category_id = NULL, categorized_by = NULL WHERE id = ?").run(id);
      } else {
        const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(b.category_id);
        if (!cat) return reply.code(400).send({ error: "Unknown category." });
        db.prepare("UPDATE transactions SET category_id = ?, categorized_by = 'manual' WHERE id = ?").run(
          b.category_id,
          id
        );
        // Teach the merchant cache so this choice sticks for future imports
        rememberManualChoice(txn.payee_norm, b.category_id);
      }
    }
    if (typeof b.memo === "string") {
      db.prepare("UPDATE transactions SET memo = ? WHERE id = ?").run(b.memo, id);
    }
    if (typeof b.payee === "string" && b.payee.trim()) {
      db.prepare("UPDATE transactions SET payee = ?, payee_norm = ? WHERE id = ?").run(
        b.payee.trim(),
        normalizePayee(b.payee),
        id
      );
    }
    return db
      .prepare(
        `SELECT t.*, c.name AS category_name, c.icon AS category_icon
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`
      )
      .get(id);
  });

  app.delete("/api/transactions/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "Transaction not found." });
    return { ok: true };
  });

  /**
   * Bulk CSV import. The client parses the CSV and maps columns; the server
   * gets raw values, validates, dedupes, and inserts.
   */
  app.post("/api/import", async (req, reply) => {
    const b = req.body as {
      account_id?: number;
      invert_amounts?: boolean;
      rows?: Array<{ date: string; amount: string | number; payee?: string; memo?: string }>;
    };
    if (!b?.account_id || !Array.isArray(b.rows)) {
      return reply.code(400).send({ error: "account_id and rows are required." });
    }
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(b.account_id);
    if (!account) return reply.code(400).send({ error: "Unknown account." });
    if (b.rows.length > 20000) {
      return reply.code(400).send({ error: "Too many rows in one import (max 20,000)." });
    }

    const exists = db.prepare("SELECT 1 FROM transactions WHERE account_id = ? AND import_hash = ?");
    const insert = db.prepare(
      `INSERT INTO transactions (account_id, date, amount_cents, payee, payee_norm, memo, import_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    let imported = 0;
    let duplicates = 0;
    let invalid = 0;
    const seenInBatch = new Set<string>();

    const run = db.transaction(() => {
      for (const row of b.rows!) {
        const date = parseDate(row.date);
        let amount = parseAmountToCents(row.amount);
        if (!date || amount === null) {
          invalid++;
          continue;
        }
        if (b.invert_amounts) amount = -amount;
        const payee = (row.payee ?? "").trim();
        const hash = importHash(b.account_id!, date, amount, payee);
        if (seenInBatch.has(hash) || exists.get(b.account_id, hash)) {
          duplicates++;
          continue;
        }
        seenInBatch.add(hash);
        insert.run(b.account_id, date, amount, payee, normalizePayee(payee), (row.memo ?? "").trim(), hash);
        imported++;
      }
    });
    run();

    const autoCategorized = imported > 0 ? applyRules() + applyMerchantCache() : 0;
    return { imported, duplicates, invalid, autoCategorized };
  });
}
