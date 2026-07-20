import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useApi } from "../lib/api";
import type { FireStats } from "../lib/api";
import { money, moneyCompact, moneyWhole } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Card, Icon, Input, Markdown, PageHeader, Spinner } from "../components/ui";
import { ChartTooltip } from "../components/charts";

// ---------------- FIRE math ----------------

/** Years for a portfolio to grow from P0 to target with yearly contributions. */
function yearsToTarget(p0: number, annual: number, r: number, target: number): number {
  if (target <= 0 || p0 >= target) return 0;
  let bal = p0;
  for (let y = 1; y <= 100; y++) {
    bal = bal * (1 + r) + annual;
    if (bal >= target) return y;
  }
  return Infinity;
}

/** Classic "years to FI from zero" — depends only on savings rate and return. */
function yearsFromZero(savingsRate: number, r: number): number {
  if (savingsRate >= 1) return 0;
  if (savingsRate <= 0) return Infinity;
  // Need 25× annual spending; spending = (1−s) of income, saving = s of income.
  const ratio = (25 * (1 - savingsRate)) / savingsRate;
  return Math.log(1 + r * ratio) / Math.log(1 + r);
}

const yrs = (n: number) => (Number.isFinite(n) ? `${Math.ceil(n)}` : "100+");

interface Knobs {
  returnPct: number;
  withdrawalPct: number;
  currentAge: number;
  retireAge: number;
}
const DEFAULT_KNOBS: Knobs = { returnPct: 5, withdrawalPct: 4, currentAge: 35, retireAge: 65 };

function loadKnobs(): Knobs {
  try {
    return { ...DEFAULT_KNOBS, ...JSON.parse(localStorage.getItem("finapp-fire") || "{}") };
  } catch {
    return { ...DEFAULT_KNOBS };
  }
}

