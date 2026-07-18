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
import type { Account, Overview, RecurringItem, TxnPage } from "../lib/api";
import { money, moneyCompact, monthName, monthNameLong, shortDate } from "../lib/format";
import { useChartColors } from "../lib/theme";
import {
  Button,
  Card,
  Empty,
  Icon,
  Markdown,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  useToast
} from "../components/ui";
import { ChartTooltip, LegendRow } from "../components/charts";

type Popup = "networth" | "income" | "spending" | "recurring" | null;

export default function Dashboard() {
  const { data: ov, loading } = useApi<Overview>("/api/insights/overview");
  const { data: rec, refetch: refetchRec } = useApi<{ items: RecurringItem[]; monthly_total_cents: number }>(
    "/api/insights/recurring"
  );
  const [popup, setPopup] = useState<Popup>(null);

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
      <PageHeader
        title="Dashboard"
        sub={monthNameLong(ov.month)}
        action={
          ov.uncategorized > 0 ? (
            <Link
              to="/transactions?uncategorized=1"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink2 hover:bg-surface2"
            >
              <Icon name="alert" size={14} className="text-warn" />
              {ov.uncategorized} uncategorized
            </Link>
          ) : undefined
        }
      />

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
            <Stat
              label="Net worth"
              value={money(ov.net_worth_cents)}
              sub="across all accounts — click to see why"
              onClick={() => setPopup("networth")}
            />
            <Stat
              label="Income this month"
              value={money(thisMonth?.income_cents ?? 0)}
              tone="good"
              sub="salary & income categories only — click for sources"
              onClick={() => setPopup("income")}
            />
            <Stat
              label="Spending this month"
              value={money(thisMonth?.expense_cents ?? 0)}
              sub="click for where it went"
              onClick={() => setPopup("spending")}
            />
            <Stat
              label="Recurring / month"
              value={money(rec?.monthly_total_cents ?? 0)}
              sub={`${rec?.items.length ?? 0} detected — click to review`}
              onClick={() => setPopup("recurring")}
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

      {popup === "networth" && <NetWorthModal total={ov.net_worth_cents} onClose={() => setPopup(null)} />}
      {popup === "income" && <FlowModal flow="in" month={ov.month} onClose={() => setPopup(null)} />}
      {popup === "spending" && <SpendingModal ov={ov} onClose={() => setPopup(null)} />}
      {popup === "recurring" && (
        <RecurringModal items={rec?.items ?? []} onChanged={refetchRec} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}

// ---------------- Stat detail popups ----------------

const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  investment: "Investment",
  retirement: "Retirement (401k/IRA)",
  loan: "Loan",
  cash: "Cash",
  other: "Other"
};

function NetWorthModal({ total, onClose }: { total: number; onClose: () => void }) {
  const { data: accounts } = useApi<Account[]>("/api/accounts");
  const rows = (accounts ?? []).filter((a) => !a.archived);
  const positive = rows.filter((a) => a.balance_cents >= 0);
  const negative = rows.filter((a) => a.balance_cents < 0);
  return (
    <Modal title="Why your net worth is what it is" onClose={onClose}>
      {!accounts ? (
        <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
      ) : (
        <div className="space-y-1">
          <p className="mb-2 text-xs text-ink3">
            Net worth is simply every account balance added together — assets minus what you owe.
          </p>
          {[...positive, ...negative].map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
              <span className="min-w-0 truncate text-ink">
                {a.name}
                <span className="ml-2 text-xs text-ink3">{TYPE_LABELS[a.type] ?? a.type}</span>
              </span>
              <span className={`tnum shrink-0 pl-3 font-medium ${a.balance_cents < 0 ? "text-bad" : "text-ink"}`}>
                {money(a.balance_cents)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 text-sm font-semibold">
            <span className="text-ink">Net worth</span>
            <span className="tnum font-display text-lg text-ink">{money(total)}</span>
          </div>
          <p className="pt-1 text-[11px] text-ink3">
            Balances come from SimpleFIN syncs or the manual balances you set in Settings → Accounts.
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Lists this month's real income — transactions in income-kind categories only. */
function FlowModal({ flow, month, onClose }: { flow: "in"; month: string; onClose: () => void }) {
  const { data } = useApi<TxnPage>(`/api/transactions?month=${month}&flow=${flow}&kind=income&limit=300`);
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, t) => s + t.amount_cents, 0);
  return (
    <Modal title="Where the money came from" onClose={onClose}>
      {!data ? (
        <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty
          icon="wallet"
          title="No income recorded this month yet"
          sub="Only transactions categorized as Salary or Other Income count as income — transfers never do. Run Auto-categorize if deposits are still uncategorized."
        />
      ) : (
        <div className="max-h-[55vh] space-y-1 overflow-y-auto">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
              <span className="min-w-0">
                <span className="block truncate text-ink">{t.payee || "(no payee)"}</span>
                <span className="text-xs text-ink3">
                  {shortDate(t.date)} · {t.account_name}
                  {t.category_name ? ` · ${t.category_icon} ${t.category_name}` : ""}
                </span>
              </span>
              <span className="tnum shrink-0 pl-3 font-medium text-good">+{money(t.amount_cents)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 text-sm font-semibold">
            <span className="text-ink">Total income</span>
            <span className="tnum font-display text-lg text-good">{money(total)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Category breakdown + individual spending transactions for the month. */
function SpendingModal({ ov, onClose }: { ov: Overview; onClose: () => void }) {
  const { data } = useApi<TxnPage>(`/api/transactions?month=${ov.month}&flow=out&exclude_transfers=1&limit=300`);
  const rows = [...(data?.rows ?? [])].sort((a, b) => a.amount_cents - b.amount_cents);
  return (
    <Modal title="Where the money went" onClose={onClose}>
      <div className="max-h-[60vh] overflow-y-auto">
        {ov.spending.length > 0 && (
          <>
            <div className="smallcaps mb-1.5 text-[11px] font-medium text-ink3">By category</div>
            <div className="mb-3 space-y-1">
              {ov.spending.map((s) => (
                <div key={`${s.category_id}`} className="flex items-center justify-between py-0.5 text-sm">
                  <span className="text-ink">
                    <span className="mr-1.5">{s.icon}</span>
                    {s.name}
                  </span>
                  <span className="tnum text-ink2">{money(s.total_cents)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="smallcaps mb-1.5 border-t border-line pt-2 text-[11px] font-medium text-ink3">
          Largest transactions first
        </div>
        {!data ? (
          <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
        ) : (
          rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
              <span className="min-w-0">
                <span className="block truncate text-ink">{t.payee || "(no payee)"}</span>
                <span className="text-xs text-ink3">
                  {shortDate(t.date)}
                  {t.category_name ? ` · ${t.category_icon} ${t.category_name}` : " · uncategorized"}
                </span>
              </span>
              <span className="tnum shrink-0 pl-3 font-medium text-ink">{money(t.amount_cents)}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function RecurringModal({
  items,
  onChanged,
  onClose
}: {
  items: RecurringItem[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const toggle = async (r: RecurringItem) => {
    try {
      await api.put("/api/recurring/override", { payee_norm: r.payee_norm, ignored: !r.ignored });
      toast(r.ignored ? `${r.payee} restored as a bill.` : `${r.payee} won't be treated as a bill anymore.`, "info");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };
  return (
    <Modal title="What counts as recurring" onClose={onClose}>
      <p className="mb-2 text-xs text-ink3">
        A merchant is deemed recurring when it charges you at a steady rhythm (weekly to yearly) with a
        consistent amount, at least three times. If the detector is wrong, mark it — ignored items drop out of
        totals, upcoming payments, and the payoff planner.
      </p>
      {items.length === 0 ? (
        <Empty icon="refresh" title="Nothing recurring detected yet" />
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          {items.map((r) => (
            <div
              key={r.payee_norm}
              className={`flex items-center justify-between gap-2 border-b border-line py-2 text-sm last:border-0 ${r.ignored ? "opacity-50" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">
                  <span className="mr-1.5">{r.icon ?? "🔁"}</span>
                  {r.payee}
                  {r.ignored && <span className="ml-1.5 text-[10px] uppercase tracking-wider text-ink3">ignored</span>}
                </span>
                <span className="text-xs text-ink3">
                  {r.cadence} · seen {r.occurrences}× · next ~{shortDate(r.next_date)}
                </span>
              </span>
              <span className="tnum shrink-0 font-medium text-ink">{money(r.avg_cents)}</span>
              <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                {r.ignored ? "It's a bill" : "Not a bill"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------- Cards ----------------

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
              tick={{ fill: c.muted, fontSize: 12 }}
              axisLine={{ stroke: c.axis }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fill: c.muted, fontSize: 12 }}
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
          {rows.map((r) => {
            const href =
              r.category_id === -1
                ? null
                : r.category_id === null
                  ? `/transactions?uncategorized=1&month=${ov.month}`
                  : `/transactions?category_id=${r.category_id}&month=${ov.month}`;
            const body = (
              <>
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
              </>
            );
            return (
              <li key={`${r.category_id}-${r.name}`}>
                {href ? (
                  <Link to={href} className="-mx-2 block rounded-lg px-2 py-0.5 hover:bg-surface2/70" title="See these transactions">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
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
          sub="Your AI provider reads aggregated numbers (never raw transactions) and writes a short review with budgeting methods that fit them. Configure the provider in Settings."
        />
      )}
    </Card>
  );
}

function UpcomingCard({ items }: { items: RecurringItem[] }) {
  const upcoming = useMemo(
    () =>
      items
        .filter((r) => !r.ignored)
        .sort((a, b) => a.next_date.localeCompare(b.next_date))
        .slice(0, 6),
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
