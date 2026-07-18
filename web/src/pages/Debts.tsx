import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api, useApi } from "../lib/api";
import type { Debt, PayoffPlan, PayoffResult, Simulation } from "../lib/api";
import { money, moneyCompact, monthName } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Empty, Icon, Input, Modal, PageHeader, Spinner, useToast } from "../components/ui";
import { ChartTooltip, LegendRow } from "../components/charts";

export default function Debts() {
  const { data: debts, refetch } = useApi<Debt[]>("/api/debts");
  const { data: plan } = useApi<PayoffPlan>("/api/debts/plan");
  const [extra, setExtra] = useState("0");
  const [extraIncome, setExtraIncome] = useState("");
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [sim, setSim] = useState<Simulation | null>(null);
  const [baseline, setBaseline] = useState<Simulation | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [editing, setEditing] = useState<Debt | "new" | null>(null);
  const { toast } = useToast();

  /** Extra payment = manual amount + what-if income + checked category trims (25% each). */
  const totalExtraCents = useMemo(() => {
    const base = Math.max(0, Math.round(Number(extra || 0) * 100));
    const income = Math.max(0, Math.round(Number(extraIncome || 0) * 100));
    const cutTotal = (plan?.cut_candidates ?? [])
      .filter((c) => cuts.has(c.category_id))
      .reduce((s, c) => s + Math.round(c.avg_monthly_cents * 0.25), 0);
    return base + income + cutTotal;
  }, [extra, extraIncome, cuts, plan]);

  // Baseline: minimum payments only — the "do nothing different" yardstick
  useEffect(() => {
    if (!debts || debts.length === 0) {
      setBaseline(null);
      return;
    }
    api.post<Simulation>("/api/debts/simulate", { extra_cents: 0 }).then(setBaseline).catch(() => {});
  }, [debts]);

  useEffect(() => {
    if (!debts || debts.length === 0) {
      setSim(null);
      return;
    }
    const t = setTimeout(async () => {
      setSimBusy(true);
      try {
        setSim(await api.post<Simulation>("/api/debts/simulate", { extra_cents: totalExtraCents }));
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "bad");
      } finally {
        setSimBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debts, totalExtraCents]);

  const totalDebt = (debts ?? []).reduce((s, d) => s + d.balance_cents, 0);

  const importFromAccounts = async () => {
    try {
      const r = await api.post<{ created: string[]; skipped: number; note?: string }>(
        "/api/debts/import-accounts"
      );
      if (r.created.length === 0) {
        toast("No credit or loan accounts with balances to import (already imported, or none synced).", "info");
      } else {
        toast(`Imported ${r.created.length} debt${r.created.length > 1 ? "s" : ""}: ${r.created.join(", ")}. ${r.note ?? ""}`, "good");
        refetch();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Debt Planner"
        sub="Your clearest path out of debt, computed from your actual finances."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={importFromAccounts} title="Create debts from credit-card and loan accounts">
              <Icon name="card" size={14} /> Import from accounts
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Icon name="plus" size={14} /> Add debt
            </Button>
          </div>
        }
      />

      {!debts || debts.length === 0 ? (
        <Card>
          <Empty
            icon="card"
            title="No debts tracked"
            sub="Add each credit card or loan by hand, or use “Import from accounts” to pull in your synced credit-card and loan balances automatically (then correct the estimated APRs)."
          />
        </Card>
      ) : (
        <>
          <PlanCard
            plan={plan}
            extra={extra}
            setExtra={setExtra}
            extraIncome={extraIncome}
            setExtraIncome={setExtraIncome}
            cuts={cuts}
            setCuts={setCuts}
            totalExtraCents={totalExtraCents}
            simBusy={simBusy}
          />

          {sim && <Verdict sim={sim} baseline={baseline} totalExtraCents={totalExtraCents} debts={debts} />}

          <Card title="Your debts" action={<span className="tnum text-xs text-ink3">{money(totalDebt)} total</span>}>
            <ul className="divide-y divide-line">
              {debts.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{d.name}</div>
                    <div className="text-xs text-ink3">
                      {d.apr}% APR · min {money(d.min_payment_cents)}/mo
                    </div>
                  </div>
                  <span className="tnum text-sm font-semibold text-ink">{money(d.balance_cents)}</span>
                  <button className="p-1 text-ink3 hover:text-ink" onClick={() => setEditing(d)} title="Edit">
                    <Icon name="sliders" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {sim && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <StrategyCard
                  title="Snowball"
                  subtitle="Smallest balance first — quick wins keep you motivated"
                  r={sim.snowball}
                />
                <StrategyCard
                  title="Avalanche"
                  subtitle="Highest APR first — mathematically cheapest"
                  r={sim.avalanche}
                  highlight={
                    sim.snowball.total_interest_cents > sim.avalanche.total_interest_cents
                      ? `saves ${money(sim.snowball.total_interest_cents - sim.avalanche.total_interest_cents)} in interest vs snowball`
                      : "identical to snowball for your debts"
                  }
                />
              </div>
              <PayoffChart sim={sim} />
            </>
          )}
        </>
      )}

      {editing && (
        <DebtModal
          debt={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ---------------- The plan: where the extra money comes from ----------------

function PlanCard({
  plan,
  extra,
  setExtra,
  extraIncome,
  setExtraIncome,
  cuts,
  setCuts,
  totalExtraCents,
  simBusy
}: {
  plan: PayoffPlan | null;
  extra: string;
  setExtra: (v: string) => void;
  extraIncome: string;
  setExtraIncome: (v: string) => void;
  cuts: Set<number>;
  setCuts: (s: Set<number>) => void;
  totalExtraCents: number;
  simBusy: boolean;
}) {
  if (!plan) {
    return (
      <Card title="Your payoff plan">
        <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
      </Card>
    );
  }

  if (!plan.data_ok || plan.avg_income_cents === 0) {
    return (
      <Card title="Your payoff plan">
        <Empty
          icon="sparkle"
          title="The planner needs categorized data"
          sub="It reads your income (Salary / Other Income categories) and spending to work out how much you can throw at debt. Run Auto-categorize on the Transactions page first — then this becomes the smartest tab in the app."
        />
      </Card>
    );
  }

  const leftoverTone = plan.leftover_cents > 0 ? "text-good" : "text-bad";
  const toggleCut = (id: number) => {
    const next = new Set(cuts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCuts(next);
  };

  return (
    <Card title="Your payoff plan" action={simBusy ? <Spinner className="text-ink3" /> : undefined}>
      {/* The monthly picture */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface2/60 p-3 text-center">
        <div>
          <div className="smallcaps text-[11px] text-ink3">Income / mo</div>
          <div className="tnum font-display text-lg font-semibold text-ink">{money(plan.avg_income_cents)}</div>
        </div>
        <div>
          <div className="smallcaps text-[11px] text-ink3">Spending / mo</div>
          <div className="tnum font-display text-lg font-semibold text-ink">{money(plan.avg_spending_cents)}</div>
        </div>
        <div>
          <div className="smallcaps text-[11px] text-ink3">Left over / mo</div>
          <div className={`tnum font-display text-lg font-semibold ${leftoverTone}`}>{money(plan.leftover_cents)}</div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-ink3">
        Averages over your last {plan.months_sampled} month{plan.months_sampled > 1 ? "s" : ""} of data. Income counts
        only Salary/Other Income; transfers are invisible.
        {plan.leftover_cents < 0 &&
          " You're currently spending more than you earn — the cuts below matter double."}
      </p>

      {/* Build the extra payment */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="smallcaps mb-2 text-[12px] font-medium text-ink2">Build your extra monthly payment</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink2">Extra from leftover:</span>
          <span className="text-sm text-ink3">$</span>
          <Input value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^0-9]/g, ""))} className="w-24" inputMode="numeric" />
          {plan.leftover_cents > 0 && (
            <Button size="sm" variant="subtle" onClick={() => setExtra(String(Math.floor(plan.leftover_cents / 100)))}>
              Use full leftover ({money(plan.leftover_cents)})
            </Button>
          )}
        </div>

        {plan.cut_candidates.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-ink2">Where you could realistically cut — tick to see the effect:</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {plan.cut_candidates.map((c) => (
                <label
                  key={c.category_id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                    cuts.has(c.category_id) ? "border-accent/60 bg-accent/10" : "border-line hover:bg-surface2"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={cuts.has(c.category_id)}
                    onChange={() => toggleCut(c.category_id)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {c.icon} Trim {c.name} 25%
                  </span>
                  <span className="tnum shrink-0 text-xs text-ink2">
                    +{money(Math.round(c.avg_monthly_cents * 0.25))}/mo
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink3">
              Based on your average spend ({money(plan.recurring_wants_cents)}/mo of it is recurring subscriptions —
              the Savings page lists them).
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink2">What if I earned more? +</span>
          <span className="text-sm text-ink3">$</span>
          <Input
            value={extraIncome}
            onChange={(e) => setExtraIncome(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="w-24"
            inputMode="numeric"
          />
          <span className="text-xs text-ink3">/mo (raise, side income…)</span>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl bg-accent/10 px-3 py-2">
          <span className="text-sm font-medium text-ink">Total extra toward debt</span>
          <span className="tnum font-display text-lg font-semibold text-accent">{money(totalExtraCents)}/mo</span>
        </div>
      </div>
    </Card>
  );
}

/** The one-paragraph answer: what to do, and what it buys you. */
function Verdict({
  sim,
  baseline,
  totalExtraCents,
  debts
}: {
  sim: Simulation;
  baseline: Simulation | null;
  totalExtraCents: number;
  debts: Debt[];
}) {
  const useAvalanche = sim.avalanche.total_interest_cents <= sim.snowball.total_interest_cents;
  const best = useAvalanche ? sim.avalanche : sim.snowball;
  // The strategy's actual target: highest APR (avalanche) / smallest balance (snowball)
  const open = debts.filter((d) => d.balance_cents > 0);
  const target = [...open].sort((a, b) => (useAvalanche ? b.apr - a.apr : a.balance_cents - b.balance_cents))[0];
  const base = baseline?.avalanche;
  const monthsSooner = base ? base.months - best.months : 0;
  const interestSaved = base ? base.total_interest_cents - best.total_interest_cents : 0;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Icon name="target" size={18} />
        </div>
        <div>
          <div className="font-display smallcaps text-[15px] font-semibold text-ink">The optimal path</div>
          {totalExtraCents === 0 ? (
            <p className="mt-1 text-sm leading-relaxed text-ink2">
              On minimum payments alone you'd be{" "}
              <strong className="text-ink">debt-free {monthName(best.debt_free_date)}</strong>, paying{" "}
              <strong className="text-ink">{money(best.total_interest_cents)}</strong> in interest along the way.
              Every extra dollar you assemble above goes to{" "}
              <strong className="text-ink">{target?.name}</strong> ({target?.apr}% APR — your most expensive debt)
              and shortens that.
            </p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-ink2">
              Pay the minimum on everything, and send{" "}
              <strong className="text-ink">{money(totalExtraCents)}/mo extra</strong> at{" "}
              <strong className="text-ink">{target?.name}</strong> first
              {useAvalanche ? ` (${target?.apr}% APR — the mathematically cheapest order)` : " (smallest balance — fastest first win)"}.
              When it's gone, roll its whole payment into the next debt. You'd be{" "}
              <strong className="text-ink">debt-free {monthName(best.debt_free_date)}</strong>
              {base && (monthsSooner > 0 || interestSaved > 0) ? (
                <>
                  {" "}— <strong className="text-good">{monthsSooner} months sooner</strong> and{" "}
                  <strong className="text-good">{money(Math.max(0, interestSaved))} less interest</strong> than minimum
                  payments alone
                </>
              ) : (
                <> paying {money(best.total_interest_cents)} in interest</>
              )}
              .
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function StrategyCard({
  title,
  subtitle,
  r,
  highlight
}: {
  title: string;
  subtitle: string;
  r: PayoffResult;
  highlight?: string;
}) {
  const years = Math.floor(r.months / 12);
  const rem = r.months % 12;
  const dur = years > 0 ? `${years}y ${rem}m` : `${rem} months`;
  return (
    <Card title={title}>
      <p className="-mt-1 mb-3 text-xs text-ink3">{subtitle}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink3">Debt-free</div>
          <div className="tnum font-display mt-0.5 text-lg font-semibold text-ink">{monthName(r.debt_free_date)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink3">Duration</div>
          <div className="tnum font-display mt-0.5 text-lg font-semibold text-ink">{dur}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink3">Interest</div>
          <div className="tnum font-display mt-0.5 text-lg font-semibold text-ink">{money(r.total_interest_cents)}</div>
        </div>
      </div>
      {highlight && <div className="mt-3 rounded-lg bg-good/10 px-3 py-1.5 text-xs font-medium text-good">{highlight}</div>}
      <div className="mt-3 text-xs text-ink2">
        Payoff order:{" "}
        {r.payoff_order.map((p, i) => (
          <span key={p.id}>
            {i > 0 && " → "}
            <span className="font-medium text-ink">{p.name}</span> ({monthName(p.date)})
          </span>
        ))}
      </div>
    </Card>
  );
}

function PayoffChart({ sim }: { sim: Simulation }) {
  const c = useChartColors();
  const byMonth = new Map<number, { date: string; snowball?: number; avalanche?: number }>();
  for (const p of sim.snowball.timeline) {
    byMonth.set(p.month, { date: p.date, snowball: p.balance_cents });
  }
  for (const p of sim.avalanche.timeline) {
    const e = byMonth.get(p.month) ?? { date: p.date };
    e.avalanche = p.balance_cents;
    byMonth.set(p.month, e);
  }
  const data = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  return (
    <Card
      title="Balance over time"
      action={
        <LegendRow
          items={[
            { label: "Snowball", color: c.s1 },
            { label: "Avalanche", color: c.s2 }
          ]}
        />
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="date"
              tickFormatter={monthName}
              tick={{ fill: c.muted, fontSize: 12 }}
              axisLine={{ stroke: c.axis }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fill: c.muted, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => monthName(String(l))} />} />
            <Line type="monotone" dataKey="snowball" name="Snowball" stroke={c.s1} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="avalanche" name="Avalanche" stroke={c.s2} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function DebtModal({
  debt,
  onClose,
  onSaved
}: {
  debt: Debt | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(debt?.name ?? "");
  const [balance, setBalance] = useState(debt ? String(debt.balance_cents / 100) : "");
  const [apr, setApr] = useState(debt ? String(debt.apr) : "");
  const [minPay, setMinPay] = useState(debt ? String(debt.min_payment_cents / 100) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        name,
        balance_cents: Math.round(Number(balance) * 100),
        apr: Number(apr),
        min_payment_cents: Math.round(Number(minPay) * 100)
      };
      if (debt) await api.patch(`/api/debts/${debt.id}`, body);
      else await api.post("/api/debts", body);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!debt) return;
    try {
      await api.del(`/api/debts/${debt.id}`);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <Modal title={debt ? "Edit debt" : "Add debt"} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chase Visa" className="w-full" />
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Balance ($)</span>
            <Input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">APR (%)</span>
            <Input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" className="w-full" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Min payment ($)</span>
            <Input value={minPay} onChange={(e) => setMinPay(e.target.value)} inputMode="decimal" className="w-full" />
          </label>
        </div>
        <div className="flex justify-between pt-1">
          {debt ? (
            <Button variant="danger" onClick={remove}>
              <Icon name="trash" size={14} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? <Spinner /> : <Icon name="check" size={14} />} Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
