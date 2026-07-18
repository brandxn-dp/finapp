import { useState } from "react";
import { api, useApi } from "../lib/api";
import type { BudgetRow, BudgetSuggestion, Category, CategorySpend } from "../lib/api";
import { currentMonth, money, monthNameLong } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Empty, Icon, Input, Modal, PageHeader, Select, Spinner, useToast } from "../components/ui";

export default function Budget() {
  const month = currentMonth();
  const { data: budgets, refetch: refetchBudgets } = useApi<BudgetRow[]>("/api/budgets");
  const { data: categories, refetch: refetchCategories } = useApi<Category[]>("/api/categories");
  const { data: spend } = useApi<{ month: string; spending: CategorySpend[] }>(
    `/api/insights/spending?month=${month}`
  );
  const { data: sugg, refetch: refetchSugg, loading: loadingSugg } = useApi<{ suggestions: BudgetSuggestion[] }>(
    "/api/insights/budget-suggestions"
  );
  const [modal, setModal] = useState<"add" | BudgetRow | null>(null);
  const { toast } = useToast();

  const spentBy = new Map((spend?.spending ?? []).map((s) => [s.category_id, s.total_cents]));

  const refreshAll = () => {
    refetchBudgets();
    refetchCategories();
    refetchSugg();
  };

  const save = async (categoryId: number, monthlyCents: number) => {
    try {
      await api.put("/api/budgets", { items: [{ category_id: categoryId, monthly_cents: monthlyCents }] });
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const removeBudget = async (categoryId: number) => {
    try {
      await api.del(`/api/budgets/${categoryId}`);
      refreshAll();
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
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const pending = (sugg?.suggestions ?? []).filter(
    (s) => s.current_budget_cents === null || s.current_budget_cents !== s.suggested_cents
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Budget"
        sub={`${monthNameLong(month)} — budgets learned from your actual spending patterns`}
        action={
          <Button size="sm" onClick={() => setModal("add")}>
            <Icon name="plus" size={14} /> Add budget item
          </Button>
        }
      />

      <Card title="Monthly budgets">
        {!budgets || budgets.length === 0 ? (
          <Empty
            icon="target"
            title="No budgets set yet"
            sub="Accept the suggestions below, or add items by hand with the button above."
          />
        ) : (
          <ul className="space-y-4">
            {budgets.map((b) => (
              <BudgetLine
                key={b.category_id}
                row={b}
                spent={spentBy.get(b.category_id) ?? 0}
                onRemove={() => removeBudget(b.category_id)}
                onEdit={() => setModal(b)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Suggested budgets"
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                refetchSugg();
                toast("Recalculated from your latest transactions.", "info");
              }}
            >
              <Icon name="refresh" size={14} /> Recalculate
            </Button>
            {pending.length > 1 && (
              <Button size="sm" variant="ghost" onClick={applyAll}>
                <Icon name="check" size={14} /> Apply all
              </Button>
            )}
          </div>
        }
      >
        {loadingSugg ? (
          <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
        ) : pending.length === 0 ? (
          <Empty
            icon="check"
            title="You're all caught up"
            sub="Suggestions appear once there are at least two months of categorized history in a category. They're computed live from your transactions — Recalculate picks up anything new."
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

      {modal && (
        <BudgetItemModal
          existing={modal === "add" ? null : modal}
          categories={categories ?? []}
          budgets={budgets ?? []}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function BudgetLine({
  row,
  spent,
  onRemove,
  onEdit
}: {
  row: BudgetRow;
  spent: number;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const c = useChartColors();
  // A $0 budget means "spend nothing here" — any spend is over.
  const zero = row.monthly_cents === 0;
  const pct = zero ? (spent > 0 ? 100 : 0) : Math.min(100, (spent / row.monthly_cents) * 100);
  const over = spent > row.monthly_cents;

  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-ink">
          <span className="mr-1.5">{row.icon}</span>
          {row.name}
          {zero && <span className="ml-2 text-xs text-ink3">no-spend goal</span>}
          {over && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-bad">
              <Icon name="alert" size={12} /> over by {money(spent - row.monthly_cents)}
            </span>
          )}
        </span>
        <span className="tnum shrink-0 text-ink2">
          {money(spent)} <span className="text-ink3">of</span> {money(row.monthly_cents)}
          <button className="ml-2 text-ink3 hover:text-ink" title="Edit name, emoji, or amount" onClick={onEdit}>
            <Icon name="sliders" size={12} />
          </button>
          <button className="ml-1.5 text-ink3 hover:text-bad" title="Remove budget" onClick={onRemove}>
            <Icon name="x" size={12} />
          </button>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: over ? "var(--bad)" : c.bar }}
        />
      </div>
    </li>
  );
}

/**
 * Add or edit a budget item. A budget item is a category + monthly amount, so
 * adding one can also mint a brand-new category with its own name and emoji.
 */
function BudgetItemModal({
  existing,
  categories,
  budgets,
  onClose,
  onSaved
}: {
  existing: BudgetRow | null;
  categories: Category[];
  budgets: BudgetRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const budgeted = new Set(budgets.map((b) => b.category_id));
  const available = categories.filter((c) => c.kind === "expense" && !budgeted.has(c.id));

  const [mode, setMode] = useState<"existing" | "new">(existing ? "existing" : available.length > 0 ? "existing" : "new");
  const [categoryId, setCategoryId] = useState<string>(existing ? String(existing.category_id) : available[0] ? String(available[0].id) : "");
  const [name, setName] = useState(existing?.name ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "🏷️");
  const [grp, setGrp] = useState(existing?.grp ?? "lifestyle");
  const [amount, setAmount] = useState(existing ? String(Math.round(existing.monthly_cents / 100)) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const cents = Math.round(Number(amount || 0) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast("Enter a monthly amount of zero or more.", "bad");
      return;
    }
    setBusy(true);
    try {
      let catId: number;
      if (existing) {
        catId = existing.category_id;
        // Name/emoji edits apply to the underlying category
        if (name.trim() && (name.trim() !== existing.name || icon !== existing.icon)) {
          await api.patch(`/api/categories/${catId}`, { name: name.trim(), icon });
        }
      } else if (mode === "new") {
        if (!name.trim()) {
          toast("Give the new budget item a name.", "bad");
          setBusy(false);
          return;
        }
        const created = await api.post<Category>("/api/categories", {
          name: name.trim(),
          icon,
          grp,
          kind: "expense"
        });
        catId = created.id;
      } else {
        catId = Number(categoryId);
        if (!catId) {
          toast("Pick a category.", "bad");
          setBusy(false);
          return;
        }
      }
      await api.put("/api/budgets", { items: [{ category_id: catId, monthly_cents: cents }] });
      toast(existing ? "Budget updated." : "Budget item added.", "good");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={existing ? "Edit budget item" : "Add budget item"} onClose={onClose}>
      <div className="space-y-3">
        {!existing && (
          <div className="flex gap-2">
            <Button variant={mode === "existing" ? "subtle" : "ghost"} size="sm" onClick={() => setMode("existing")} disabled={available.length === 0}>
              Existing category
            </Button>
            <Button variant={mode === "new" ? "subtle" : "ghost"} size="sm" onClick={() => setMode("new")}>
              New category
            </Button>
          </div>
        )}

        {!existing && mode === "existing" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Category</span>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </Select>
          </label>
        ) : (
          <div className="flex gap-3">
            <label className="block w-20">
              <span className="mb-1 block text-xs font-medium text-ink2">Emoji</span>
              <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full text-center" maxLength={4} />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-ink2">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coffee runs" className="w-full" />
            </label>
            {!existing && (
              <label className="block w-32">
                <span className="mb-1 block text-xs font-medium text-ink2">Group</span>
                <Select value={grp} onChange={(e) => setGrp(e.target.value)} className="w-full">
                  <option value="essential">Needs</option>
                  <option value="lifestyle">Wants</option>
                  <option value="savings">Savings</option>
                  <option value="other">Other</option>
                </Select>
              </label>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Monthly amount ($) — 0 sets a no-spend goal</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="w-40" placeholder="0" />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="check" size={14} />} Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
