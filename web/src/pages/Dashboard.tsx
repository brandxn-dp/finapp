import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { api, useApi } from "../lib/api";
import type { Overview, RecurringItem } from "../lib/api";
import { money, moneyCompact, monthName, monthNameLong, shortDate } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Empty, Icon, Markdown, Spinner, Stat, useToast } from "../components/ui";
import { ChartTooltip, LegendRow } from "../components/charts";

export default function Dashboard() {
  const { data: ov, loading } = useApi<Overview>("/api/insights/overview");
  const { data: rec } = useApi<{ items: RecurringItem[]; monthly_total_cents: number }>(
    "/api/insights/recurring"
  );

  if (loading || !ov) {
    return (
      <div className="flex justify-center py-24 text-ink3">
        <Spinner />
      </div>
    );
  }

  const thisMonth = ov.cashflow.find((m) => m.month === ov.month);
  const hasData = ov.transactions > 0;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-0.5 text-sm text-ink2">{monthNameLong(ov.month)}</p>
        </div>
        {ov.uncategorized > 0 && (
          <Link
            to="/transactions?uncategorized=1"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink2 hover:bg-surface2"
          >
            <Icon name="alert" size={14} className="text-warn" />
            {ov.uncategorized} uncategorized
          </Link>
        )}
      </header>

      {!hasData ? (
        <Card>
          <Empty
            icon="upload"
            title="No transactions yet"
            sub={
              <>
                Import a CSV from your bank on the{" "}
                <Link className="text-accent underline" to="/transactions">
                  Transactions
                </Link>{" "}
                page, or connect SimpleFIN in{" "}
                <Link className="text-accent underline" to="/settings">
                  Settings
                </Link>{" "}
                for automatic imports.
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Net worth" value={money(ov.net_worth_cents)} sub="across all accounts" />
            <Stat
              label="Income this month"
              value={money(thisMonth?.income_cents ?? 0)}
              tone="good"
            />
            <Stat label="Spending this month" value={money(thisMonth?.expense_cents ?? 0)} />
            <Stat
              label="Recurring / month"
              value={money(rec?.monthly_total_cents ?? 0)}
              sub={`${rec?.items.length ?? 0} detected`}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <CashflowCard ov={ov} />
            <SpendingCard ov={ov} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <AiCheckin />
            <UpcomingCard items={rec?.items ?? []} />
          </div>
        </>
      )}
    </div>
  );
}

function CashflowCard({ ov }: { ov: Overview }) {
  const c = useChartColors();
  return (
    <Card title="Cash flow" className="lg:col-span-3" action={<LegendRow items={[{ label: "Income", color: c.s1 }, { label: "Spending", color: c.s2 }]} />}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ov.cashflow} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="month"
              tickFormatter={monthName}
              tick={{ fill: c.muted, fontSize: 11 }}
              axisLine={{ stroke: c.axis }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fill: c.muted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.4 }}
              content={<ChartTooltip labelFormatter={(l) => monthNameLong(String(l))} />}
            />
            <Bar dataKey="income_cents" name="Income" fill={c.s1} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="expense_cents" name="Spending" fill={c.s2} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function SpendingCard({ ov }: { ov: Overview }) {
  const c = useChartColors();
  const top = ov.spending.slice(0, 7);
  const other = ov.spending.slice(7).reduce((s, x) => s + x.total_cents, 0);
  const rows = other > 0 ? [...top, { category_id: -1, name: "Other", grp: "other", icon: "…", total_cents: other }] : top;
  const max = Math.max(1, ...rows.map((r) => r.total_cents));
  const total = ov.spending.reduce((s, x) => s + x.total_cents, 0);

  return (
    <Card title="Spending by category" className="lg:col-span-2" action={<span className="tnum text-xs text-ink3">{money(total)} total</span>}>
      {rows.length === 0 ? (
        <Empty icon="target" title="Nothing spent this month yet" />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.category_id}-${r.name}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-ink">
                  <span className="mr-1.5">{r.icon}</span>
                  {r.name}
                </span>
                <span className="tnum shrink-0 text-ink2">{money(r.total_cents)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(r.total_cents / max) * 100}%`, background: c.seq[3] }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AiCheckin() {
  const [result, setResult] = useState<{ markdown: string; disclaimer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setBusy(true);
    try {
      setResult(await api.post<{ markdown: string; disclaimer: string }>("/api/insights/advise"));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="AI check-in"
      action={
        <Button size="sm" variant="ghost" onClick={run} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="sparkle" size={14} />}
          {result ? "Regenerate" : "Generate"}
        </Button>
      }
    >
      {result ? (
        <div>
          <Markdown text={result.markdown} />
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink3">{result.disclaimer}</p>
        </div>
      ) : (
        <Empty
          icon="sparkle"
          title="Your monthly money check-in"
          sub="Claude reads your aggregated numbers (never raw transactions) and writes a short review with budgeting methods that fit them."
        />
      )}
    </Card>
  );
}

function UpcomingCard({ items }: { items: RecurringItem[] }) {
  const upcoming = useMemo(
    () => [...items].sort((a, b) => a.next_date.localeCompare(b.next_date)).slice(0, 6),
    [items]
  );
  return (
    <Card title="Upcoming recurring payments">
      {upcoming.length === 0 ? (
        <Empty
          icon="refresh"
          title="No recurring payments detected yet"
          sub="After a few months of history, subscriptions and bills show up here automatically."
        />
      ) : (
        <ul className="divide-y divide-line">
          {upcoming.map((r) => (
            <li key={r.payee_norm} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="text-base">{r.icon ?? "🔁"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{r.payee}</div>
                <div className="text-xs text-ink3">
                  {r.cadence} · next ~{shortDate(r.next_date)}
                </div>
              </div>
              <span className="tnum text-sm font-medium text-ink">{money(r.avg_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
