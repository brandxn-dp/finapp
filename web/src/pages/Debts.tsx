import { useEffect, useState } from "react";
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
import type { Debt, PayoffResult, Simulation } from "../lib/api";
import { money, moneyCompact, monthName } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Empty, Icon, Input, Modal, Spinner, useToast } from "../components/ui";
import { ChartTooltip, LegendRow } from "../components/charts";

export default function Debts() {
  const { data: debts, refetch } = useApi<Debt[]>("/api/debts");
  const [extra, setExtra] = useState("100");
  const [sim, setSim] = useState<Simulation | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [editing, setEditing] = useState<Debt | "new" | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!debts || debts.length === 0) {
      setSim(null);
      return;
    }
    const t = setTimeout(async () => {
      setSimBusy(true);
      try {
        const extraCents = Math.max(0, Math.round(Number(extra || 0) * 100));
        setSim(await api.post<Simulation>("/api/debts/simulate", { extra_cents: extraCents }));
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "bad");
      } finally {
        setSimBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debts, extra]);

  const totalDebt = (debts ?? []).reduce((s, d) => s + d.balance_cents, 0);
  const interestSaved = sim ? sim.snowball.total_interest_cents - sim.avalanche.total_interest_cents : 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Debt Planner</h1>
          <p className="mt-0.5 text-sm text-ink2">
            Compare the two most popular payoff methods against your actual debts.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Icon name="plus" size={14} /> Add debt
        </Button>
      </header>

      {!debts || debts.length === 0 ? (
        <Card>
          <Empty
            icon="card"
            title="No debts tracked"
            sub="Add each credit card or loan with its balance, APR, and minimum payment — the planner does the rest."
          />
        </Card>
      ) : (
        <>
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
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
              <span className="text-sm text-ink2">Extra payment per month:</span>
              <span className="text-sm text-ink3">$</span>
              <Input
                value={extra}
                onChange={(e) => setExtra(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-24"
                inputMode="numeric"
              />
              {simBusy && <Spinner className="text-ink3" />}
            </div>
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
                    interestSaved > 0
                      ? `saves ${money(interestSaved)} in interest vs snowball`
                      : interestSaved === 0
                        ? "identical to snowball for your debts"
                        : undefined
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
          <div className="tnum mt-0.5 text-lg font-semibold text-ink">{monthName(r.debt_free_date)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink3">Duration</div>
          <div className="tnum mt-0.5 text-lg font-semibold text-ink">{dur}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink3">Interest</div>
          <div className="tnum mt-0.5 text-lg font-semibold text-ink">{money(r.total_interest_cents)}</div>
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
  // Merge the two timelines into one series per month index
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
              tick={{ fill: c.muted, fontSize: 11 }}
              axisLine={{ stroke: c.axis }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fill: c.muted, fontSize: 11 }}
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
