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
      kind?: string;
      exclude_transfers?: string;
      source?: string;
      category_ids?: string; // comma-separated for multi-select
      exclude_category_ids?: string; // comma-separated to filter OUT
      min_cents?: string; // magnitude (absolute) lower bound
      max_cents?: string; // magnitude (absolute) upper bound
      date_from?: string;
      date_to?: string;
      sort?: string; // date | amount | payee
      dir?: string; // asc | desc
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
    if (q.kind) {
      where.push("c.kind = ?");
      params.push(q.kind);
    }
    if (q.exclude_transfers === "1") {
      where.push("(c.kind IS NULL OR c.kind != 'transfer')");
    }
    if (q.source === "csv") where.push("t.import_hash IS NOT NULL");
    if (q.source === "sync") where.push("t.external_id IS NOT NULL");
    if (q.source === "manual") where.push("t.import_hash IS NULL AND t.external_id IS NULL");
    if (q.category_id) {
      where.push("t.category_id = ?");
      params.push(Number(q.category_id));
    }
    const idList = (s?: string) =>
      (s ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "")
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n));
    const inc = idList(q.category_ids);
    if (inc.length) {
      where.push(`t.category_id IN (${inc.map(() => "?").join(",")})`);
      params.push(...inc);
    }
    const exc = idList(q.exclude_category_ids);
    if (exc.length) {
      where.push(`(t.category_id IS NULL OR t.category_id NOT IN (${exc.map(() => "?").join(",")}))`);
      params.push(...exc);
    }
    if (q.account_id) {
      where.push("t.account_id = ?");
      params.push(Number(q.account_id));
    }
    if (q.uncategorized === "1") {
      where.push("t.category_id IS NULL");
    }
    if (q.min_cents && Number.isFinite(Number(q.min_cents))) {
      where.push("abs(t.amount_cents) >= ?");
      params.push(Math.round(Number(q.min_cents)));
    }
    if (q.max_cents && Number.isFinite(Number(q.max_cents))) {
      where.push("abs(t.amount_cents) <= ?");
      params.push(Math.round(Number(q.max_cents)));
    }
    if (q.date_from && /^\d{4}-\d{2}-\d{2}$/.test(q.date_from)) {
      where.push("t.date >= ?");
      params.push(q.date_from);
    }
    if (q.date_to && /^\d{4}-\d{2}-\d{2}$/.test(q.date_to)) {
      where.push("t.date <= ?");
      params.push(q.date_to);
    }
    if (q.q) {
      where.push("(lower(t.payee) LIKE ? OR lower(t.memo) LIKE ?)");
      const like = `%${q.q.toLowerCase()}%`;
      params.push(like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

    // Sort — whitelisted columns only
    const sortCol =
      q.sort === "amount" ? "t.amount_cents" : q.sort === "payee" ? "lower(t.payee)" : "t.date";
    const dir = q.dir === "asc" ? "ASC" : "DESC";
    const orderSql =
      q.sort === "amount"
        ? `ORDER BY ${sortCol} ${dir}, t.id DESC`
        : q.sort === "payee"
          ? `ORDER BY ${sortCol} ${dir}, t.date DESC`
          : `ORDER BY t.date ${dir}, t.id ${dir}`;

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM transactions t LEFT JOIN categories c ON c.id = t.category_id ${whereSql}`
        )
        .get(...params) as { n: number }
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
         ${orderSql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    return { total, rows };
  });

  /**
   * Find likely duplicate transactions. Two matching modes:
   *  - same account: same amount, dates ≤3 days apart, similar payee
   *    (catches CSV/SimpleFIN overlap and re-exports)
   *  - different accounts: same amount, same payee, dates ≤1 day apart
   *    (catches re-linked banks that came back as new accounts)
   * Groups are for human review, never auto-deleted.
   */
  app.get("/api/transactions/duplicates", async () => {
    const pairs = db
      .prepare(
        `SELECT t1.id AS id1, t2.id AS id2,
                t1.account_id AS acct1, t2.account_id AS acct2,
                t1.payee_norm AS norm1, t2.payee_norm AS norm2,
                t1.date AS date1, t2.date AS date2,
                t1.external_id AS ext1, t2.external_id AS ext2
         FROM transactions t1
         JOIN transactions t2
           ON t1.amount_cents = t2.amount_cents
          AND t1.id < t2.id
          AND abs(julianday(t1.date) - julianday(t2.date)) <= 3
          AND substr(t1.payee_norm, 1, 4) = substr(t2.payee_norm, 1, 4)
         WHERE t1.amount_cents != 0 AND t1.payee_norm != ''
         LIMIT 5000`
      )
      .all() as Array<{
      id1: number;
      id2: number;
      acct1: number;
      acct2: number;
      norm1: string;
      norm2: string;
      date1: string;
      date2: string;
      ext1: string | null;
      ext2: string | null;
    }>;

    const similar = (a: string, b: string) =>
      a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));
    const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

    const suspicious = pairs.filter((p) => {
      if (p.acct1 === p.acct2) {
        if (!similar(p.norm1, p.norm2)) return false;
        // Two settled bank transactions with distinct external ids are genuinely
        // separate (e.g. daily coffee) unless they landed on the same day twice.
        if (p.ext1 && p.ext2 && p.ext1 !== p.ext2) return p.date1 === p.date2;
        return true;
      }
      // Cross-account (e.g. a re-linked bank imported as a new account):
      // stricter — exact payee match and at most a day of posting drift.
      return p.norm1 === p.norm2 && dayDiff(p.date1, p.date2) <= 1;
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
    const b = req.body as {
      category_id?: number | null;
      memo?: string;
      payee?: string;
      date?: string;
      amount_cents?: number;
    };
    const txn = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as
      | { id: number; payee_norm: string }
      | undefined;
    if (!txn) return reply.code(404).send({ error: "Transaction not found." });

    if (typeof b.date === "string") {
      const parsed = parseDate(b.date);
      if (!parsed) return reply.code(400).send({ error: "Unrecognized date." });
      db.prepare("UPDATE transactions SET date = ? WHERE id = ?").run(parsed, id);
    }
    if (b.amount_cents !== undefined) {
      if (!Number.isFinite(b.amount_cents)) return reply.code(400).send({ error: "Invalid amount." });
      db.prepare("UPDATE transactions SET amount_cents = ? WHERE id = ?").run(Math.round(b.amount_cents), id);
    }

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

  /**
   * Move a transaction to the trash: snapshot it into deleted_txns (so it can
   * be listed and restored) and tombstone its identity (so re-syncs and
   * re-imports can't resurrect it).
   */
  const trashOne = db.transaction((id: number): boolean => {
    const txn = db
      .prepare(
        `SELECT t.*, a.name AS account_name FROM transactions t
         JOIN accounts a ON a.id = t.account_id WHERE t.id = ?`
      )
      .get(id) as
      | {
          id: number;
          account_id: number;
          external_id: string | null;
          import_hash: string | null;
          date: string;
          amount_cents: number;
          payee: string;
          memo: string;
          category_id: number | null;
          account_name: string;
        }
      | undefined;
    if (!txn) return false;
    db.prepare(
      `INSERT INTO deleted_txns (account_id, external_id, import_hash, date, amount_cents, payee, memo, category_id, account_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      txn.account_id,
      txn.external_id,
      txn.import_hash,
      txn.date,
      txn.amount_cents,
      txn.payee,
      txn.memo,
      txn.category_id,
      txn.account_name
    );
    db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    return true;
  });

  app.delete("/api/transactions/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!trashOne(id)) return reply.code(404).send({ error: "Transaction not found." });
    return { ok: true };
  });

  /** Set the same category on many transactions at once; also teaches the merchant cache. */
  app.post("/api/transactions/bulk-categorize", async (req, reply) => {
    const b = req.body as { ids?: number[]; category_id?: number | null };
    if (!Array.isArray(b?.ids) || b.ids.length === 0) {
      return reply.code(400).send({ error: "ids array is required." });
    }
    const catId = b.category_id ?? null;
    if (catId !== null) {
      const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(catId);
      if (!cat) return reply.code(400).send({ error: "Unknown category." });
    }
    const ids = b.ids.filter((id) => Number.isInteger(id));
    const setCat = db.prepare(
      catId === null
        ? "UPDATE transactions SET category_id = NULL, categorized_by = NULL WHERE id = ?"
        : "UPDATE transactions SET category_id = ?, categorized_by = 'manual' WHERE id = ?"
    );
    const getNorm = db.prepare("SELECT payee_norm FROM transactions WHERE id = ?");
    let updated = 0;
    const run = db.transaction(() => {
      for (const id of ids) {
        const changed = catId === null ? setCat.run(id).changes : setCat.run(catId, id).changes;
        if (changed && catId !== null) {
          const row = getNorm.get(id) as { payee_norm: string } | undefined;
          if (row?.payee_norm) rememberManualChoice(row.payee_norm, catId);
        }
        updated += changed;
      }
    });
    run();
    return { updated };
  });

  app.post("/api/transactions/bulk-delete", async (req, reply) => {
    const b = req.body as { ids?: number[] };
    if (!Array.isArray(b?.ids) || b.ids.length === 0) {
      return reply.code(400).send({ error: "ids array is required." });
    }
    if (b.ids.length > 2000) return reply.code(400).send({ error: "Too many at once (max 2,000)." });
    let deleted = 0;
    for (const id of b.ids) {
      if (Number.isInteger(id) && trashOne(id)) deleted++;
    }
    return { deleted };
  });

  // ----- Trash bin -----

  app.get("/api/trash", async () => {
    return db
      .prepare(
        `SELECT rowid AS id, account_id, account_name, date, amount_cents, payee, memo, deleted_at,
                external_id IS NOT NULL AS from_sync
         FROM deleted_txns
         WHERE date IS NOT NULL AND deleted_account_ref IS NULL
         ORDER BY deleted_at DESC, rowid DESC
         LIMIT 500`
      )
      .all();
  });

  app.post("/api/trash/:id/restore", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare("SELECT rowid AS id, * FROM deleted_txns WHERE rowid = ?").get(id) as
      | {
          id: number;
          account_id: number;
          external_id: string | null;
          import_hash: string | null;
          date: string | null;
          amount_cents: number | null;
          payee: string | null;
          memo: string | null;
          category_id: number | null;
        }
      | undefined;
    if (!row || row.date === null || row.amount_cents === null) {
      return reply.code(404).send({ error: "Not restorable (deleted before the trash bin existed)." });
    }
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(row.account_id);
    if (!account) return reply.code(400).send({ error: "The account this belonged to no longer exists." });
    const category = row.category_id
      ? db.prepare("SELECT id FROM categories WHERE id = ?").get(row.category_id)
      : null;
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO transactions (account_id, date, amount_cents, payee, payee_norm, memo, category_id, external_id, import_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.account_id,
        row.date,
        row.amount_cents,
        row.payee ?? "",
        normalizePayee(row.payee ?? ""),
        row.memo ?? "",
        category ? row.category_id : null,
        row.external_id,
        row.import_hash
      );
      db.prepare("DELETE FROM deleted_txns WHERE rowid = ?").run(id);
    });
    run();
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
    const tombstoned = db.prepare("SELECT 1 FROM deleted_txns WHERE account_id = ? AND import_hash = ?");
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
        if (seenInBatch.has(hash) || exists.get(b.account_id, hash) || tombstoned.get(b.account_id, hash)) {
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
