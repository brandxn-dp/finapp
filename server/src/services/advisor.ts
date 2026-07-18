import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { db } from "../db.js";
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
export async function generateInsights(): Promise<{ markdown: string; disclaimer: string }> {
  if (!config.anthropicApiKey) {
    throw new Error("No Anthropic API key configured. Add ANTHROPIC_API_KEY in Settings/environment.");
  }

  const cashflow = monthlyCashflow(6);
  const ftt = fiftyThirtyTwenty(3);
  const ef = emergencyFund();
  const recurring = detectRecurring().slice(0, 15);
  const nowMonth = new Date().toISOString().slice(0, 7);
  const topCategories = spendingByCategory(nowMonth).slice(0, 10);
  const debts = db
    .prepare("SELECT name, balance_cents, apr, min_payment_cents FROM debts ORDER BY apr DESC")
    .all() as Array<{ name: string; balance_cents: number; apr: number; min_payment_cents: number }>;

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

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 4000,
    system:
      "You are the insights writer inside a self-hosted personal budgeting app. " +
      "You receive aggregated statistics about the user's finances and write a short, friendly monthly check-in in Markdown. " +
      "Explain what the numbers show and describe how widely-used, general budgeting methodologies (50/30/20, debt snowball vs avalanche, emergency-fund targets, subscription audits) would apply to numbers like these. " +
      "This is educational information, not professional financial advice — do not present it as personalized advice from a licensed advisor, and do not recommend specific financial products, investments, or institutions. " +
      "Structure: ## What's going well, ## Worth a look, ## Methods that fit your numbers. " +
      "Keep it under 400 words, concrete, and warm. Refer to the reader as 'you'.",
    messages: [{ role: "user", content: summary }]
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to generate insights for this data.");
  }
  const markdown = response.content.find((b) => b.type === "text")?.text ?? "";
  return { markdown, disclaimer: DISCLAIMER };
}
