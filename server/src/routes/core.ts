import type { FastifyInstance } from "fastify";
import {
  db,
  getSetting,
  setSetting,
  deleteSetting,
  getHouseholdSetting,
  setHouseholdSetting,
  resetHousehold
} from "../db.js";
import { applyRules } from "../services/categorizer.js";
import { isConnected, lastSync } from "../services/simplefin.js";
import { resolveLlmConfig } from "../services/llm.js";
import { inferAccountType, normalizePayee } from "../util.js";

export function registerCoreRoutes(app: FastifyInstance): void {
  // ----- Accounts -----
  app.get("/api/accounts", async (req) => {
    const hid = req.householdId!;
    return db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS txn_count
         FROM accounts a WHERE a.archived = 0 AND a.household_id = ${hid} ORDER BY a.name`
      )
      .all();
  });

  app.post("/api/accounts", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { name?: string; type?: string; currency?: string; balance_cents?: number };
    if (!b?.name?.trim()) return reply.code(400).send({ error: "Account name is required." });
    const info = db
      .prepare("INSERT INTO accounts (name, type, currency, balance_cents, household_id) VALUES (?, ?, ?, ?, ?)")
      .run(
        b.name.trim(),
        b.type ?? "checking",
        b.currency ?? "USD",
        Number.isFinite(b.balance_cents) ? Math.round(b.balance_cents!) : 0,
        hid
      );
    return db.prepare("SELECT * FROM accounts WHERE id = ?").get(info.lastInsertRowid);
  });

  app.patch("/api/accounts/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; type?: string; balance_cents?: number; archived?: boolean };
    const existing = db.prepare("SELECT * FROM accounts WHERE id = ? AND household_id = ?").get(id, hid);
    if (!existing) return reply.code(404).send({ error: "Account not found." });
    db.prepare(
      `UPDATE accounts SET
         name = COALESCE(?, name), type = COALESCE(?, type),
         balance_cents = COALESCE(?, balance_cents), archived = COALESCE(?, archived)
       WHERE id = ?`
    ).run(
      b.name?.trim() ?? null,
      b.type ?? null,
      Number.isFinite(b.balance_cents) ? Math.round(b.balance_cents!) : null,
      typeof b.archived === "boolean" ? Number(b.archived) : null,
      id
    );
    return db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
  });

  /** Re-infer every account's type from its name (user-triggered, idempotent). */
  app.post("/api/accounts/auto-type", async (req) => {
    const hid = req.householdId!;
    const accounts = db
      .prepare("SELECT id, name, type FROM accounts WHERE archived = 0 AND household_id = ?")
      .all(hid) as Array<{
      id: number;
      name: string;
      type: string;
    }>;
    const update = db.prepare("UPDATE accounts SET type = ? WHERE id = ?");
    const changes: Array<{ id: number; name: string; from: string; to: string }> = [];
    for (const a of accounts) {
      const inferred = inferAccountType(a.name);
      if (inferred !== a.type) {
        update.run(inferred, a.id);
        changes.push({ id: a.id, name: a.name, from: a.type, to: inferred });
      }
    }
    return { changed: changes.length, changes };
  });

  /**
   * Move an account to the trash: snapshot the account and every one of its
   * transactions (tagged with the deleted-account ref) so the whole thing can
   * be restored later, then delete it. Returns false if the account is gone.
   */
  const trashAccount = db.transaction((id: number, hid: number): boolean => {
    const account = db.prepare("SELECT * FROM accounts WHERE id = ? AND household_id = ?").get(id, hid) as
      | {
          id: number;
          name: string;
          type: string;
          currency: string;
          balance_cents: number;
          simplefin_id: string | null;
        }
      | undefined;
    if (!account) return false;

    const txns = db
      .prepare("SELECT * FROM transactions WHERE account_id = ?")
      .all(id) as Array<{
      account_id: number;
      external_id: string | null;
      import_hash: string | null;
      date: string;
      amount_cents: number;
      payee: string;
      memo: string;
      category_id: number | null;
    }>;

    const ref = db
      .prepare(
        `INSERT INTO deleted_accounts (orig_id, name, type, currency, balance_cents, simplefin_id, txn_count, household_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, account.name, account.type, account.currency, account.balance_cents, account.simplefin_id, txns.length, hid)
      .lastInsertRowid as number;

    const snap = db.prepare(
      `INSERT INTO deleted_txns (account_id, external_id, import_hash, date, amount_cents, payee, memo, category_id, account_name, deleted_account_ref, household_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const t of txns) {
      snap.run(
        t.account_id,
        t.external_id,
        t.import_hash,
        t.date,
        t.amount_cents,
        t.payee,
        t.memo,
        t.category_id,
        account.name,
        ref,
        hid
      );
    }

    // Cascade removes the transactions; we've already snapshotted them
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    return true;
  });

  app.delete("/api/accounts/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!trashAccount(id, req.householdId!)) return reply.code(404).send({ error: "Account not found." });
    return { ok: true };
  });

  /**
   * Merge one account into another: move its transactions to the target, fold in
   * its balance, then trash the now-empty source (restorable). Transactions that
   * would collide on (account_id, external_id) are left behind and go to the
   * trash with the source — they're already present in the target.
   */
  app.post("/api/accounts/:id/merge", async (req, reply) => {
    const hid = req.householdId!;
    const sourceId = Number((req.params as { id: string }).id);
    const into = Number((req.body as { into?: number })?.into);
    if (!Number.isInteger(into)) return reply.code(400).send({ error: "Target account (into) is required." });
    if (into === sourceId) return reply.code(400).send({ error: "Can't merge an account into itself." });
    const source = db.prepare("SELECT * FROM accounts WHERE id = ? AND household_id = ?").get(sourceId, hid) as
      | { id: number; balance_cents: number }
      | undefined;
    const target = db.prepare("SELECT id FROM accounts WHERE id = ? AND household_id = ?").get(into, hid);
    if (!source || !target) return reply.code(404).send({ error: "Account not found." });

    const run = db.transaction(() => {
      const moved = db
        .prepare("UPDATE OR IGNORE transactions SET account_id = ? WHERE account_id = ?")
        .run(into, sourceId).changes;
      db.prepare("UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?").run(
        source.balance_cents,
        into
      );
      trashAccount(sourceId, hid); // snapshots any leftover colliding txns, then removes the source
      return moved;
    });
    const moved = run();
    return { ok: true, moved };
  });

  app.post("/api/accounts/bulk-delete", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { ids?: number[] };
    if (!Array.isArray(b?.ids) || b.ids.length === 0) {
      return reply.code(400).send({ error: "ids array is required." });
    }
    let deleted = 0;
    for (const id of b.ids) if (Number.isInteger(id) && trashAccount(id, hid)) deleted++;
    return { deleted };
  });

  // ----- Account trash -----

  app.get("/api/trash/accounts", async (req) => {
    return db
      .prepare(
        `SELECT id, name, type, balance_cents, txn_count, deleted_at FROM deleted_accounts
         WHERE household_id = ? ORDER BY deleted_at DESC, id DESC LIMIT 200`
      )
      .all(req.householdId!);
  });

  /** Recreate a deleted account and re-insert its snapshotted transactions. */
  app.post("/api/trash/accounts/:id/restore", async (req, reply) => {
    const hid = req.householdId!;
    const refId = Number((req.params as { id: string }).id);
    const acct = db.prepare("SELECT * FROM deleted_accounts WHERE id = ? AND household_id = ?").get(refId, hid) as
      | {
          id: number;
          name: string;
          type: string | null;
          currency: string | null;
          balance_cents: number | null;
          simplefin_id: string | null;
        }
      | undefined;
    if (!acct) return reply.code(404).send({ error: "Deleted account not found." });

    const run = db.transaction(() => {
      // If the bank was already re-synced into a new account with the same
      // SimpleFIN id, restore the transactions into that one; else recreate it.
      let targetId: number;
      const existing = acct.simplefin_id
        ? (db.prepare("SELECT id FROM accounts WHERE simplefin_id = ? AND household_id = ?").get(acct.simplefin_id, hid) as
            | { id: number }
            | undefined)
        : undefined;
      if (existing) {
        targetId = existing.id;
      } else {
        targetId = db
          .prepare(
            "INSERT INTO accounts (name, type, currency, balance_cents, simplefin_id, household_id) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(
            acct.name,
            acct.type ?? "checking",
            acct.currency ?? "USD",
            acct.balance_cents ?? 0,
            acct.simplefin_id,
            hid
          ).lastInsertRowid as number;
      }

      const snaps = db.prepare("SELECT * FROM deleted_txns WHERE deleted_account_ref = ?").all(refId) as Array<{
        rowid?: number;
        external_id: string | null;
        import_hash: string | null;
        date: string | null;
        amount_cents: number | null;
        payee: string | null;
        memo: string | null;
        category_id: number | null;
      }>;
      const insert = db.prepare(
        `INSERT INTO transactions (account_id, date, amount_cents, payee, payee_norm, memo, category_id, external_id, import_hash, household_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM transactions x WHERE x.account_id = ? AND x.external_id IS NOT NULL AND x.external_id = ?)`
      );
      let restored = 0;
      for (const s of snaps) {
        if (s.date === null || s.amount_cents === null) continue;
        const cat = s.category_id
          ? db.prepare("SELECT id FROM categories WHERE id = ? AND household_id = ?").get(s.category_id, hid)
          : null;
        restored += insert.run(
          targetId,
          s.date,
          s.amount_cents,
          s.payee ?? "",
          normalizePayee(s.payee ?? ""),
          s.memo ?? "",
          cat ? s.category_id : null,
          s.external_id,
          s.import_hash,
          hid,
          targetId,
          s.external_id
        ).changes;
      }
      db.prepare("DELETE FROM deleted_txns WHERE deleted_account_ref = ?").run(refId);
      db.prepare("DELETE FROM deleted_accounts WHERE id = ?").run(refId);
      return restored;
    });
    return { ok: true, restored: run() };
  });

  /** Danger zone: wipe THIS household's data and re-seed its default categories. */
  app.post("/api/factory-reset", async (req, reply) => {
    const b = req.body as { confirm?: string };
    if (b?.confirm !== "DELETE EVERYTHING") {
      return reply.code(400).send({ error: "Missing confirmation token." });
    }
    resetHousehold(req.householdId!);
    return { ok: true };
  });

  // ----- Categories -----
  app.get("/api/categories", async (req) => {
    const hid = req.householdId!;
    return db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS txn_count
         FROM categories c
         WHERE c.household_id = ${hid}
         ORDER BY CASE c.grp WHEN 'income' THEN 0 WHEN 'essential' THEN 1 WHEN 'lifestyle' THEN 2 WHEN 'savings' THEN 3 ELSE 4 END, c.name`
      )
      .all();
  });

  app.post("/api/categories", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { name?: string; grp?: string; kind?: string; icon?: string };
    if (!b?.name?.trim()) return reply.code(400).send({ error: "Category name is required." });
    try {
      const info = db
        .prepare("INSERT INTO categories (household_id, name, grp, kind, icon) VALUES (?, ?, ?, ?, ?)")
        .run(hid, b.name.trim(), b.grp ?? "other", b.kind ?? "expense", b.icon ?? "");
      return db.prepare("SELECT * FROM categories WHERE id = ?").get(info.lastInsertRowid);
    } catch {
      return reply.code(409).send({ error: "A category with that name already exists." });
    }
  });

  app.patch("/api/categories/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; grp?: string; kind?: string; icon?: string };
    const existing = db.prepare("SELECT * FROM categories WHERE id = ? AND household_id = ?").get(id, hid);
    if (!existing) return reply.code(404).send({ error: "Category not found." });
    db.prepare(
      `UPDATE categories SET name = COALESCE(?, name), grp = COALESCE(?, grp),
        kind = COALESCE(?, kind), icon = COALESCE(?, icon) WHERE id = ?`
    ).run(b.name?.trim() ?? null, b.grp ?? null, b.kind ?? null, b.icon ?? null, id);
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  });

  app.delete("/api/categories/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM categories WHERE id = ? AND household_id = ?").run(id, hid);
    if (info.changes === 0) return reply.code(404).send({ error: "Category not found." });
    return { ok: true };
  });

  // ----- Rules -----
  app.get("/api/rules", async (req) => {
    return db
      .prepare(
        `SELECT r.*, c.name AS category_name, c.icon AS category_icon
         FROM rules r JOIN categories c ON c.id = r.category_id WHERE r.household_id = ? ORDER BY r.pattern`
      )
      .all(req.householdId!);
  });

  app.post("/api/rules", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { pattern?: string; category_id?: number };
    if (!b?.pattern?.trim() || !b.category_id) {
      return reply.code(400).send({ error: "pattern and category_id are required." });
    }
    // Category must belong to this household.
    if (!db.prepare("SELECT 1 FROM categories WHERE id = ? AND household_id = ?").get(b.category_id, hid)) {
      return reply.code(400).send({ error: "Unknown category." });
    }
    const info = db
      .prepare("INSERT INTO rules (pattern, category_id, household_id) VALUES (?, ?, ?)")
      .run(b.pattern.trim().toLowerCase(), b.category_id, hid);
    const applied = applyRules(false, hid);
    return { id: info.lastInsertRowid, applied };
  });

  app.delete("/api/rules/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM rules WHERE id = ? AND household_id = ?").run(id, hid);
    if (info.changes === 0) return reply.code(404).send({ error: "Rule not found." });
    return { ok: true };
  });

  // ----- Budgets -----

  /** True if a category belongs to the given household. */
  const ownsCategory = (categoryId: number, hid: number): boolean =>
    Boolean(db.prepare("SELECT 1 FROM categories WHERE id = ? AND household_id = ?").get(categoryId, hid));

  /** Number of line items a category has (0 = plain flat budget). */
  const itemCount = (categoryId: number): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM budget_items WHERE category_id = ?").get(categoryId) as {
      n: number;
    }).n;

  /**
   * If a category has line items, its budget total is the sum of them — keep the
   * budgets row in sync so every consumer (insights, debt planner) sees the total.
   */
  const syncBudgetTotal = (categoryId: number, hid: number): void => {
    if (itemCount(categoryId) === 0) return;
    const sum = (db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM budget_items WHERE category_id = ?")
      .get(categoryId) as { s: number }).s;
    db.prepare(
      `INSERT INTO budgets (category_id, monthly_cents, household_id) VALUES (?, ?, ?)
       ON CONFLICT(category_id) DO UPDATE SET monthly_cents = excluded.monthly_cents`
    ).run(categoryId, sum, hid);
  };

  app.get("/api/budgets", async (req) => {
    const hid = req.householdId!;
    const rows = db
      .prepare(
        `SELECT b.category_id, b.monthly_cents, c.name, c.grp, c.icon
         FROM budgets b JOIN categories c ON c.id = b.category_id
         WHERE c.household_id = ? ORDER BY b.monthly_cents DESC`
      )
      .all(hid) as Array<{ category_id: number; monthly_cents: number; name: string; grp: string; icon: string }>;
    const items = db
      .prepare(
        `SELECT bi.id, bi.category_id, bi.name, bi.amount_cents FROM budget_items bi
         JOIN categories c ON c.id = bi.category_id WHERE c.household_id = ? ORDER BY bi.sort, bi.id`
      )
      .all(hid) as Array<{ id: number; category_id: number; name: string; amount_cents: number }>;
    const byCat = new Map<number, Array<{ id: number; name: string; amount_cents: number }>>();
    for (const it of items) {
      if (!byCat.has(it.category_id)) byCat.set(it.category_id, []);
      byCat.get(it.category_id)!.push({ id: it.id, name: it.name, amount_cents: it.amount_cents });
    }
    return rows.map((r) => ({ ...r, items: byCat.get(r.category_id) ?? [] }));
  });

  // A budget of $0 is a real, meaningful budget ("spend nothing here") — it is
  // stored, not treated as "no budget". Removing a budget entirely is a separate
  // DELETE below. Categories with line items have their total driven by the items,
  // so a flat set is ignored for those (the items win).
  app.put("/api/budgets", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { items?: Array<{ category_id: number; monthly_cents: number }> };
    if (!Array.isArray(b?.items)) return reply.code(400).send({ error: "items array is required." });
    const upsert = db.prepare(
      `INSERT INTO budgets (category_id, monthly_cents, household_id) VALUES (?, ?, ?)
       ON CONFLICT(category_id) DO UPDATE SET monthly_cents = excluded.monthly_cents`
    );
    const run = db.transaction(() => {
      for (const item of b.items!) {
        if (!Number.isFinite(item.category_id) || !Number.isFinite(item.monthly_cents)) continue;
        if (!ownsCategory(item.category_id, hid)) continue; // not this household's category
        if (itemCount(item.category_id) > 0) continue; // line items are the source of truth
        upsert.run(item.category_id, Math.max(0, Math.round(item.monthly_cents)), hid);
      }
    });
    run();
    return { ok: true };
  });

  app.delete("/api/budgets/:categoryId", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { categoryId: string }).categoryId);
    if (!ownsCategory(id, hid)) return reply.code(404).send({ error: "No budget for that category." });
    const run = db.transaction(() => {
      db.prepare("DELETE FROM budget_items WHERE category_id = ?").run(id);
      return db.prepare("DELETE FROM budgets WHERE category_id = ?").run(id);
    });
    const info = run();
    if (info.changes === 0) return reply.code(404).send({ error: "No budget for that category." });
    return { ok: true };
  });

  // ----- Budget line items (folders under a category) -----
  app.post("/api/budgets/items", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { category_id?: number; name?: string; amount_cents?: number };
    const catId = Number(b?.category_id);
    if (!Number.isInteger(catId)) return reply.code(400).send({ error: "category_id is required." });
    if (!ownsCategory(catId, hid)) return reply.code(404).send({ error: "No such category." });
    const cents = Math.max(0, Math.round(Number(b?.amount_cents ?? 0)));
    const nextSort =
      (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM budget_items WHERE category_id = ?").get(catId) as {
        s: number;
      }).s;
    const run = db.transaction(() => {
      const info = db
        .prepare("INSERT INTO budget_items (category_id, name, amount_cents, sort, household_id) VALUES (?, ?, ?, ?, ?)")
        .run(catId, (b?.name ?? "").trim(), Number.isFinite(cents) ? cents : 0, nextSort, hid);
      // Ensure a budgets row exists so the category shows up, then sync the total.
      db.prepare(
        "INSERT INTO budgets (category_id, monthly_cents, household_id) VALUES (?, 0, ?) ON CONFLICT(category_id) DO NOTHING"
      ).run(catId, hid);
      syncBudgetTotal(catId, hid);
      return info;
    });
    const info = run();
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.patch("/api/budgets/items/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare("SELECT category_id FROM budget_items WHERE id = ?").get(id) as
      | { category_id: number }
      | undefined;
    if (!row || !ownsCategory(row.category_id, hid)) return reply.code(404).send({ error: "No such budget item." });
    const b = req.body as { name?: string; amount_cents?: number };
    const run = db.transaction(() => {
      if (typeof b?.name === "string") {
        db.prepare("UPDATE budget_items SET name = ? WHERE id = ?").run(b.name.trim(), id);
      }
      if (b?.amount_cents !== undefined && Number.isFinite(Number(b.amount_cents))) {
        db.prepare("UPDATE budget_items SET amount_cents = ? WHERE id = ?").run(
          Math.max(0, Math.round(Number(b.amount_cents))),
          id
        );
      }
      syncBudgetTotal(row.category_id, hid);
    });
    run();
    return { ok: true };
  });

  app.delete("/api/budgets/items/:id", async (req, reply) => {
    const hid = req.householdId!;
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare("SELECT category_id FROM budget_items WHERE id = ?").get(id) as
      | { category_id: number }
      | undefined;
    if (!row || !ownsCategory(row.category_id, hid)) return reply.code(404).send({ error: "No such budget item." });
    const run = db.transaction(() => {
      db.prepare("DELETE FROM budget_items WHERE id = ?").run(id);
      syncBudgetTotal(row.category_id, hid); // no-op once the last item is gone; total stays as last sum
    });
    run();
    return { ok: true };
  });

  // ----- App status / settings -----
  // AI/provider settings are server-global; include_credit is per-household.
  const settingsPayload = (hid: number) => {
    const llm = resolveLlmConfig();
    return {
      ai_provider: llm.provider,
      ai_configured: llm.configured,
      model: llm.model,
      anthropic_model: llm.anthropicModel,
      anthropic_key_set: Boolean(llm.apiKey),
      anthropic_key_source: llm.keySource,
      ollama_url: llm.ollamaUrl,
      ollama_model: llm.ollamaModel,
      simplefin_connected: isConnected(hid),
      simplefin_last_sync: lastSync(hid),
      currency: getSetting("currency") ?? "USD",
      include_credit: getHouseholdSetting(hid, "include_credit") === "1"
    };
  };

  app.get("/api/settings", async (req) => settingsPayload(req.householdId!));

  app.put("/api/settings", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as {
      ai_provider?: string;
      anthropic_api_key?: string;
      ai_model?: string;
      ollama_url?: string;
      ollama_model?: string;
      include_credit?: boolean;
    };
    if (b.include_credit !== undefined) {
      setHouseholdSetting(hid, "include_credit", b.include_credit ? "1" : "0");
    }
    if (b.ai_provider !== undefined) {
      if (b.ai_provider !== "anthropic" && b.ai_provider !== "ollama") {
        return reply.code(400).send({ error: "ai_provider must be 'anthropic' or 'ollama'." });
      }
      setSetting("ai_provider", b.ai_provider);
    }
    if (b.anthropic_api_key !== undefined) {
      const key = b.anthropic_api_key.trim();
      if (key === "") deleteSetting("anthropic_api_key");
      else setSetting("anthropic_api_key", key);
    }
    if (b.ai_model !== undefined) {
      const m = b.ai_model.trim();
      if (m === "") deleteSetting("ai_model");
      else setSetting("ai_model", m);
    }
    if (b.ollama_url !== undefined) {
      const u = b.ollama_url.trim();
      if (u === "") deleteSetting("ollama_url");
      else setSetting("ollama_url", u);
    }
    if (b.ollama_model !== undefined) {
      const m = b.ollama_model.trim();
      if (m === "") deleteSetting("ollama_model");
      else setSetting("ollama_model", m);
    }
    return settingsPayload(hid);
  });
}
