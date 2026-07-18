import type { FastifyInstance } from "fastify";
import { db, getSetting } from "../db.js";
import { config } from "../config.js";
import { applyRules } from "../services/categorizer.js";
import { isConnected, lastSync } from "../services/simplefin.js";

export function registerCoreRoutes(app: FastifyInstance): void {
  // ----- Accounts -----
  app.get("/api/accounts", async () => {
    return db
      .prepare(
        `SELECT a.*, (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS txn_count
         FROM accounts a WHERE a.archived = 0 ORDER BY a.name`
      )
      .all();
  });

  app.post("/api/accounts", async (req, reply) => {
    const b = req.body as { name?: string; type?: string; currency?: string; balance_cents?: number };
    if (!b?.name?.trim()) return reply.code(400).send({ error: "Account name is required." });
    const info = db
      .prepare("INSERT INTO accounts (name, type, currency, balance_cents) VALUES (?, ?, ?, ?)")
      .run(
        b.name.trim(),
        b.type ?? "checking",
        b.currency ?? "USD",
        Number.isFinite(b.balance_cents) ? Math.round(b.balance_cents!) : 0
      );
    return db.prepare("SELECT * FROM accounts WHERE id = ?").get(info.lastInsertRowid);
  });

  app.patch("/api/accounts/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; type?: string; balance_cents?: number; archived?: boolean };
    const existing = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
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

  app.delete("/api/accounts/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "Account not found." });
    return { ok: true };
  });

  // ----- Categories -----
  app.get("/api/categories", async () => {
    return db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS txn_count
         FROM categories c
         ORDER BY CASE c.grp WHEN 'income' THEN 0 WHEN 'essential' THEN 1 WHEN 'lifestyle' THEN 2 WHEN 'savings' THEN 3 ELSE 4 END, c.name`
      )
      .all();
  });

  app.post("/api/categories", async (req, reply) => {
    const b = req.body as { name?: string; grp?: string; kind?: string; icon?: string };
    if (!b?.name?.trim()) return reply.code(400).send({ error: "Category name is required." });
    try {
      const info = db
        .prepare("INSERT INTO categories (name, grp, kind, icon) VALUES (?, ?, ?, ?)")
        .run(b.name.trim(), b.grp ?? "other", b.kind ?? "expense", b.icon ?? "");
      return db.prepare("SELECT * FROM categories WHERE id = ?").get(info.lastInsertRowid);
    } catch {
      return reply.code(409).send({ error: "A category with that name already exists." });
    }
  });

  app.patch("/api/categories/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as { name?: string; grp?: string; kind?: string; icon?: string };
    const existing = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Category not found." });
    db.prepare(
      `UPDATE categories SET name = COALESCE(?, name), grp = COALESCE(?, grp),
        kind = COALESCE(?, kind), icon = COALESCE(?, icon) WHERE id = ?`
    ).run(b.name?.trim() ?? null, b.grp ?? null, b.kind ?? null, b.icon ?? null, id);
    return db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  });

  app.delete("/api/categories/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "Category not found." });
    return { ok: true };
  });

  // ----- Rules -----
  app.get("/api/rules", async () => {
    return db
      .prepare(
        `SELECT r.*, c.name AS category_name, c.icon AS category_icon
         FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.pattern`
      )
      .all();
  });

  app.post("/api/rules", async (req, reply) => {
    const b = req.body as { pattern?: string; category_id?: number };
    if (!b?.pattern?.trim() || !b.category_id) {
      return reply.code(400).send({ error: "pattern and category_id are required." });
    }
    const info = db
      .prepare("INSERT INTO rules (pattern, category_id) VALUES (?, ?)")
      .run(b.pattern.trim().toLowerCase(), b.category_id);
    const applied = applyRules();
    return { id: info.lastInsertRowid, applied };
  });

  app.delete("/api/rules/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM rules WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "Rule not found." });
    return { ok: true };
  });

  // ----- Budgets -----
  app.get("/api/budgets", async () => {
    return db
      .prepare(
        `SELECT b.category_id, b.monthly_cents, c.name, c.grp, c.icon
         FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY b.monthly_cents DESC`
      )
      .all();
  });

  app.put("/api/budgets", async (req, reply) => {
    const b = req.body as { items?: Array<{ category_id: number; monthly_cents: number }> };
    if (!Array.isArray(b?.items)) return reply.code(400).send({ error: "items array is required." });
    const upsert = db.prepare(
      `INSERT INTO budgets (category_id, monthly_cents) VALUES (?, ?)
       ON CONFLICT(category_id) DO UPDATE SET monthly_cents = excluded.monthly_cents`
    );
    const remove = db.prepare("DELETE FROM budgets WHERE category_id = ?");
    const run = db.transaction(() => {
      for (const item of b.items!) {
        if (!Number.isFinite(item.category_id)) continue;
        if (item.monthly_cents > 0) upsert.run(item.category_id, Math.round(item.monthly_cents));
        else remove.run(item.category_id);
      }
    });
    run();
    return { ok: true };
  });

  // ----- App status / settings -----
  app.get("/api/settings", async () => {
    return {
      ai_configured: Boolean(config.anthropicApiKey),
      model: config.claudeModel,
      simplefin_connected: isConnected(),
      simplefin_last_sync: lastSync(),
      currency: getSetting("currency") ?? "USD"
    };
  });
}
