export interface DebtInput {
  id: number;
  name: string;
  balance_cents: number;
  apr: number; // e.g. 24.99
  min_payment_cents: number;
}

export interface DebtPayoffResult {
  strategy: "snowball" | "avalanche";
  months: number;
  total_interest_cents: number;
  total_paid_cents: number;
  debt_free_date: string; // YYYY-MM
  payoff_order: Array<{ id: number; name: string; month: number; date: string }>;
  timeline: Array<{ month: number; date: string; balance_cents: number; interest_cents: number }>;
}

const MAX_MONTHS = 600;

/**
 * Simulate paying off a set of debts with a fixed monthly budget
 * (sum of minimum payments + extra). Freed-up minimums roll into the
 * target debt as debts are paid off.
 *
 * snowball  = smallest balance first (quick wins, motivation)
 * avalanche = highest APR first (mathematically cheapest)
 */
export function simulatePayoff(
  debts: DebtInput[],
  extraCents: number,
  strategy: "snowball" | "avalanche"
): DebtPayoffResult {
  const working = debts
    .filter((d) => d.balance_cents > 0)
    .map((d) => ({ ...d, balance: d.balance_cents }));

  const monthlyBudget =
    working.reduce((sum, d) => sum + d.min_payment_cents, 0) + Math.max(0, extraCents);

  const order = [...working].sort((a, b) =>
    strategy === "snowball" ? a.balance - b.balance : b.apr - a.apr
  );

  const now = new Date();
  const dateOf = (m: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const timeline: DebtPayoffResult["timeline"] = [
    {
      month: 0,
      date: dateOf(0),
      balance_cents: working.reduce((s, d) => s + d.balance, 0),
      interest_cents: 0
    }
  ];
  const payoffOrder: DebtPayoffResult["payoff_order"] = [];
  let totalInterest = 0;
  let month = 0;

  while (working.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    let monthInterest = 0;

    // 1. Accrue interest
    for (const d of working) {
      if (d.balance <= 0) continue;
      const interest = Math.round((d.balance * d.apr) / 100 / 12);
      d.balance += interest;
      monthInterest += interest;
    }
    totalInterest += monthInterest;

    // 2. Pay minimums
    let available = monthlyBudget;
    for (const d of working) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.min_payment_cents, d.balance, available);
      d.balance -= pay;
      available -= pay;
    }

    // 3. Everything left goes to the strategy target(s)
    for (const target of order) {
      if (available <= 0) break;
      const d = working.find((w) => w.id === target.id)!;
      if (d.balance <= 0) continue;
      const pay = Math.min(available, d.balance);
      d.balance -= pay;
      available -= pay;
    }

    for (const d of working) {
      if (d.balance <= 0 && !payoffOrder.some((p) => p.id === d.id)) {
        payoffOrder.push({ id: d.id, name: d.name, month, date: dateOf(month) });
      }
    }

    timeline.push({
      month,
      date: dateOf(month),
      balance_cents: working.reduce((s, d) => s + Math.max(0, d.balance), 0),
      interest_cents: monthInterest
    });
  }

  const principal = debts.reduce((s, d) => s + Math.max(0, d.balance_cents), 0);
  return {
    strategy,
    months: month,
    total_interest_cents: totalInterest,
    total_paid_cents: principal + totalInterest,
    debt_free_date: dateOf(month),
    payoff_order: payoffOrder,
    timeline
  };
}
