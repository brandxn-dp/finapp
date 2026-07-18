import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { simulatePayoff, type DebtInput } from "../services/debts.js";

export function registerDebtRoutes(app: FastifyInstance): void {
  app.get("/api/debts", async () => {
    return db.prepare("SELECT * FROM debts ORDER BY apr DESC").all();
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
