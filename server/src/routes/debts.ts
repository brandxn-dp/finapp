import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { simulatePayoff, type DebtInput } from "../services/debts.js";
import { payoffAssessment } from "../services/insights.js";

export function registerDebtRoutes(app: FastifyInstance): void {
  app.get("/api/debts", async () => {
    return db.prepare("SELECT * FROM debts ORDER BY apr DESC").all();
  });

  /** The financial picture behind the payoff planner: leftover money + realistic cuts. */
  app.get("/api/debts/plan", async () => {
    return payoffAssessment();
  });

  app.post("/api/debts", async (req, reply) => {
    const b = req.body as {
      name?: string;
      balance_cents?: number;
      apr?: number;
      min_payment_cents?: number;
    };
    if (!b?.name?.trim() || !Number.isFinite(b.balance_cents) || !Number.isFinite(b.apr) || !Number.isFinite(b.min_payment_cents)) {
      return reply.code(400).send({ error: "name, balance_cents, apr and min_payment_cents are required." });
    }
    if (b.apr! < 0 || b.apr! > 200) return reply.code(400).send({ error: "APR must be between 0 and 200." });
    const info = db
      .prepare("INSERT INTO debts (name, balance_cents, apr, min_payment_cents) VALUES (?, ?, ?, ?)")
      .run(b.name.trim(), Math.round(b.balance_cents!), b.apr, Math.round(b.min_payment_cents!));
    return db.prepare("SELECT * FROM debts WHERE id = ?").get(info.lastInsertRowid);
  });

  app.patch("/api/debts/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = req.body as {
      name?: string;
      balance_cents?: number;
      apr?: number;
      min_payment_cents?: number;
    };
    const existing = db.prepare("SELECT * FROM debts WHERE id = ?").get(id);
    if (!existing) return reply.code(404).send({ error: "Debt not found." });
    db.prepare(
      `UPDATE debts SET name = COALESCE(?, name), balance_cents = COALESCE(?, balance_cents),
        apr = COALESCE(?, apr), min_payment_cents = COALESCE(?, min_payment_cents) WHERE id = ?`
    ).run(
      b.name?.trim() ?? null,
      Number.isFinite(b.balance_cents) ? Math.round(b.balance_cents!) : null,
      Number.isFinite(b.apr) ? b.apr : null,
      Number.isFinite(b.min_payment_cents) ? Math.round(b.min_payment_cents!) : null,
      id
    );
    return db.prepare("SELECT * FROM debts WHERE id = ?").get(id);
  });

  app.delete("/api/debts/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM debts WHERE id = ?").run(id);
    if (info.changes === 0) return reply.code(404).send({ error: "Debt not found." });
    return { ok: true };
  });

  /**
   * Seed the debt planner from account data: credit/loan accounts (or any
   * account carrying a negative balance) become debts. APR and minimum payment
   * are estimates the user should correct from their statement.
   */
  app.post("/api/debts/import-accounts", async () => {
    const accounts = db
      .prepare(
        `SELECT id, name, type, balance_cents FROM accounts
         WHERE archived = 0 AND (type IN ('credit', 'loan') OR balance_cents < 0)`
      )
      .all() as Array<{ id: number; name: string; type: string; balance_cents: number }>;

    const existing = new Set(
      (db.prepare("SELECT lower(name) AS n FROM debts").all() as Array<{ n: string }>).map((r) => r.n)
    );
    const insert = db.prepare(
      "INSERT INTO debts (name, balance_cents, apr, min_payment_cents) VALUES (?, ?, ?, ?)"
    );

    const created: string[] = [];
    let skipped = 0;
    for (const a of accounts) {
      const owed = Math.abs(a.balance_cents);
      if (owed === 0) {
        skipped++;
        continue;
      }
      if (existing.has(a.name.toLowerCase())) {
        skipped++;
        continue;
      }
      // Estimated defaults, clearly surfaced in the UI for correction
      const apr = a.type === "loan" ? 7.5 : 21.99;
      const minPayment =
        a.type === "loan" ? Math.max(5000, Math.round(owed * 0.01)) : Math.max(2500, Math.round(owed * 0.02));
      insert.run(a.name, owed, apr, minPayment);
      created.push(a.name);
    }
    return { created, skipped, note: created.length > 0 ? "APR and minimum payments are estimates — edit them to match your statements." : undefined };
  });

  /** Compare snowball vs avalanche for the tracked debts with an optional extra monthly payment. */
  app.post("/api/debts/simulate", async (req, reply) => {
    const b = (req.body ?? {}) as { extra_cents?: number };
    const extra = Number.isFinite(b.extra_cents) ? Math.max(0, Math.round(b.extra_cents!)) : 0;
    const debts = db.prepare("SELECT * FROM debts").all() as DebtInput[];
    if (debts.length === 0) return reply.code(400).send({ error: "Add at least one debt first." });
    return {
      extra_cents: extra,
      snowball: simulatePayoff(debts, extra, "snowball"),
      avalanche: simulatePayoff(debts, extra, "avalanche")
    };
  });
}
