import { db, getHouseholdSetting } from "../db.js";
import { median } from "../util.js";
import { householdNetMonthly } from "../routes/income.js";

/**
 * Account types whose transactions count toward spending/income.
 * Everyday-money accounts always count; credit cards are opt-in (a card purchase
 * and its later payment from checking would otherwise double-count). Loans,
 * investments, and retirement never count as cash spending.
 */
export function includedAccountTypes(hid: number): string[] {
  const base = ["checking", "savings", "cash"];
  if (getHouseholdSetting(hid, "include_credit") === "1") base.push("credit");
  return base;
}

/** Safe SQL `IN (...)` list of included account types (values are a fixed whitelist). */
function includedTypesSql(hid: number): string {
  return "(" + includedAccountTypes(hid).map((t) => `'${t}'`).join(",") + ")";
}

/**
 * WHERE fragment restricting to this household's counted accounts. Prefix the
 * alias, e.g. accountFilter("t", hid). Also scopes the transactions to the
 * household directly, so nothing from another household can leak in.
 */
function accountFilter(alias: string, hid: number): string {
  return `${alias}.household_id = ${hid} AND ${alias}.account_id IN (SELECT id FROM accounts WHERE type IN ${includedTypesSql(hid)} AND household_id = ${hid})`;
}

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

/**
 * Income vs spending per month.
 * Income counts ONLY income-kind categories (Salary, Other Income…) — a
 * transfer or uncategorized deposit is never income. Spending counts money
 * out that isn't a transfer (uncategorized outflows included so the app is
 * useful before categorization). Transfers are invisible on both sides.
 */
