import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api";
import type { Account, Overview, RecurringItem } from "../lib/api";
import { money } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Card, Empty, PageHeader, Spinner } from "../components/ui";
import { LegendRow } from "../components/charts";

export default function Savings() {
  const { data: ov, loading } = useApi<Overview>("/api/insights/overview");
  const { data: rec, refetch: refetchRec } = useApi<{ items: RecurringItem[]; monthly_total_cents: number }>(
    "/api/insights/recurring"
  );

  if (loading || !ov) {
    return (
      <div className="flex justify-center py-24 text-ink3">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Savings" sub="Popular saving methods, measured against your real numbers." />

      <div className="grid gap-5 lg:grid-cols-2">
        <FiftyThirtyTwentyCard ov={ov} />
        <EmergencyFundCard ov={ov} />
      </div>

      <SavingsAccountsCard />

      <SubscriptionAudit rec={rec} onChanged={refetchRec} />

      <div className="grid gap-4 md:grid-cols-3">
        <MethodCard
          title="50/30/20 rule"
          body="Aim for roughly 50% of take-home income on needs, 30% on wants, and 20% toward savings and extra debt payments. The chart above shows where you stand — shifting even 5% from wants to savings compounds fast."
        />
        <MethodCard
          title="Pay yourself first"
          body="Move a fixed amount to savings the day income lands, before any spending — automate it as a scheduled transfer. Budgets tend to fill whatever's left, so make savings leave first."
        />
        <MethodCard
          title="Snowball vs avalanche"
          body={
            <>
              Two proven debt-payoff methods: snowball clears the smallest balances first for momentum;
              avalanche targets the highest APR to minimize interest. Compare both with your actual debts in the{" "}
              <Link to="/debts" className="text-accent underline">Debt Planner</Link>.
            </>
          }
        />
      </div>

      <p className="text-[11px] text-ink3">
        Educational information about common budgeting methods — not professional financial advice.
      </p>
    </div>
  );
}

function FiftyThirtyTwentyCard({ ov }: { ov: Overview }) {
  const c = useChartColors();
  const f = ov.fifty_thirty_twenty;
  if (!f || f.avg_income_cents <= 0) {
    return (
      <Card title="50 / 30 / 20 check">
        <Empty
          icon="target"
          title="Not enough history yet"
          sub="Once you have a full month of categorized income and spending, your needs/wants/savings split shows up here."
        />
      </Card>
    );
  }
  const segs = [
    { label: "Needs", pct: f.needs_pct, cents: f.needs_cents, color: c.s1, target: 50 },
    { label: "Wants", pct: f.wants_pct, cents: f.wants_cents, color: c.s2, target: 30 },
    { label: "Savings", pct: f.savings_pct, cents: f.savings_cents, color: c.s3, target: 20 }
  ];
  return (
    <Card
      title="50 / 30 / 20 check"
      action={<LegendRow items={segs.map((s) => ({ label: s.label, color: s.color }))} />}
    >
      <p className="mb-3 text-xs text-ink3">
        Average of your last {f.months_sampled} full months · income {money(f.avg_income_cents)}/mo
      </p>
      <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-md">
        {segs.map((s) => (
          <div
            key={s.label}
            className="h-full rounded-[3px]"
            style={{ width: `${Math.max(2, s.pct)}%`, background: s.color }}
            title={`${s.label}: ${s.pct}%`}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {segs.map((s) => {
          const over = s.label !== "Savings" ? s.pct > s.target : s.pct < s.target;
          return (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tnum text-ink2">
                {money(s.cents)} · <span className={`font-semibold ${over ? "text-warn" : "text-ink"}`}>{s.pct}%</span>
                <span className="text-ink3"> / target {s.target}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EmergencyFundCard({ ov }: { ov: Overview }) {
  const c = useChartColors();
  const ef = ov.emergency_fund;
  const pct6 = Math.min(100, (ef.liquid_savings_cents / Math.max(1, ef.target6_cents)) * 100);
  const pos3 = ef.target6_cents > 0 ? 50 : 0; // 3-month marker sits halfway to the 6-month target
  return (
    <Card title="Emergency fund">
      {ef.monthly_essentials_cents <= 0 ? (
        <Empty
          icon="wallet"
          title="Waiting on spending history"
          sub="Your emergency-fund target is based on your average monthly essential spending."
        />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="tnum text-3xl font-semibold text-ink">{ef.months_covered}</span>
            <span className="text-sm text-ink2">months of essentials covered</span>
          </div>
          <p className="mt-1 text-xs text-ink3">
            {money(ef.liquid_savings_cents)} liquid vs {money(ef.monthly_essentials_cents)}/mo of essential spending
          </p>
          <div className="relative mt-4 h-2 rounded-full bg-surface2">
            <div className="h-full rounded-full" style={{ width: `${pct6}%`, background: c.seq[3] }} />
            <div className="absolute top-[-3px] h-3.5 w-0.5 rounded bg-ink3" style={{ left: `${pos3}%` }} title="3-month target" />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-ink3">
            <span>$0</span>
            <span>3 mo · {money(ef.target3_cents)}</span>
            <span>6 mo · {money(ef.target6_cents)}</span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink2">
            A common guideline is 3–6 months of essential expenses in an accessible account.{" "}
            {ef.months_covered >= 6
              ? "You're past the 6-month mark — extra savings can usually work harder elsewhere."
              : ef.months_covered >= 3
                ? "You've cleared the 3-month mark — building toward 6 adds resilience."
                : "Building toward the 3-month mark is the usual first milestone."}
          </p>
        </>
      )}
    </Card>
  );
}

const LIQUID_TYPES = new Set(["checking", "savings", "cash"]);

/**
 * Auto-identifies which loaded accounts count as savings: liquid accounts
 * (checking, savings, cash) feed the emergency-fund math; credit, loan, and
 * investment accounts are shown but excluded.
 */
function SavingsAccountsCard() {
  const { data: accounts } = useApi<Account[]>("/api/accounts");
  const rows = (accounts ?? []).filter((a) => !a.archived);
  const liquid = rows.filter((a) => LIQUID_TYPES.has(a.type));
  const other = rows.filter((a) => !LIQUID_TYPES.has(a.type));
  const liquidTotal = liquid.reduce((s, a) => s + a.balance_cents, 0);

  return (
    <Card
      title="Where your savings live"
      action={liquid.length > 0 ? <span className="tnum text-xs text-ink3">{money(liquidTotal)} liquid</span> : undefined}
    >
      {rows.length === 0 ? (
        <Empty
          icon="wallet"
          title="No accounts loaded yet"
          sub="Sync SimpleFIN or add accounts in Settings — they're classified automatically (savings, checking, credit, loan…) from their names."
        />
      ) : (
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div>
            <div className="smallcaps mb-1.5 text-[11px] font-medium text-good">Counted as savings</div>
            {liquid.length === 0 ? (
              <p className="text-xs text-ink3">No liquid accounts — check account types in Settings.</p>
            ) : (
              liquid.map((a) => (
                <div key={a.id} className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0">
                  <span className="min-w-0 truncate text-ink">
                    {a.name}
                    <span className="ml-1.5 text-xs text-ink3">{a.type}</span>
                  </span>
                  <span className="tnum shrink-0 pl-3 text-ink2">{money(a.balance_cents)}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="smallcaps mb-1.5 text-[11px] font-medium text-ink3">Not counted (debt, invested & retirement)</div>
            {other.length === 0 ? (
              <p className="text-xs text-ink3">None.</p>
            ) : (
              other.map((a) => (
                <div key={a.id} className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-0">
                  <span className="min-w-0 truncate text-ink">
                    {a.name}
                    <span className="ml-1.5 text-xs text-ink3">
                      {a.type === "retirement" ? "retirement 🔒" : a.type}
                    </span>
                  </span>
                  <span className={`tnum shrink-0 pl-3 ${a.balance_cents < 0 ? "text-bad" : "text-ink2"}`}>
                    {money(a.balance_cents)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink3">
        401k/Roth/IRA accounts are marked 🔒 retirement — early withdrawals carry penalties, so they never count
        toward your emergency fund. Types are auto-detected from account names — fix any misclassification in
        Settings → Accounts.
      </p>
    </Card>
  );
}

function SubscriptionAudit({
  rec,
  onChanged
}: {
  rec: { items: RecurringItem[]; monthly_total_cents: number } | null;
  onChanged: () => void;
}) {
  const items = (rec?.items ?? []).filter((r) => !r.ignored);
  return (
    <Card
      title="Subscription audit"
      action={
        items.length > 0 ? (
          <span className="tnum text-xs text-ink3">≈ {money(rec!.monthly_total_cents)}/mo total</span>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <Empty
          icon="refresh"
          title="No recurring payments detected yet"
          sub="With a few months of history, detected subscriptions and bills appear here — a periodic audit is one of the easiest ways to free up cash."
        />
      ) : (
        <>
          <p className="mb-3 text-xs text-ink3">
            Detected from your payment patterns. Anything here you no longer use is the easiest money you'll ever save.
          </p>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {items.map((r) => (
              <div key={r.payee_norm} className="group flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                <span className="min-w-0 truncate text-ink">
                  <span className="mr-1.5">{r.icon ?? "🔁"}</span>
                  {r.payee}
                  <span className="ml-1.5 text-xs text-ink3">{r.cadence}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 pl-3">
                  <span className="tnum font-medium text-ink">{money(r.avg_cents)}</span>
                  <button
                    className="hidden text-ink3 hover:text-bad group-hover:inline"
                    title="Not actually a bill — remove from all calculations"
                    onClick={async () => {
                      await api.put("/api/recurring/override", { payee_norm: r.payee_norm, ignored: true });
                      onChanged();
                    }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function MethodCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-ink2">{body}</p>
    </Card>
  );
}
