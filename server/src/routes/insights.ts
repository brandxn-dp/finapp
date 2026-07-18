import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import {
  monthlyCashflow,
  spendingByCategory,
  detectRecurring,
  suggestBudgets,
  fiftyThirtyTwenty,
  emergencyFund
} from "../services/insights.js";
import { applyRules, runCategorization } from "../services/categorizer.js";
import { generateInsights, DISCLAIMER } from "../services/advisor.js";

export function registerInsightRoutes(app: FastifyInstance): void {
  app.get("/api/insights/overview", async (req) => {
    const q = req.query as { months?: string };
    const months = Math.min(Number(q.months ?? 6) || 6, 24);
    const nowMonth = new Date().toISOString().slice(0, 7);

    const netWorth = db
      .prepare("SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts WHERE archived = 0")
      .get() as { total: number };
    const txnStats = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN category_id IS NULL THEN 1 ELSE 0 END) AS uncategorized
         FROM transactions`
      )
      .get() as { total: number; uncategorized: number };

    return {
      month: nowMonth,
      net_worth_cents: netWorth.total,
      transactions: txnStats.total,
      uncategorized: txnStats.uncategorized ?? 0,
      cashflow: monthlyCashflow(months),
      spending: spendingByCategory(nowMonth),
      fifty_thirty_twenty: fiftyThirtyTwenty(3),
      emergency_fund: emergencyFund()
    };
  });

  app.get("/api/insights/spending", async (req) => {
    const q = req.query as { month?: string };
    const month = /^\d{4}-\d{2}$/.test(q.month ?? "")
      ? q.month!
      : new Date().toISOString().slice(0, 7);
    return { month, spending: spendingByCategory(month) };
  });

  app.get("/api/insights/recurring", async () => {
    const items = detectRecurring();
    const monthlyTotal = items.reduce((sum, r) => {
      const perMonth =
        r.cadence === "weekly" ? r.avg_cents * 4.33 :
        r.cadence === "biweekly" ? r.avg_cents * 2.17 :
        r.cadence === "monthly" ? r.avg_cents :
        r.cadence === "quarterly" ? r.avg_cents / 3 :
        r.avg_cents / 12;
      return sum + perMonth;
    }, 0);
    return { items, monthly_total_cents: Math.round(monthlyTotal) };
  });

  app.get("/api/insights/budget-suggestions", async () => {
    return { suggestions: suggestBudgets() };
  });

  /** AI-written monthly check-in (aggregates only — no raw transactions leave the box). */
  app.post("/api/insights/advise", async (_req, reply) => {
    try {
      return await generateInsights();
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
        disclaimer: DISCLAIMER
      });
    }
  });

  /** Run the categorization pipeline: rules → merchant cache → Claude for new merchants. */
  app.post("/api/categorize/run", async (req) => {
    const b = (req.body ?? {}) as { use_ai?: boolean };
    return runCategorization(b.use_ai !== false);
  });

  /** Re-apply rules; force=true overrides existing categories (rules always win). */
  app.post("/api/categorize/apply-rules", async (req) => {
    const b = (req.body ?? {}) as { force?: boolean };
    const applied = applyRules(b.force === true);
    return { applied, force: b.force === true };
  });
}