export function monthlyCashflow(months: number, hid: number): MonthlyCashflow[] {
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
              SUM(CASE WHEN t.amount_cents > 0 AND c.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income_cents,
              SUM(CASE WHEN t.amount_cents < 0 AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income')) THEN -t.amount_cents ELSE 0 END) AS expense_cents
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${accountFilter("t", hid)}
       GROUP BY month ORDER BY month DESC LIMIT ?`
    )
    .all(months) as MonthlyCashflow[];
  return rows.reverse();
}

/** Months (YYYY-MM) that actually contain non-transfer transactions — the real data window. */
export function coveredMonths(candidates: string[], hid: number): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(t.date, 1, 7) AS month
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ${hid} AND (c.kind IS NULL OR c.kind != 'transfer')`
    )
    .all() as Array<{ month: string }>;
  const have = new Set(rows.map((r) => r.month));
  return candidates.filter((m) => have.has(m));
}

export interface CategorySpend {
  category_id: number | null;
  name: string;
  grp: string;
  icon: string;
  total_cents: number; // positive = spent
}

/** Spending by category for one month (YYYY-MM). */
export function spendingByCategory(month: string, hid: number): CategorySpend[] {
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
         AND ${accountFilter("t", hid)}
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
  /** User marked this as "not actually a bill/subscription". */
  ignored: boolean;
}

const CADENCES: Array<{ name: RecurringItem["cadence"]; min: number; max: number; days: number }> = [
  { name: "weekly", min: 5.5, max: 8.5, days: 7 },
  { name: "biweekly", min: 12, max: 16.5, days: 14 },
  { name: "monthly", min: 26, max: 35, days: 30 },
  { name: "quarterly", min: 80, max: 100, days: 91 },
  { name: "yearly", min: 350, max: 380, days: 365 }
];

/** Detect recurring outflows (subscriptions, rent, insurance…) from payment patterns. */
export function detectRecurring(hid: number): RecurringItem[] {
  const rows = db
    .prepare(
      `SELECT t.payee_norm, t.payee, t.date, t.amount_cents, c.name AS category, c.icon
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND t.payee_norm != ''
         AND t.date >= date('now', '-15 months')
         AND (c.kind IS NULL OR c.kind != 'transfer')
         AND ${accountFilter("t", hid)}
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
      occurrences: txns.length,
      ignored: false
    });
  }

  // Apply the user's judgements: "this is not actually a bill"
  const overrides = new Set(
    (db.prepare("SELECT payee_norm FROM recurring_overrides WHERE status = 'ignored' AND household_id = ?").all(hid) as Array<{
      payee_norm: string;
    }>).map((r) => r.payee_norm)
  );
  for (const item of out) item.ignored = overrides.has(item.payee_norm);

  return out.sort((a, b) => Number(a.ignored) - Number(b.ignored) || b.avg_cents - a.avg_cents);
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

/**
 * Suggest a monthly budget per category.
 *
 * Only months that actually contain data count — if your history covers two
 * months, the math divides by two, not by a fixed six. (Dividing by the full
 * window was the bug that turned $2,100 rent into a $660 suggestion.)
 * Regular categories (present most months, e.g. rent) suggest the median of
 * the months they occur; occasional ones (gifts, travel) spread their total
 * across the data window.
 */
export function suggestBudgets(hid: number): BudgetSuggestion[] {
  const window = recentMonths(6, true); // include current month so short histories still work
  const covered = coveredMonths(window, hid);
  if (covered.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT t.category_id, c.name, c.grp, c.icon, substr(t.date, 1, 7) AS month,
              SUM(-t.amount_cents) AS total_cents
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.kind = 'expense'
         AND substr(t.date, 1, 7) IN (${covered.map(() => "?").join(",")})
         AND ${accountFilter("t", hid)}
       GROUP BY t.category_id, month
       HAVING total_cents > 0`
    )
    .all(...covered) as Array<{
    category_id: number;
    name: string;
    grp: string;
    icon: string;
    month: string;
    total_cents: number;
  }>;

  const budgets = new Map(
    (db.prepare("SELECT category_id, monthly_cents FROM budgets WHERE household_id = ?").all(hid) as Array<{
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
    // With 2+ months of data, a single occurrence isn't a pattern yet
    if (e.totals.length < Math.min(2, covered.length)) continue;
    const med = median(e.totals);
    const avg = Math.round(e.totals.reduce((a, b) => a + b, 0) / covered.length);
    const appearRate = e.totals.length / covered.length;
    // Regular (rent, groceries): budget a typical month it occurs.
    // Occasional (gifts, travel): spread the total across the window.
    const base = appearRate >= 0.6 ? Math.max(med, avg) : avg;
    const suggested = Math.ceil(base / 500) * 500; // round up to $5
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
export function fiftyThirtyTwenty(monthCount = 3, hid = 0): FiftyThirtyTwenty | null {
  const months = recentMonths(monthCount, false);
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, COALESCE(c.grp, 'other') AS grp, COALESCE(c.kind, 'expense') AS kind,
              SUM(t.amount_cents) AS total_cents
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date, 1, 7) IN (${months.map(() => "?").join(",")})
         AND (c.kind IS NULL OR c.kind != 'transfer')
         AND ${accountFilter("t", hid)}
       GROUP BY month, grp, kind`
    )
    .all(...months) as Array<{ month: string; grp: string; kind: string; total_cents: number }>;

  if (rows.length === 0) return null;

  let income = 0;
  let needs = 0;
  let wants = 0;
  let savings = 0;
  for (const r of rows) {
    if (r.total_cents > 0) {
      // Only real income counts — transfers/refunds/uncategorized deposits don't
      if (r.kind === "income") income += r.total_cents;
    } else {
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

export interface CutCandidate {
  category_id: number;
  name: string;
  icon: string;
  grp: string;
  avg_monthly_cents: number; // realistic — average of recent actual spending
  budget_cents: number; // this category's monthly budget, or 0 if none set
}

export interface PayoffAssessment {
  data_ok: boolean;
  months_sampled: number;
  avg_income_cents: number;
  avg_spending_cents: number;
  leftover_cents: number; // income − actual spending; can be negative
  total_budget_cents: number; // sum of all set monthly budgets
  min_payments_cents: number;
  cut_candidates: CutCandidate[];
  recurring_wants_cents: number; // detected non-ignored subscriptions per month
}

/**
 * The financial picture behind the debt planner: how much genuinely uncommitted
 * money exists each month, and which discretionary categories are the realistic
 * places to find more. Based on the covered data window, income = income-kind
 * categories only, transfers invisible.
 */
export function payoffAssessment(hid: number): PayoffAssessment {
  const window = recentMonths(6, true);
  const covered = coveredMonths(window, hid).slice(0, 3); // up to the 3 most recent months with data
  const totalBudget = (
    db.prepare("SELECT COALESCE(SUM(monthly_cents), 0) AS total FROM budgets WHERE household_id = ?").get(hid) as {
      total: number;
    }
  ).total;
  // A saved paycheck take-home (Income page) overrides transaction-derived income.
  const netMonthly = householdNetMonthly(hid);
  const empty: PayoffAssessment = {
    data_ok: netMonthly != null,
    months_sampled: 0,
    avg_income_cents: netMonthly ?? 0,
    avg_spending_cents: 0,
    leftover_cents: netMonthly ?? 0,
    total_budget_cents: totalBudget,
    min_payments_cents: 0,
    cut_candidates: [],
    recurring_wants_cents: 0
  };
  if (covered.length === 0) return empty;

  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN t.amount_cents > 0 AND c.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income,
         SUM(CASE WHEN t.amount_cents < 0 AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income')) THEN -t.amount_cents ELSE 0 END) AS spending
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE substr(t.date, 1, 7) IN (${covered.map(() => "?").join(",")})
         AND ${accountFilter("t", hid)}`
    )
    .get(...covered) as { income: number | null; spending: number | null };

  const n = covered.length;
  const income = netMonthly ?? Math.round((totals.income ?? 0) / n);
  const spending = Math.round((totals.spending ?? 0) / n);

  const minPayments = (
    db.prepare("SELECT COALESCE(SUM(min_payment_cents), 0) AS total FROM debts WHERE balance_cents > 0 AND household_id = ?").get(hid) as {
      total: number;
    }
  ).total;

  // Every meaningful expense category is a place you *could* cut — including
  // essentials like rent (moving is drastic, but it's the user's call). Biggest
  // first. Each carries both its realistic average spend and its budget, so the
  // planner can trim against either basis.
  const cuts = db
    .prepare(
      `SELECT t.category_id, c.name, c.icon, c.grp,
              CAST(SUM(-t.amount_cents) / ${n}.0 AS INTEGER) AS avg_monthly_cents,
              COALESCE((SELECT monthly_cents FROM budgets b WHERE b.category_id = t.category_id), 0) AS budget_cents
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.kind = 'expense'
         AND substr(t.date, 1, 7) IN (${covered.map(() => "?").join(",")})
         AND ${accountFilter("t", hid)}
       GROUP BY t.category_id
       HAVING avg_monthly_cents >= 1000
       ORDER BY avg_monthly_cents DESC
       LIMIT 12`
    )
    .all(...covered) as CutCandidate[];

  const recurringWants = detectRecurring(hid)
    .filter((r) => !r.ignored)
    .reduce((sum, r) => {
      const perMonth =
        r.cadence === "weekly" ? r.avg_cents * 4.33 :
        r.cadence === "biweekly" ? r.avg_cents * 2.17 :
        r.cadence === "monthly" ? r.avg_cents :
        r.cadence === "quarterly" ? r.avg_cents / 3 :
        r.avg_cents / 12;
      return sum + perMonth;
    }, 0);

  return {
    data_ok: income > 0 || spending > 0,
    months_sampled: n,
    avg_income_cents: income,
    avg_spending_cents: spending,
    leftover_cents: income - spending,
    total_budget_cents: totalBudget,
    min_payments_cents: minPayments,
    cut_candidates: cuts,
    recurring_wants_cents: Math.round(recurringWants)
  };
}

export interface EmergencyFund {
  monthly_essentials_cents: number;
  liquid_savings_cents: number;
  months_covered: number;
  target3_cents: number;
  target6_cents: number;
}

export function emergencyFund(hid: number): EmergencyFund {
  const months = recentMonths(3, false);
  const row = db
    .prepare(
      `SELECT CAST(SUM(-t.amount_cents) / ${months.length}.0 AS INTEGER) AS monthly
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.amount_cents < 0 AND c.grp = 'essential'
         AND substr(t.date, 1, 7) IN (${months.map(() => "?").join(",")})
         AND ${accountFilter("t", hid)}`
    )
    .get(...months) as { monthly: number | null };
  const monthly = row.monthly ?? 0;

  const savings = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts
       WHERE archived = 0 AND type IN ('savings', 'checking', 'cash') AND household_id = ?`
    )
    .get(hid) as { total: number };

  return {
    monthly_essentials_cents: monthly,
    liquid_savings_cents: savings.total,
    months_covered: monthly > 0 ? Math.round((savings.total / monthly) * 10) / 10 : 0,
    target3_cents: monthly * 3,
    target6_cents: monthly * 6
  };
}

export interface FireStats {
  data_ok: boolean;
  months_sampled: number;
  avg_income_cents: number; // monthly, income-kind categories only
  avg_spending_cents: number; // monthly, non-transfer outflow
  // Account balances grouped by type (all archived-excluded, this household).
  balances: {
    checking: number;
    savings: number;
    cash: number;
    investment: number;
    retirement: number;
    credit: number;
    loan: number;
    other: number;
  };
  net_worth_cents: number;
}

/**
 * The inputs a FIRE (Financial Independence, Retire Early) projection needs:
 * a stable monthly income and spending average, and current balances split by
 * account type so the app can tell savings/investments/retirement (the nest
 * egg) apart from spending buffers and debt. All the FIRE math (target, years
 * to FI, coast number) is done client-side so assumptions can be tweaked live.
 */
export function fireStats(hid: number): FireStats {
  const window = recentMonths(6, true);
  const covered = coveredMonths(window, hid);

  let avgIncome = 0;
  let avgSpending = 0;
  const n = covered.length;
  if (n > 0) {
    const totals = db
      .prepare(
        `SELECT
           SUM(CASE WHEN t.amount_cents > 0 AND c.kind = 'income' THEN t.amount_cents ELSE 0 END) AS income,
           SUM(CASE WHEN t.amount_cents < 0 AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income')) THEN -t.amount_cents ELSE 0 END) AS spending
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE substr(t.date, 1, 7) IN (${covered.map(() => "?").join(",")})
           AND ${accountFilter("t", hid)}`
      )
      .get(...covered) as { income: number | null; spending: number | null };
    avgIncome = Math.round((totals.income ?? 0) / n);
    avgSpending = Math.round((totals.spending ?? 0) / n);
  }
  // A saved paycheck take-home (Income page) overrides transaction-derived income.
  const netMonthly = householdNetMonthly(hid);
  if (netMonthly != null) avgIncome = netMonthly;

  const balances = { checking: 0, savings: 0, cash: 0, investment: 0, retirement: 0, credit: 0, loan: 0, other: 0 };
  const rows = db
    .prepare(
      "SELECT type, COALESCE(SUM(balance_cents), 0) AS total FROM accounts WHERE household_id = ? AND archived = 0 GROUP BY type"
    )
    .all(hid) as Array<{ type: string; total: number }>;
  let netWorth = 0;
  for (const r of rows) {
    netWorth += r.total;
    if (r.type in balances) balances[r.type as keyof typeof balances] += r.total;
    else balances.other += r.total;
  }

  return {
    data_ok: avgIncome > 0 || avgSpending > 0,
    months_sampled: n,
    avg_income_cents: avgIncome,
    avg_spending_cents: avgSpending,
    balances,
    net_worth_cents: netWorth
  };
}
