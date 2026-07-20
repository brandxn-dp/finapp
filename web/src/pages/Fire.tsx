import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useApi } from "../lib/api";
import type { FireStats } from "../lib/api";
import { moneyCompact, moneyWhole } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Card, Icon, Input, Markdown, PageHeader, Spinner } from "../components/ui";
import { ChartTooltip } from "../components/charts";

// ---------------- FIRE math ----------------

/** Years for a portfolio to grow from p0 to target with yearly contributions. */
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
  const ratio = (25 * (1 - savingsRate)) / savingsRate;
  return Math.log(1 + r * ratio) / Math.log(1 + r);
}

/** Monthly contribution needed to reach a target in `years` given growth. */
function monthlyToReach(target: number, p0: number, r: number, years: number): number {
  if (years <= 0) return target > p0 ? Infinity : 0;
  const grown = p0 * Math.pow(1 + r, years);
  if (grown >= target) return 0; // growth alone gets there
  const factor = (Math.pow(1 + r, years) - 1) / r;
  return (target - grown) / factor / 12;
}

interface ProjPoint {
  age: number;
  saving: number | null;
  retired: number | null;
}
/**
 * Two-phase life projection: grow savings while working, then live off the pot
 * after the retirement age. Returns the yearly balances plus the age you hit FI
 * and the age the money runs out (if it does).
 */
function buildProjection(o: {
  p0: number;
  annualContribution: number;
  annualSpending: number;
  r: number;
  currentAge: number;
  retireAge: number;
  horizon: number;
  fireNumber: number;
}) {
  const data: ProjPoint[] = [];
  let bal = o.p0;
  let fiAge: number | null = null;
  let depletionAge: number | null = null;
  let balAtRetire = o.p0;
  for (let age = o.currentAge; age <= o.horizon; age++) {
    const working = age < o.retireAge;
    const v = Math.round(bal);
    data.push({ age, saving: age <= o.retireAge ? v : null, retired: age >= o.retireAge ? v : null });
    if (age === o.retireAge) balAtRetire = bal;
    if (fiAge === null && bal >= o.fireNumber && o.fireNumber > 0) fiAge = age;
    if (!working && bal <= 0 && depletionAge === null) depletionAge = age;
    bal = working ? bal * (1 + o.r) + o.annualContribution : Math.max(0, bal * (1 + o.r) - o.annualSpending);
  }
  return { data, fiAge, depletionAge, balAtRetire };
}

const yrs = (n: number) => (Number.isFinite(n) ? `${Math.ceil(n)}` : "100+");
const perMo = (annual: number) => moneyWhole(Math.round(annual / 12));

