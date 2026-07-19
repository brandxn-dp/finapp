import { useCallback, useEffect, useState } from "react";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin", // send the session cookie
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path)
};

/** Small fetch hook with manual refetch. */
export function useApi<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);

  return { data, error, loading, refetch };
}

// ---------- shared types (mirror the server) ----------

export interface Account {
  id: number;
  name: string;
  type: string;
  currency: string;
  balance_cents: number;
  simplefin_id: string | null;
  archived: number;
  txn_count: number;
}

export interface Category {
  id: number;
  name: string;
  grp: "income" | "essential" | "lifestyle" | "savings" | "other";
  kind: "expense" | "income" | "transfer";
  icon: string;
  is_default: number;
  txn_count: number;
}

export interface Txn {
  id: number;
  account_id: number;
  date: string;
  amount_cents: number;
  payee: string;
  memo: string;
  category_id: number | null;
  categorized_by: string | null;
  account_name: string;
  category_name: string | null;
  category_icon: string | null;
  category_grp: string | null;
}

export interface TxnPage {
  total: number;
  rows: Txn[];
}

export interface Cashflow {
  month: string;
  income_cents: number;
  expense_cents: number;
}

export interface CategorySpend {
  category_id: number | null;
  name: string;
  grp: string;
  icon: string;
  total_cents: number;
}

export interface FiftyThirtyTwenty {
  months_sampled: number;
  avg_income_cents: number;
  needs_cents: number;
  wants_cents: number;
  savings_cents: number;
  needs_pct: number;
  wants_pct: number;
  savings_pct: number;
}

export interface EmergencyFund {
  monthly_essentials_cents: number;
  liquid_savings_cents: number;
  months_covered: number;
  target3_cents: number;
  target6_cents: number;
}

export interface Overview {
  month: string;
  net_worth_cents: number;
  transactions: number;
  uncategorized: number;
  cashflow: Cashflow[];
  spending: CategorySpend[];
  fifty_thirty_twenty: FiftyThirtyTwenty | null;
  emergency_fund: EmergencyFund;
}

export interface RecurringItem {
  payee_norm: string;
  payee: string;
  category: string | null;
  icon: string | null;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  avg_cents: number;
  last_date: string;
  next_date: string;
  occurrences: number;
  ignored: boolean;
}

export interface CutCandidate {
  category_id: number;
  name: string;
  icon: string;
  grp: string;
  avg_monthly_cents: number;
  budget_cents: number;
}

export interface PayoffPlan {
  data_ok: boolean;
  months_sampled: number;
  avg_income_cents: number;
  avg_spending_cents: number;
  leftover_cents: number;
  total_budget_cents: number;
  min_payments_cents: number;
  cut_candidates: CutCandidate[];
  recurring_wants_cents: number;
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

export interface BudgetItem {
  id: number;
  name: string;
  amount_cents: number;
}

export interface BudgetRow {
  category_id: number;
  monthly_cents: number;
  name: string;
  grp: string;
  icon: string;
  items: BudgetItem[];
}

export interface Debt {
  id: number;
  name: string;
  balance_cents: number;
  apr: number;
  min_payment_cents: number;
}

export interface PayoffResult {
  strategy: "snowball" | "avalanche";
  months: number;
  total_interest_cents: number;
  total_paid_cents: number;
  debt_free_date: string;
  payoff_order: Array<{ id: number; name: string; month: number; date: string }>;
  timeline: Array<{ month: number; date: string; balance_cents: number; interest_cents: number }>;
}

export interface Simulation {
  extra_cents: number;
  snowball: PayoffResult;
  avalanche: PayoffResult;
}

export interface Settings {
  ai_provider: "anthropic" | "ollama";
  ai_configured: boolean;
  model: string;
  anthropic_model: string;
  anthropic_key_set: boolean;
  anthropic_key_source: "app" | "env" | null;
  ollama_url: string;
  ollama_model: string;
  simplefin_connected: boolean;
  simplefin_last_sync: string | null;
  currency: string;
  include_credit: boolean;
}

export interface DupTxn extends Txn {
  external_id: string | null;
  import_hash: string | null;
}

export interface DuplicateGroups {
  groups: DupTxn[][];
}

export interface CategorizeResult {
  byRule: number;
  byCache: number;
  byAi: number;
  newMerchants: number;
  remaining: number;
  aiUsed: boolean;
  error?: string;
}

export interface TrashItem {
  id: number;
  account_id: number;
  account_name: string | null;
  date: string;
  amount_cents: number;
  payee: string | null;
  memo: string | null;
  deleted_at: string;
  from_sync: number;
}

export interface DeletedAccount {
  id: number;
  name: string;
  type: string | null;
  balance_cents: number | null;
  txn_count: number;
  deleted_at: string;
}

export interface Rule {
  id: number;
  pattern: string;
  category_id: number;
  category_name: string;
  category_icon: string;
}
