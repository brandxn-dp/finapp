import { db } from "../db.js";
import { median } from "../util.js";

/** Months as YYYY-MM, newest first, excluding the current (partial) month when asked. */
function recentMonths(n: number, includeCurrent: boolean): string[] {
  const months: string[] = [];
  const d = new Date();
  if (!includeCurrent) d.setMonth(d.getMonth() - 1);
  for (let i = 0; i < n; i++) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months;
}

export interface MonthlyCashflow {
  month: string;
  income_cents: number;
  expense_cents: number; // positive number (money out)
}

/** Income vs spending per month (transfers excluded). */
export function monthlyCashflow(months: number): MonthlyCashflow[] {
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
              SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS income_cents,
              SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS expense_cents
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE (c.kind IS NULL OR c.kind != 'transfer')
       GROUP BY month ORDER BY month DESC LIMIT ?`
    )
    .all(months) as MonthlyCashflow[];
  return rows.reverse();
}

export interface CategorySpend {
  category_id: number | null;
  name: string;
  grp: string;
  icon: string;
  total_cents: number; // positive = spent
}

/** Spending by category for one month (YYYY-MM). */
export function spendingByCategory(month: string): CategorySpend[] {
  return db
    .prepare(
      `SELECT t.category_id, COALESCE(c.name, 'Uncategorized') AS name,
              COALESCE(c.grp, 'other') AS grp, COALESCE(c.icon, '❔') AS icon,
              SUM(-t.amount_cents) AS total_cents
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0
         AND substr(t.date, 1, 7) = ?
         AND (c.kind IS NULL OR c.kind != 'transfer')
       GROUP BY t.category_id
       HAVING total_cents > 0
       ORDER BY total_cents DESC`
    )
    .all(month) as CategorySpend[];
}

export interface RecurringItem {
  payee_norm: string;
  payee: string;
  category: string | null;
  icon: string | null;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  avg_cents: number; // positive = money out
  last_date: string;
  next_date: string;
  occurrences: number;
}

const CADENCES: Array<{ name: RecurringItem["cadence"]; min: number; max: number; days: number }> = [
  { name: "weekly", min: 5.5, max: 8.5, days: 7 },
  { name: "biweekly", min: 12, max: 16.5, days: 14 },
  { name: "monthly", min: 26, max: 35, days: 30 },
  { name: "quarterly", min: 80, max: 100, days: 91 },
  { name: "yearly", min: 350, max: 380, days: 365 }
];

/** Detect recurring outflows (subscriptions, rent, insurance…) from payment patterns. */
export function detectRecurring(): RecurringItem[] {
  const rows = db
    .prepare(
      `SELECT t.payee_norm, t.payee, t.date, t.amount_cents, c.name AS category, c.icon
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND t.payee_norm != ''
         AND t.date >= date('now', '-15 months')
         AND (c.kind IS NULL OR c.kind != 'transfer')
       ORDER BY t.payee_norm, t.date`
    )
    .all() as Array<{
    payee_norm: string;
    payee: string;
    date: string;
    amount_cents: number;
    category: string | null;
    icon: string | null;
  }>;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = groups.get(r.payee_norm);
    if (g) g.push(r);
    else groups.set(r.payee_norm, [r]);
  }

  const out: RecurringItem[] = [];
  for (const [key, txns] of groups) {
    if (txns.length < 3) continue;
    const intervals: number[] = [];
    for (let i = 1; i < txns.length; i++) {
      const days =
        (Date.parse(txns[i].date) - Date.parse(txns[i - 1].date)) / 86400000;
      if (days > 0.5) intervals.push(days);
    }
    if (intervals.length < 2) continue;
    const med = median(intervals);
    const cadence = CADENCES.find((c) => med >= c.min && med <= c.max);
    if (!cadence) continue;

    // Interval regularity: most gaps close to the median
    const regular = intervals.filter((d) => Math.abs(d - med) <= Math.max(4, med * 0.2)).length;
    if (regular / intervals.length < 0.6) continue;

    // Amount consistency: coefficient of variation under 30% (utilities vary a bit)
    const amounts = txns.map((t) => -t.amount_cents);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    if (mean <= 0 || Math.sqrt(variance) / mean > 0.3) continue;

    const lastTxn = txns[txns.length - 1];
    const next = new Date(Date.parse(lastTxn.date) + cadence.days * 86400000);
    out.push({
      payee_norm: key,
      payee: lastTxn.payee,
      category: lastTxn.category,
      icon: lastTxn.icon,
      cadence: cadence.name,
      avg_cents: Math.round(mean),
      last_date: lastTxn.date,
      next_date: next.toISOString().slice(0, 10),
      occurrences: txns.length
    });
  }
  return out.sort((a, b) => b.avg_cents - a.avg_cents);
}

export interface BudgetSuggestion {
  category_id: number;
  name: string;
  grp: string;
  icon: string;
  months_with_data: number;
  median_cents: number;
  avg_cents: number;
  suggested_cents: number;
  current_budget_cents: number | null;
}

/** Suggest a monthly budget per category from the last 6 full months of history. */
export function suggestBudgets(): BudgetSuggestion[] {
  const months = recentMonths(6, false);
  const rows = db
    .prepare(
      `SELECT t.category_id, c.name, c.grp, c.icon, substr(t.date, 1, 7) AS month,
              SUM(-t.amount_cents) AS total_cents
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.kind = 'expense'
         AND substr(t.date, 1, 7) IN (${months.map(() => "?").join(",")})
       GROUP BY t.category_id, month`
    )
    .all(...months) as Array<{
    category_id: number;
    name: string;
    grp: string;
    icon: string;
    month: string;
    total_cents: number;
  }>;

  const budgets = new Map(
    (db.prepare("SELECT category_id, monthly_cents FROM budgets").all() as Array<{
      category_id: number;
      monthly_cents: number;
    }>).map((b) => [b.category_id, b.monthly_cents])
  );

  const byCat = new Map<number, { name: string; grp: string; icon: string; totals: number[] }>();
  for (const r of rows) {
    const e = byCat.get(r.category_id) ?? { name: r.name, grp: r.grp, icon: r.icon, totals: [] };
    e.totals.push(r.total_cents);
    byCat.set(r.category_id, e);
  }

  const out: BudgetSuggestion[] = [];
  for (const [id, e] of byCat) {
    // Categories that only appear once aren't budgetable patterns yet
    if (e.totals.length < 2) continue;
    // Treat months with no spending in this category as zeros for the median
    const padded = [...e.totals];
    while (padded.length < months.length) padded.push(0);
    const med = median(padded);
    const avg = Math.round(e.totals.reduce((a, b) => a + b, 0) / months.length);
    const suggestedRaw = Math.max(med, Math.round(avg * 0.9));
    const suggested = Math.ceil(suggestedRaw / 500) * 500; // round up to $5
    if (suggested <= 0) continue;
    out.push({
      category_id: id,
      name: e.name,
      grp: e.grp,
      icon: e.icon,
      months_with_data: e.totals.length,
      median_cents: med,
      avg_cents: avg,
      suggested_cents: suggested,
      current_budget_cents: budgets.get(id) ?? null
    });
  }
  return out.sort((a, b) => b.suggested_cents - a.suggested_cents);
}

export interface FiftyThirtyTwenty {
  months_sampled: number;
  avg_income_cents: number;
  needs_cents: number;
  wants_cents: number;
  savings_cents: number; // savings categories + leftover (income - spending)
  needs_pct: number;
  wants_pct: number;
  savings_pct: number;
}

/** Average monthly 50/30/20 breakdown over the last N full months. */
export function fiftyThirtyTwenty(monthCount = 3): FiftyThirtyTwenty | null {
  const months = recentMonths(monthCount, false);
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, COALESCE(c.grp, 'other') AS grp, COALESCE(c.kind, 'expense') AS kind,
              SUM(t.amount_cents) AS total_cents
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date, 1, 7) IN (${months.map(() => "?").join(",")})
         AND (c.kind IS NULL OR c.kind != 'transfer')
       GROUP BY month, grp, kind`
    )
    .all(...months) as Array<{ month: string; grp: string; kind: string; total_cents: number }>;

  if (rows.length === 0) return null;

  let income = 0;
  let needs = 0;
  let wants = 0;
  let savings = 0;
  for (const r of rows) {
    if (r.total_cents > 0) income += r.total_cents;
    else {
      const spent = -r.total_cents;
      if (r.grp === "essential") needs += spent;
      else if (r.grp === "savings") savings += spent;
      else wants += spent; // lifestyle + other + uncategorized spending
    }
  }
  const n = months.length;
  income = Math.round(income / n);
  needs = Math.round(needs / n);
  wants = Math.round(wants / n);
  savings = Math.round(savings / n);
  // Money not spent is savings too
  const leftover = Math.max(0, income - needs - wants - savings);
  savings += leftover;

  const denom = Math.max(1, income);
  return {
    months_sampled: n,
    avg_income_cents: income,
    needs_cents: needs,
    wants_cents: wants,
    savings_cents: savings,
    needs_pct: Math.round((needs / denom) * 100),
    wants_pct: Math.round((wants / denom) * 100),
    savings_pct: Math.round((savings / denom) * 100)
  };
}

export interface EmergencyFund {
  monthly_essentials_cents: number;
  liquid_savings_cents: number;
  months_covered: number;
  target3_cents: number;
  target6_cents: number;
}

export function emergencyFund(): EmergencyFund {
  const months = recentMonths(3, false);
  const row = db
    .prepare(
      `SELECT CAST(SUM(-t.amount_cents) / ${months.length}.0 AS INTEGER) AS monthly
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.grp = 'essential'
         AND substr(t.date, 1, 7) IN (${months.map(() => "?").join(",")})`
    )
    .get(...months) as { monthly: number | null };
  const monthly = row.monthly ?? 0;

  const savings = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts
       WHERE archived = 0 AND type IN ('savings', 'checking', 'cash')`
    )
    .get() as { total: number };

  return {
    monthly_essentials_cents: monthly,
    liquid_savings_cents: savings.total,
    months_covered: monthly > 0 ? Math.round((savings.total / monthly) * 10) / 10 : 0,
    target3_cents: monthly * 3,
    target6_cents: monthly * 6
  };
}