interface Knobs {
  returnPct: number;
  withdrawalPct: number;
  currentAge: number;
  retireAge: number;
  extraMonthly: number; // extra dollars saved per month (what-if)
}
const DEFAULT_KNOBS: Knobs = { returnPct: 5, withdrawalPct: 4, currentAge: 35, retireAge: 60, extraMonthly: 0 };

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
  const setKnob = (k: keyof Knobs, v: number) =>
    setKnobs((prev) => {
      const next = { ...prev, [k]: v };
      localStorage.setItem("finapp-fire", JSON.stringify(next));
      return next;
    });

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
    const baseSavings = Math.max(0, incomeCents - expensesCents);
    const extraAnnual = knobs.extraMonthly * 100 * 12;
    const contribution = baseSavings + extraAnnual;
    const savingsRate = incomeCents > 0 ? baseSavings / incomeCents : 0;
    const progress = fireNumber > 0 ? Math.min(1, investedCents / fireNumber) : 0;

    const horizon = Math.max(95, knobs.retireAge + 30);
    const proj = buildProjection({
      p0: investedCents,
      annualContribution: contribution,
      annualSpending: expensesCents,
      r,
      currentAge: knobs.currentAge,
      retireAge: knobs.retireAge,
      horizon,
      fireNumber
    });

    const baseYears = yearsToTarget(investedCents, baseSavings, r, fireNumber);
    const withExtraYears = yearsToTarget(investedCents, contribution, r, fireNumber);
    const gap = Math.max(knobs.retireAge - knobs.currentAge, 0);
    const coastNumber = Math.round(fireNumber / Math.pow(1 + r, gap));

    const flavors = [
      { key: "lean", label: "Lean", target: Math.round((expensesCents * 0.75) / (wr || 1)) },
      { key: "regular", label: "FIRE", target: fireNumber },
      { key: "fat", label: "Fat", target: Math.round((expensesCents * 1.5) / (wr || 1)) }
    ];

    return {
      fireNumber,
      baseSavings,
      contribution,
      extraAnnual,
      savingsRate,
      progress,
      proj,
      baseYears,
      withExtraYears,
      coastNumber,
      coastAchieved: investedCents >= coastNumber && gap > 0,
      alreadyFI: fireNumber > 0 && investedCents >= fireNumber,
      flavors,
      horizon
    };
  }, [expensesCents, incomeCents, investedCents, r, wr, knobs]);

  const fiAge = m.proj.fiAge;
  const baseFiAge = Number.isFinite(m.baseYears) ? knobs.currentAge + Math.ceil(m.baseYears) : null;
  const withExtraFiAge = Number.isFinite(m.withExtraYears) ? knobs.currentAge + Math.ceil(m.withExtraYears) : null;
  const pct = Math.round(m.progress * 100);

  const savingsPct = Math.round(m.savingsRate * 100);
  const spendPct = 100 - savingsPct;

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20 text-ink3">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="FIRE" sub="Financial Independence, Retire Early — see your whole journey" />

      {!data?.data_ok && (
        <Card>
          <div className="flex items-start gap-3 text-sm">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-ink2">
              Not enough categorized income and spending yet, so everything starts from zero. Import or sync
              transactions and categorize them — or just type your figures into “Fine-tune your numbers” below — and
              this whole page fills in from your real money.
            </p>
          </div>
        </Card>
      )}

      {/* 1. Budget vs income — the foundation */}
      <Card title="Step 1 · Your money each year">
        <p className="mb-3 text-sm text-ink2">
          Everything starts here: what you earn, what you spend, and what's left to save. The bigger the green slice,
          the sooner you're free.
        </p>
        <div className="flex h-9 w-full overflow-hidden rounded-lg border border-line text-xs font-medium text-white">
          <div className="flex items-center justify-center" style={{ width: `${Math.max(spendPct, 0)}%`, background: c.s2 }}>
            {spendPct >= 12 && <span>Spend {spendPct}%</span>}
          </div>
          <div className="flex items-center justify-center" style={{ width: `${Math.max(savingsPct, 0)}%`, background: c.s1 }}>
            {savingsPct >= 12 && <span>Save {savingsPct}%</span>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Fact label="You earn" value={moneyWhole(incomeCents)} sub="per year" />
          <Fact label="You spend" value={moneyWhole(expensesCents)} sub={`${perMo(expensesCents)}/mo`} />
          <Fact label="You can save" value={moneyWhole(m.baseSavings)} sub={`${perMo(m.baseSavings)}/mo`} accent />
        </div>
      </Card>

      {/* 2. Your FIRE number */}
      <Card title="Step 2 · Your finish line (FIRE number)">
        <div className="grid gap-6 md:grid-cols-[1fr_1fr] md:items-center">
          <div>
            <div className="tnum font-display text-[38px] font-bold leading-none text-ink">{moneyWhole(m.fireNumber)}</div>
            <p className="mt-2 text-sm text-ink2">
              That's <strong>25×</strong> your yearly spending ({moneyWhole(expensesCents)} ÷ {knobs.withdrawalPct}%).
              Once your investments reach it, they can pay your bills forever without you working — that's “financially
              independent.”
            </p>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-ink2">You're {pct}% of the way there</span>
              <span className="tnum font-semibold text-ink">{moneyWhole(investedCents)}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: c.bar }} />
            </div>
            <p className="mt-2 text-sm text-ink2">
              {m.alreadyFI
                ? "🎉 You've already reached financial independence!"
                : fiAge
                  ? `Keep saving ${perMo(m.contribution)}/mo and you'll get there around age ${fiAge} — in ${fiAge - knobs.currentAge} years.`
                  : "Start saving to begin the countdown."}
            </p>
          </div>
        </div>
      </Card>

      {/* 3. The journey graph (accumulate + draw down) */}
      <Card title="Step 3 · Your whole journey, on one graph">
        <p className="mb-3 text-sm text-ink2">
          Green is your savings growing while you work. At the age you choose to stop, it turns amber — now you're
          living off the pot instead of adding to it. If the amber line stays up, your money lasts for life. Drag the
          sliders and watch it change.
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.proj.data} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="fireSave" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.s1} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={c.s1} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="fireDraw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c.s2} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={c.s2} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis
                dataKey="age"
                tick={{ fill: c.muted, fontSize: 12 }}
                axisLine={{ stroke: c.axis }}
                tickLine={false}
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
              {/* Flavor target lines */}
              {m.flavors.map((f) => (
                <ReferenceLine
                  key={f.key}
                  y={f.target}
                  stroke={f.key === "regular" ? c.s3 : c.grid}
                  strokeDasharray="4 4"
                  strokeWidth={f.key === "regular" ? 1.5 : 1}
                  label={{ value: f.label, position: "right", fill: c.muted, fontSize: 11 }}
                />
              ))}
              {/* Retirement marker */}
              <ReferenceLine x={knobs.retireAge} stroke={c.axis} strokeWidth={1} label={{ value: "retire", position: "top", fill: c.muted, fontSize: 11 }} />
              <Area type="monotone" dataKey="saving" name="Saving" stroke={c.s1} strokeWidth={2} fill="url(#fireSave)" connectNulls={false} />
              <Area type="monotone" dataKey="retired" name="Living off it" stroke={c.s2} strokeWidth={2} fill="url(#fireDraw)" connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Live read-out */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Callout
            tone={m.proj.depletionAge ? "bad" : "good"}
            icon={m.proj.depletionAge ? "alert" : "check"}
            text={
              m.proj.depletionAge
                ? `If you stop working at ${knobs.retireAge}, your money runs out around age ${m.proj.depletionAge}. Retire later or save more to fix this.`
                : `If you stop working at ${knobs.retireAge}, your money should last for life — it keeps growing faster than you spend it.`
            }
          />
          <Callout
            tone="info"
            icon="flame"
            text={
              m.alreadyFI
                ? "You're already financially independent — you could retire now."
                : fiAge
                  ? `You hit your FIRE number at age ${fiAge}. You can safely stop working any time after that.`
                  : "You're not on track to reach FI yet — increase the green slice above."
            }
          />
        </div>

        {/* Sliders */}
        <div className="mt-4 grid gap-x-6 gap-y-3 rounded-lg bg-surface2/40 p-4 sm:grid-cols-2">
          <Slider label="Stop working at age" value={knobs.retireAge} min={knobs.currentAge + 1} max={80} step={1} onChange={(v) => setKnob("retireAge", v)} fmt={(v) => `${v}`} />
          <Slider label="Save extra per month" value={knobs.extraMonthly} min={0} max={3000} step={50} onChange={(v) => setKnob("extraMonthly", v)} fmt={(v) => `$${v.toLocaleString()}`} />
          <Slider label="Investment growth (after inflation)" value={knobs.returnPct} min={2} max={9} step={0.5} onChange={(v) => setKnob("returnPct", v)} fmt={(v) => `${v}%`} />
          <Slider label="Withdrawal rate" value={knobs.withdrawalPct} min={3} max={5} step={0.25} onChange={(v) => setKnob("withdrawalPct", v)} fmt={(v) => `${v}%`} />
        </div>

        {/* What-if save more */}
        {knobs.extraMonthly > 0 && baseFiAge && withExtraFiAge && (
          <div className="mt-3">
            <Callout
              tone="good"
              icon="sparkle"
              text={
                withExtraFiAge < baseFiAge
                  ? `Saving $${knobs.extraMonthly.toLocaleString()} more each month gets you to FI at age ${withExtraFiAge} instead of ${baseFiAge} — ${baseFiAge - withExtraFiAge} years sooner.`
                  : `Saving $${knobs.extraMonthly.toLocaleString()} more each month keeps you on track for FI around age ${withExtraFiAge}.`
              }
            />
          </div>
        )}
      </Card>

      {/* 4. Flavors: how much for each + graph */}
      <Card title="Step 4 · The flavors of FIRE — how much you'd need">
        <p className="mb-4 text-sm text-ink2">
          Same idea, different lifestyles. A leaner life needs a smaller pot; a fancier one needs more. Here's the
          target for each, how long it takes at your current saving, and what you'd save monthly to hit it by age{" "}
          {knobs.retireAge}.
        </p>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={[
                { name: "Lean", target: m.flavors[0].target },
                { name: "FIRE", target: m.flavors[1].target },
                { name: "Fat", target: m.flavors[2].target },
                { name: "Coast (needed now)", target: m.coastNumber }
              ]}
              margin={{ top: 2, right: 60, bottom: 2, left: 4 }}
            >
              <CartesianGrid horizontal={false} stroke={c.grid} />
              <XAxis type="number" tickFormatter={(v: number) => moneyCompact(v)} tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: c.ink2, fontSize: 12 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: c.grid, opacity: 0.3 }} />
              <ReferenceLine x={investedCents} stroke={c.s1} strokeWidth={1.5} label={{ value: "you now", position: "top", fill: c.s1, fontSize: 11 }} />
              <Bar dataKey="target" name="Target" radius={[0, 4, 4, 0]}>
                {[c.s2, c.s3, c.s4, c.s5].map((col, i) => (
                  <Cell key={i} fill={col} />
                ))}
                <LabelList dataKey="target" position="right" formatter={(v) => moneyCompact(Number(v))} style={{ fill: c.muted, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink3">
                <th className="py-2 pr-3 font-medium">Flavor</th>
                <th className="py-2 pr-3 font-medium">You'd need</th>
                <th className="py-2 pr-3 font-medium">Reach it in</th>
                <th className="py-2 font-medium">Save/mo to hit by {knobs.retireAge}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[
                { label: "Lean FIRE", target: m.flavors[0].target, desc: "frugal lifestyle" },
                { label: "Regular FIRE", target: m.flavors[1].target, desc: "your spending today" },
                { label: "Fat FIRE", target: m.flavors[2].target, desc: "roomy lifestyle" }
              ].map((f) => {
                const years = yearsToTarget(investedCents, m.contribution, r, f.target);
                const need = monthlyToReach(f.target, investedCents, r, knobs.retireAge - knobs.currentAge);
                const reached = investedCents >= f.target;
                return (
                  <tr key={f.label}>
                    <td className="py-2 pr-3">
                      <div className="text-ink">{f.label}</div>
                      <div className="text-xs text-ink3">{f.desc}</div>
                    </td>
                    <td className="tnum py-2 pr-3 font-medium text-ink">{moneyWhole(f.target)}</td>
                    <td className="tnum py-2 pr-3 text-ink2">{reached ? "✓ reached" : `${yrs(years)} yrs`}</td>
                    <td className="tnum py-2 text-ink2">{reached || need <= 0 ? "—" : `${moneyWhole(need * 100)}/mo`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface2/40 px-3 py-2.5 text-xs text-ink2">
          <Icon name="wallet" size={15} className="mt-0.5 shrink-0 text-ink3" />
          <span>
            <strong className="text-ink">Coast FIRE</strong> ({moneyWhole(m.coastNumber)}) is different: it's how much
            you'd need invested <em>right now</em> so that growth alone reaches your FIRE number by age{" "}
            {knobs.retireAge} — after that you never have to save again, just cover today's bills.{" "}
            {m.coastAchieved ? "You've reached it! 🎉" : "You're not there yet."}{" "}
            <strong className="text-ink">Barista FIRE</strong> is when a little part-time work covers some of your
            spending, so your pot can be smaller.
          </span>
        </div>
      </Card>

      {/* 5. Savings-rate lever */}
      <Card title="The one thing that matters most: how much you keep" collapsible defaultOpen={false}>
        <p className="mb-3 text-sm text-ink2">
          Starting from zero, the years to reach independence depend almost entirely on the share of income you keep —
          not how much you earn. At {knobs.returnPct}% growth:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink3">
                <th className="py-2 pr-3 font-medium">You save…</th>
                <th className="py-2 pr-3 font-medium">Years to freedom</th>
                <th className="py-2 font-medium">vs. saving 10%</th>
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
                      {Math.round(s * 100)}%{isYou && <span className="ml-2 text-xs font-medium text-accent">that's you</span>}
                    </td>
                    <td className="tnum py-2 pr-3 font-medium text-ink">{yrs(y)}</td>
                    <td className="tnum py-2 text-ink3">{s === 0.1 ? "—" : `${yrs(base - y)} yrs sooner`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Fine-tune inputs */}
      <Card title="Fine-tune your numbers" collapsible defaultOpen={false}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField label="Yearly spending" cents={expensesCents} onChange={(v) => setOv((o) => ({ ...o, exp: v }))} hint="from your categorized spending" />
          <MoneyField label="Yearly income (take-home)" cents={incomeCents} onChange={(v) => setOv((o) => ({ ...o, inc: v }))} />
          <MoneyField label="Money invested now" cents={investedCents} onChange={(v) => setOv((o) => ({ ...o, nest: v }))} hint="savings + investments + retirement" />
          <NumField label="Your age now" value={knobs.currentAge} onChange={(v) => setKnob("currentAge", v)} />
        </div>
        {(ov.inc !== undefined || ov.exp !== undefined || ov.nest !== undefined) && (
          <button className="mt-3 text-xs text-accent hover:underline" onClick={() => setOv({})}>
            ↺ Reset to my actual figures
          </button>
        )}
      </Card>

      {/* Primer */}
      <Card title="New to this? Start here" collapsible defaultOpen={false}>
        <Markdown
          text={`**FIRE** means *Financial Independence, Retire Early*. The goal: own enough investments that they pay your bills for you, so working becomes a choice.

### How it works, in one breath
Invest the money you don't spend. It grows on its own (compounding). Once you have about **25× your yearly spending** invested, you can live off roughly **4% of it per year** — likely forever. That 25× is your FIRE number.

### Why the graph has two colors
- **Green (saving years):** you add money and it grows — the pile climbs.
- **Amber (after you retire):** you stop adding and start spending from it. If your pile is big enough, growth outpaces your spending and it *keeps rising*. If you retire too early with too little, it shrinks and can run out — the graph shows exactly when.

### The fastest lever
The share of income you **keep** (your savings rate) matters far more than how much you earn. Keep 50% and you're free in ~17 years; keep 75% and it's ~7. Two ways to grow it: spend less, or earn more and don't inflate your lifestyle.

### Good next steps
- Kill high-interest debt first (see **Debt Planner**).
- Keep a cash emergency fund so you never sell investments at a bad time (see **Savings**).
- Invest the rest in low-cost, broad index funds and leave it alone.`}
        />
      </Card>

      <p className="text-[11px] text-ink3">
        These are educational estimates using common FIRE rules of thumb (the 4% rule, a steady return after inflation),
        not professional financial advice. Real markets bounce around year to year. Every number above is yours to
        adjust.
      </p>
    </div>
  );
}

// ---------------- small pieces ----------------

function Fact({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface2/40 px-2 py-2">
      <div className="smallcaps text-[11px] text-ink3">{label}</div>
      <div className={`tnum font-display text-[19px] font-semibold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink3">{sub}</div>}
    </div>
  );
}

function Callout({ tone, icon, text }: { tone: "good" | "bad" | "info"; icon: string; text: string }) {
  const cls =
    tone === "good"
      ? "border-good/30 bg-good/10 text-ink"
      : tone === "bad"
        ? "border-bad/30 bg-bad/10 text-ink"
        : "border-accent/25 bg-accent-soft/50 text-ink";
  const ic = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-accent";
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${cls}`}>
      <Icon name={icon} size={16} className={`mt-0.5 shrink-0 ${ic}`} />
      <span>{text}</span>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-ink2">{label}</span>
        <span className="tnum text-sm font-semibold text-ink">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}

function MoneyField({ label, cents, onChange, hint }: { label: string; cents: number; onChange: (cents: number) => void; hint?: string }) {
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

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink2">{label}</span>
      <Input type="number" value={value} min={0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className="w-full" />
    </label>
  );
}