export default function Fire() {
  const { data, loading } = useApi<FireStats>("/api/insights/fire");
  const c = useChartColors();
  const [knobs, setKnobs] = useState<Knobs>(loadKnobs);
  const setKnob = (k: keyof Knobs, v: number) => {
    setKnobs((prev) => {
      const next = { ...prev, [k]: v };
      localStorage.setItem("finapp-fire", JSON.stringify(next));
      return next;
    });
  };

  // Values default to your data but can be overridden for what-ifs (in cents).
  const defaults = useMemo(() => {
    const inc = (data?.avg_income_cents ?? 0) * 12;
    const exp = (data?.avg_spending_cents ?? 0) * 12;
    const b = data?.balances;
    const nest = b ? b.savings + b.investment + b.retirement + b.cash : 0;
    return { inc, exp, nest };
  }, [data]);
  const [ov, setOv] = useState<{ inc?: number; exp?: number; nest?: number }>({});
  const incomeCents = ov.inc ?? defaults.inc;
  const expensesCents = ov.exp ?? defaults.exp;
  const investedCents = ov.nest ?? defaults.nest;

  const r = knobs.returnPct / 100;
  const wr = knobs.withdrawalPct / 100;

  const m = useMemo(() => {
    const fireNumber = wr > 0 ? Math.round(expensesCents / wr) : 0;
    const annualSavings = Math.max(0, incomeCents - expensesCents);
    const savingsRate = incomeCents > 0 ? annualSavings / incomeCents : 0;
    const progress = fireNumber > 0 ? Math.min(1, investedCents / fireNumber) : 0;
    const years = yearsToTarget(investedCents, annualSavings, r, fireNumber);
    const gap = Math.max(knobs.retireAge - knobs.currentAge, 0);
    const coastNumber = Math.round(fireNumber / Math.pow(1 + r, gap));
    const coastAchieved = investedCents >= coastNumber && gap > 0;
    const alreadyFI = fireNumber > 0 && investedCents >= fireNumber;
    return {
      fireNumber,
      annualSavings,
      savingsRate,
      progress,
      years,
      coastNumber,
      coastAchieved,
      alreadyFI,
      leanNumber: Math.round((expensesCents * 0.75) / (wr || 1)),
      fatNumber: Math.round((expensesCents * 1.5) / (wr || 1)),
      baristaNumber: Math.round(fireNumber / 2)
    };
  }, [expensesCents, incomeCents, investedCents, r, wr, knobs.currentAge, knobs.retireAge]);

  // Portfolio projection for the chart.
  const projection = useMemo(() => {
    const span = Number.isFinite(m.years) ? Math.min(Math.ceil(m.years) + 3, 50) : 45;
    const out: Array<{ age: number; value: number; goal: number }> = [];
    let bal = investedCents;
    for (let y = 0; y <= span; y++) {
      out.push({ age: knobs.currentAge + y, value: Math.round(bal), goal: m.fireNumber });
      bal = bal * (1 + r) + m.annualSavings;
    }
    return out;
  }, [investedCents, m.annualSavings, m.years, m.fireNumber, r, knobs.currentAge]);

  const fiAge = Number.isFinite(m.years) ? knobs.currentAge + Math.ceil(m.years) : null;
  const pct = Math.round(m.progress * 100);

  const verdict = (() => {
    if (m.alreadyFI)
      return `You're financially independent — your invested assets already cover your spending at a ${knobs.withdrawalPct}% withdrawal rate.`;
    if (m.coastAchieved)
      return `You've reached Coast FIRE. Left untouched, your investments should grow to your FIRE number by age ${knobs.retireAge} — you now only need to cover your current spending.`;
    if (m.annualSavings <= 0)
      return `You're not saving anything right now, so the clock toward FI hasn't started. Add income or trim spending to begin.`;
    return `At a ${Math.round(m.savingsRate * 100)}% savings rate, you're on track to reach financial independence in about ${yrs(m.years)} years${fiAge ? ` — around age ${fiAge}` : ""}.`;
  })();

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20 text-ink3">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="FIRE"
        sub="Financial Independence, Retire Early — your path, from your own numbers"
      />

      {!data?.data_ok && (
        <Card>
          <div className="flex items-start gap-3 text-sm">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-ink2">
              We couldn't find enough categorized income and spending yet, so the numbers below start from zero.
              Import or sync transactions and categorize them (or just type your figures into the assumptions below)
              and this whole page fills in from your real finances.
            </p>
          </div>
        </Card>
      )}

      {/* Hero: FIRE number + progress + verdict */}
      <Card>
        <div className="grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <div className="smallcaps text-[12px] font-medium text-ink3">Your FIRE number</div>
            <div className="tnum font-display mt-1 text-[40px] font-bold leading-none text-ink">
              {moneyWhole(m.fireNumber)}
            </div>
            <p className="mt-1 text-xs text-ink3">
              {moneyWhole(expensesCents)}/yr of spending ÷ {knobs.withdrawalPct}% safe withdrawal = the portfolio that
              could fund your life indefinitely.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent-soft/50 px-3 py-2.5 text-sm text-ink">
              <Icon name="flame" size={18} className="shrink-0 text-accent" />
              <span>{verdict}</span>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-ink2">Progress</span>
              <span className="tnum font-semibold text-ink">{pct}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: c.bar }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-ink3">
              <span>{moneyWhole(investedCents)} invested</span>
              <span>{moneyWhole(m.fireNumber)}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <MiniStat label="Time to FI" value={m.alreadyFI ? "Done" : `${yrs(m.years)} yrs`} />
              <MiniStat label="At age" value={m.alreadyFI ? "—" : fiAge ? String(fiAge) : "—"} />
              <MiniStat label="Savings rate" value={`${Math.round(m.savingsRate * 100)}%`} accent />
            </div>
          </div>
        </div>
      </Card>

      {/* Projection chart */}
      <Card title="Portfolio projection" action={<span className="text-xs text-ink3">assuming {knobs.returnPct}% real return</span>}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projection} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="fireFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.s1} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c.s1} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis
                dataKey="age"
                tick={{ fill: c.muted, fontSize: 12 }}
                axisLine={{ stroke: c.axis }}
                tickLine={false}
                tickFormatter={(a: number) => `${a}`}
                minTickGap={28}
              />
              <YAxis
                tickFormatter={(v: number) => moneyCompact(v)}
                tick={{ fill: c.muted, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<ChartTooltip labelFormatter={(l) => `Age ${l}`} />} />
              <ReferenceLine y={m.fireNumber} stroke={c.s2} strokeDasharray="5 4" strokeWidth={1.5} />
              <Area type="monotone" dataKey="value" name="Portfolio" stroke={c.s1} strokeWidth={2} fill="url(#fireFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink3">
          Dashed line is your FIRE number ({moneyWhole(m.fireNumber)}). The curve grows your{" "}
          {moneyWhole(investedCents)} of invested assets plus {moneyWhole(m.annualSavings)}/yr of new savings at{" "}
          {knobs.returnPct}% real return.
        </p>
      </Card>

      {/* Assumptions */}
      <Card title="Your numbers & assumptions" collapsible defaultOpen>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField label="Annual spending" cents={expensesCents} onChange={(v) => setOv((o) => ({ ...o, exp: v }))} hint="from your categorized spending" />
          <MoneyField label="Annual income" cents={incomeCents} onChange={(v) => setOv((o) => ({ ...o, inc: v }))} hint="take-home income" />
          <MoneyField label="Invested assets now" cents={investedCents} onChange={(v) => setOv((o) => ({ ...o, nest: v }))} hint="savings + investments + retirement" />
          <NumField label="Real return %" value={knobs.returnPct} onChange={(v) => setKnob("returnPct", v)} step={0.5} hint="growth after inflation (~5% typical)" />
          <NumField label="Withdrawal rate %" value={knobs.withdrawalPct} onChange={(v) => setKnob("withdrawalPct", v)} step={0.25} hint="4% is the classic safe rate" />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Current age" value={knobs.currentAge} onChange={(v) => setKnob("currentAge", v)} step={1} />
            <NumField label="Retire by" value={knobs.retireAge} onChange={(v) => setKnob("retireAge", v)} step={1} hint="for Coast FIRE" />
          </div>
        </div>
        {(ov.inc !== undefined || ov.exp !== undefined || ov.nest !== undefined) && (
          <button className="mt-3 text-xs text-accent hover:underline" onClick={() => setOv({})}>
            ↺ Reset to my actual figures
          </button>
        )}
      </Card>

      {/* Flavors of FIRE */}
      <Card title="Flavors of FIRE">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FlavorCard
            title="Lean FIRE"
            number={m.leanNumber}
            achieved={investedCents >= m.leanNumber}
            desc="A trimmed-down budget (~25% less). Smaller target, frugal lifestyle."
          />
          <FlavorCard
            title="Regular FIRE"
            number={m.fireNumber}
            achieved={m.alreadyFI}
            desc="Your current spending, funded indefinitely at your withdrawal rate."
            highlight
          />
          <FlavorCard
            title="Fat FIRE"
            number={m.fatNumber}
            achieved={investedCents >= m.fatNumber}
            desc="A roomier lifestyle (~50% more spending). Bigger target, more comfort."
          />
          <FlavorCard
            title="Coast FIRE"
            number={m.coastNumber}
            achieved={m.coastAchieved}
            desc={`Enough that growth alone reaches your number by age ${knobs.retireAge} — no more saving required.`}
          />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface2/40 px-3 py-2.5 text-xs text-ink2">
          <Icon name="wallet" size={15} className="mt-0.5 shrink-0 text-ink3" />
          <span>
            <strong className="text-ink">Barista FIRE</strong> sits between Coast and full FIRE: light or part-time
            work covers some expenses (and often health insurance), so your portfolio can be smaller or keep growing
            untouched. Cover half your spending that way and your target roughly halves to{" "}
            <span className="tnum font-medium text-ink">{moneyWhole(m.baristaNumber)}</span>.
          </span>
        </div>
      </Card>

      {/* Savings rate is the lever */}
      <Card title="Why savings rate is everything">
        <p className="mb-3 text-sm text-ink2">
          Starting from zero, the years it takes to reach financial independence depend almost entirely on the share of
          income you save — not how much you earn. At {knobs.returnPct}% real return:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink3">
                <th className="py-2 pr-3 font-medium">Savings rate</th>
                <th className="py-2 pr-3 font-medium">Years to FI</th>
                <th className="py-2 font-medium">Working years saved vs. 10%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((s) => {
                const y = yearsFromZero(s, r);
                const base = yearsFromZero(0.1, r);
                const isYou = Math.abs(s - m.savingsRate) < 0.05;
                return (
                  <tr key={s} className={isYou ? "bg-accent/8" : ""}>
                    <td className="py-2 pr-3 text-ink">
                      {Math.round(s * 100)}%{isYou && <span className="ml-2 text-xs font-medium text-accent">you</span>}
                    </td>
                    <td className="tnum py-2 pr-3 font-medium text-ink">{yrs(y)}</td>
                    <td className="tnum py-2 text-ink3">{s === 0.1 ? "—" : `${yrs(base - y)} fewer`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Education */}
      <Card title="What is FIRE?" collapsible defaultOpen={false}>
        <Markdown
          text={`**FIRE** stands for *Financial Independence, Retire Early*. The goal is to build enough invested assets that their growth and withdrawals cover your living costs, so paid work becomes optional.

### The 4% rule
Decades of market history suggest you can withdraw about **4% of a diversified portfolio** in year one, adjust for inflation after, and very likely never run out over a 30+ year retirement. Flip that around and your target is **25× your annual spending** (because 1 ÷ 0.04 = 25). Want a bigger safety margin? Use 3.5% (≈29×) or 3% (≈33×).

### The one lever that matters: savings rate
Your **savings rate** — the share of take-home income you don't spend — sets your timeline. A higher rate does double duty: it grows your nest egg faster *and* shrinks the number you need (because you live on less). Someone saving 50% reaches FI in roughly 17 years; at 75%, about 7.

### Flavors
- **Lean FIRE** — a lean, frugal budget, so a smaller target.
- **Fat FIRE** — a generous lifestyle, so a larger target.
- **Coast FIRE** — you've invested enough that compound growth alone will reach your number by traditional retirement age; you only need to cover today's expenses, not save more.
- **Barista FIRE** — part-time or light work bridges the gap (and often provides benefits) so your portfolio can be smaller or grow untouched.

### How to move faster
- Widen the gap between income and spending (the savings rate).
- Invest the difference in low-cost, diversified funds and leave it to compound.
- Knock out high-interest debt first — see the Debt Planner.
- Keep an emergency fund so you never sell investments at the wrong time — see Savings.`}
        />
      </Card>

      <p className="text-[11px] text-ink3">
        Educational projections using common FIRE rules of thumb — not professional financial advice. Real markets vary
        year to year; the 4% rule and a fixed real return are simplifications. Assumptions above are yours to adjust.
      </p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface2/40 px-2 py-1.5">
      <div className="smallcaps text-[10px] text-ink3">{label}</div>
      <div className={`tnum text-[17px] font-semibold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function FlavorCard({
  title,
  number,
  achieved,
  desc,
  highlight
}: {
  title: string;
  number: number;
  achieved: boolean;
  desc: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-3 ${highlight ? "border-accent/40 bg-accent-soft/30" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display smallcaps text-sm font-semibold text-ink">{title}</span>
        {achieved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">
            <Icon name="check" size={10} /> reached
          </span>
        )}
      </div>
      <div className="tnum font-display mt-1 text-[22px] font-semibold text-ink">{moneyWhole(number)}</div>
      <p className="mt-1 text-xs leading-snug text-ink3">{desc}</p>
    </div>
  );
}

function MoneyField({
  label,
  cents,
  onChange,
  hint
}: {
  label: string;
  cents: number;
  onChange: (cents: number) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink2">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-ink3">$</span>
        <Input
          value={Math.round(cents / 100)}
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)) * 100)}
          inputMode="numeric"
          className="w-full pl-6"
        />
      </div>
      {hint && <span className="mt-0.5 block text-[11px] text-ink3">{hint}</span>}
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
  hint
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink2">{label}</span>
      <Input
        type="number"
        value={value}
        step={step}
        min={0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full"
      />
      {hint && <span className="mt-0.5 block text-[11px] text-ink3">{hint}</span>}
    </label>
  );
}
