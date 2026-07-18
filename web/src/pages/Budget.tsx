import { useState } from "react";
import { api, useApi } from "../lib/api";
import type { BudgetRow, BudgetSuggestion, CategorySpend } from "../lib/api";
import { currentMonth, money, monthNameLong } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Empty, Icon, Input, Spinner, useToast } from "../components/ui";

export default function Budget() {
  const month = currentMonth();
  const { data: budgets, refetch: refetchBudgets } = useApi<BudgetRow[]>("/api/budgets");
  const { data: spend } = useApi<{ month: string; spending: CategorySpend[] }>(
    `/api/insights/spending?month=${month}`
  );
  const { data: sugg, refetch: refetchSugg, loading: loadingSugg } = useApi<{ suggestions: BudgetSuggestion[] }>(
    "/api/insights/budget-suggestions"
  );
  const { toast } = useToast();

  const spentBy = new Map((spend?.spending ?? []).map((s) => [s.category_id, s.total_cents]));

  const save = async (categoryId: number, monthlyCents: number) => {
    try {
      await api.put("/api/budgets", { items: [{ category_id: categoryId, monthly_cents: monthlyCents }] });
      refetchBudgets();
      refetchSugg();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const applyAll = async () => {
    const items = (sugg?.suggestions ?? []).map((s) => ({
      category_id: s.category_id,
      monthly_cents: s.suggested_cents
    }));
    if (items.length === 0) return;
    try {
      await api.put("/api/budgets", { items });
      toast(`Applied ${items.length} suggested budgets.`, "good");
      refetchBudgets();
      refetchSugg();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const pending = (sugg?.suggestions ?? []).filter(
    (s) => s.current_budget_cents === null || s.current_budget_cents !== s.suggested_cents
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Budget</h1>
        <p className="mt-0.5 text-sm text-ink2">{monthNameLong(month)} — budgets learned from your actual spending patterns</p>
      </header>

      <Card title="Monthly budgets">
        {!budgets || budgets.length === 0 ? (
          <Empty
            icon="target"
            title="No budgets set yet"
            sub="Accept the suggestions below — they're computed from your last six months of spending."
          />
        ) : (
          <ul className="space-y-4">
            {budgets.map((b) => (
              <BudgetLine
                key={b.category_id}
                row={b}
                spent={spentBy.get(b.category_id) ?? 0}
                onSave={save}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Suggested budgets"
        action={
          pending.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={applyAll}>
              <Icon name="check" size={14} /> Apply all
            </Button>
          ) : undefined
        }
      >
        {loadingSugg ? (
          <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
        ) : pending.length === 0 ? (
          <Empty
            icon="check"
            title="You're all caught up"
            sub="Suggestions appear once there are at least two months of categorized history in a category."
          />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((s) => (
              <li key={s.category_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="text-base">{s.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{s.name}</div>
                  <div className="text-xs text-ink3">
                    median {money(s.median_cents)} · avg {money(s.avg_cents)} over {s.months_with_data} months
                  </div>
                </div>
                <span className="tnum text-sm font-semibold text-ink">{money(s.suggested_cents)}/mo</span>
                <Button size="sm" variant="subtle" onClick={() => save(s.category_id, s.suggested_cents)}>
                  Apply
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BudgetLine({
  row,
  spent,
  onSave
}: {
  row: BudgetRow;
  spent: number;
  onSave: (categoryId: number, monthlyCents: number) => void;
}) {
  const c = useChartColors();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.round(row.monthly_cents / 100)));
  const pct = Math.min(100, (spent / Math.max(1, row.monthly_cents)) * 100);
  const over = spent > row.monthly_cents;

  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-ink">
          <span className="mr-1.5">{row.icon}</span>
          {row.name}
          {over && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-bad">
              <Icon name="alert" size={12} /> over by {money(spent - row.monthly_cents)}
            </span>
          )}
        </span>
        <span className="tnum shrink-0 text-ink2">
          {money(spent)} <span className="text-ink3">of</span>{" "}
          {editing ? (
            <span className="inline-flex items-center gap-1">
              $
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => {
                  setEditing(false);
                  const cents = Number(value) * 100;
                  if (Number.isFinite(cents) && cents !== row.monthly_cents) onSave(row.category_id, cents);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="!h-6 w-20 !px-1.5 !text-xs"
              />
            </span>
          ) : (
            <button className="underline decoration-dotted underline-offset-2 hover:text-ink" onClick={() => setEditing(true)}>
              {money(row.monthly_cents)}
            </button>
          )}
          <button
            className="ml-2 text-ink3 hover:text-bad"
            title="Remove budget"
            onClick={() => onSave(row.category_id, 0)}
          >
            <Icon name="x" size={12} />
          </button>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: over ? "var(--bad)" : c.seq[3] }}
        />
      </div>
    </li>
  );
}
