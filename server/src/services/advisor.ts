import { db } from "../db.js";
import { llmComplete, resolveLlmConfig } from "./llm.js";
import {
  monthlyCashflow,
  fiftyThirtyTwenty,
  emergencyFund,
  detectRecurring,
  spendingByCategory
} from "./insights.js";

export const DISCLAIMER =
  "Educational information about common budgeting methods — not professional financial advice.";

/**
 * Generate a written financial check-in from aggregated stats only.
 * No raw transactions or account numbers are sent — just monthly totals,
 * category aggregates, debt summaries, and recurring-payment patterns.
 */
export async function generateInsights(hid: number): Promise<{ markdown: string; disclaimer: string }> {
  if (!resolveLlmConfig().configured) {
    throw new Error("AI is not configured — add an Anthropic API key or an Ollama model in Settings.");
  }

  const cashflow = monthlyCashflow(6, hid);
  const ftt = fiftyThirtyTwenty(3, hid);
  const ef = emergencyFund(hid);
  const recurring = detectRecurring(hid).slice(0, 15);
  const nowMonth = new Date().toISOString().slice(0, 7);
  const topCategories = spendingByCategory(nowMonth, hid).slice(0, 10);
  const debts = db
    .prepare("SELECT name, balance_cents, apr, min_payment_cents FROM debts WHERE household_id = ? ORDER BY apr DESC")
    .all(hid) as Array<{ name: string; balance_cents: number; apr: number; min_payment_cents: number }>;

  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const summary = [
    "MONTHLY CASHFLOW (income vs spending):",
    ...cashflow.map((m) => `  ${m.month}: in ${fmt(m.income_cents)}, out ${fmt(m.expense_cents)}`),
    "",
    ftt
      ? `50/30/20 SPLIT (avg of last ${ftt.months_sampled} months): needs ${ftt.needs_pct}%, wants ${ftt.wants_pct}%, savings ${ftt.savings_pct}% of ${fmt(ftt.avg_income_cents)} income`
      : "50/30/20 SPLIT: not enough data",
    "",
    `EMERGENCY FUND: ${fmt(ef.liquid_savings_cents)} liquid vs ${fmt(ef.monthly_essentials_cents)}/mo essentials = ${ef.months_covered} months covered`,
    "",
    "TOP SPENDING THIS MONTH:",
    ...topCategories.map((c) => `  ${c.name}: ${fmt(c.total_cents)}`),
    "",
    "RECURRING PAYMENTS DETECTED:",
    ...recurring.map((r) => `  ${r.payee} — ${fmt(r.avg_cents)} ${r.cadence}`),
    "",
    debts.length
      ? "DEBTS:\n" +
        debts
          .map((d) => `  ${d.name}: ${fmt(d.balance_cents)} @ ${d.apr}% APR, min ${fmt(d.min_payment_cents)}/mo`)
          .join("\n")
      : "DEBTS: none tracked"
  ].join("\n");

  const markdown = await llmComplete({
    maxTokens: 1500,
    system:
      "You are the insights writer inside a self-hosted personal budgeting app. " +
      "You receive aggregated statistics about the user's finances and write a brief monthly check-in in Markdown. " +
      "Reference widely-used, general budgeting methodologies (50/30/20, debt snowball vs avalanche, emergency-fund targets, subscription audits) where they fit the numbers. " +
      "This is educational information, not professional financial advice — do not present it as personalized advice from a licensed advisor, and do not recommend specific financial products, investments, or institutions. " +
      "Structure: ## Going well, ## Worth a look, ## One method to try — at most two short bullets per section. " +
      "HARD LIMIT: 120 words total. Every bullet must contain a concrete number from the data. Warm but telegraphic; refer to the reader as 'you'. " +
      "Each time you're asked, pick a different angle than the obvious one so regenerating gives a fresh take.",
    user: summary
  });
  return { markdown, disclaimer: DISCLAIMER };
}
