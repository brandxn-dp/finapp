import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { money, moneyWhole } from "../lib/format";
import { useChartColors } from "../lib/theme";
import { Button, Card, Icon, Input, PageHeader, Select, Spinner, useToast } from "../components/ui";
import {
  computeTakeHome,
  BENEFIT_FREQS,
  FILINGS,
  PAY_FREQS,
  STATES,
  TAX_YEAR,
  type Benefit,
  type Filing,
  type Freq,
  type IncomeProfile,
  type Job,
  type PayFreq,
  type StateCode
} from "../lib/tax";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const newBenefit = (): Benefit => ({ id: uid(), name: "", amountCents: 0, freq: "monthly", timing: "pre" });
const newJob = (name = "Job"): Job => ({ id: uid(), name, hourlyCents: 0, hoursPerWeek: 40, payFreq: "biweekly", benefits: [] });
const DEFAULT: IncomeProfile = { filing: "single", state: "NJ", jobs: [newJob("My job")] };

export default function Income() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const c = useChartColors();
  const [profile, setProfile] = useState<IncomeProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<"check" | "month" | "year">("year");

  useEffect(() => {
    api
      .get<{ profile: IncomeProfile | null }>("/api/income")
      .then((r) => setProfile(r.profile && r.profile.jobs?.length ? r.profile : DEFAULT))
      .catch(() => setProfile(DEFAULT));
  }, []);

  const th = useMemo(() => (profile ? computeTakeHome(profile) : null), [profile]);

  if (!profile || !th) {
    return (
      <div className="flex justify-center py-20 text-ink3">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const patch = (p: Partial<IncomeProfile>) => setProfile((prev) => ({ ...prev!, ...p }));
  const patchJob = (id: string, p: Partial<Job>) =>
    setProfile((prev) => ({ ...prev!, jobs: prev!.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
  const addJob = () => patch({ jobs: [...profile.jobs, newJob(`Job ${profile.jobs.length + 1}`)] });
  const removeJob = (id: string) => patch({ jobs: profile.jobs.filter((j) => j.id !== id) });

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/api/income", {
        profile,
        net_monthly_cents: th.netMonthlyCents,
        gross_monthly_cents: th.grossMonthlyCents
      });
      toast("Take-home saved — your Budget, Debt planner and FIRE now use it.", "good");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm("Clear this and go back to using your categorized transactions for income?")) return;
    try {
      await api.del("/api/income");
      toast("Cleared. Income will come from your transactions again.", "info");
      setProfile(DEFAULT);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  // Breakdown bar segments (share of gross).
  const g = Math.max(1, th.grossAnnualCents);
  const seg = (v: number) => `${(v / g) * 100}%`;

  // Period toggle for the breakdown: per paycheck (using the primary job's pay
  // schedule), per month, or per year. Proportions are unchanged; only amounts scale.
  const primaryFreq = profile.jobs[0]?.payFreq ?? "biweekly";
  const perYear = PAY_FREQS.find((f) => f.value === primaryFreq)?.perYear ?? 26;
  const freqLabel = PAY_FREQS.find((f) => f.value === primaryFreq)?.label.toLowerCase() ?? "";
  const divisor = period === "year" ? 1 : period === "month" ? 12 : perYear;
  const per = (annualCents: number) => (period === "year" ? moneyWhole(annualCents) : money(Math.round(annualCents / divisor)));
  const periodLabel = period === "year" ? "per year" : period === "month" ? "per month" : "per paycheck";
  const multiFreq = new Set(profile.jobs.map((j) => j.payFreq)).size > 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Income & take-home pay"
        sub="Turn your wage into real take-home after taxes — used for your budget"
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate("/budget")}>
            <Icon name="target" size={14} /> Back to Budget
          </Button>
        }
      />

      {/* Filing + state */}
      <Card title="About you">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Tax filing status</span>
            <Select value={profile.filing} onChange={(e) => patch({ filing: e.target.value as Filing })} className="w-full">
              {FILINGS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">State you live in</span>
            <Select value={profile.state} onChange={(e) => patch({ state: e.target.value as StateCode })} className="w-full">
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </Select>
            <span className="mt-0.5 block text-[11px] text-ink3">More states coming soon.</span>
          </label>
        </div>
      </Card>

      {/* Jobs */}
      {profile.jobs.map((job, i) => (
        <JobCard
          key={job.id}
          job={job}
          index={i}
          canRemove={profile.jobs.length > 1}
          onChange={(p) => patchJob(job.id, p)}
          onRemove={() => removeJob(job.id)}
        />
      ))}
      <Button variant="ghost" size="sm" onClick={addJob}>
        <Icon name="plus" size={14} /> Add another job
      </Button>

      {/* Breakdown */}
      <Card
        title={`Where your money goes (${TAX_YEAR})`}
        action={
          <div className="flex gap-0.5 rounded-lg bg-surface2 p-0.5 text-xs">
            {([
              ["check", "Per paycheck"],
              ["month", "Monthly"],
              ["year", "Yearly"]
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setPeriod(v)}
                className={`rounded-md px-2 py-1 ${period === v ? "bg-accent font-medium text-accent-fg" : "text-ink2 hover:bg-surface"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-2 flex h-8 w-full overflow-hidden rounded-lg border border-line text-[10px] font-medium text-white">
          <Bar w={seg(th.netAnnualCents)} color={c.s1} label="Take-home" />
          <Bar w={seg(th.federalCents)} color={c.s2} label="Fed" />
          <Bar w={seg(th.socialSecurityCents + th.medicareCents)} color={c.s3} label="FICA" />
          <Bar w={seg(th.stateCents)} color={c.s4} label="State" />
          <Bar w={seg(th.preTaxAnnualCents + th.postTaxAnnualCents)} color={c.s5} label="Deductions" />
        </div>

        <div className="grid gap-y-1.5 text-sm">
          <Row label="Gross pay (before anything)" value={per(th.grossAnnualCents)} bold />
          <Row label="Federal income tax" value={`− ${per(th.federalCents)}`} />
          <Row label="Social Security (6.2%)" value={`− ${per(th.socialSecurityCents)}`} />
          <Row label="Medicare (1.45%)" value={`− ${per(th.medicareCents)}`} />
          <Row label={`${STATES.find((s) => s.code === profile.state)?.name} state tax`} value={`− ${per(th.stateCents)}`} />
          {th.preTaxAnnualCents > 0 && <Row label="Pre-tax benefits (401k, insurance…)" value={`− ${per(th.preTaxAnnualCents)}`} />}
          {th.postTaxAnnualCents > 0 && <Row label="Post-tax deductions" value={`− ${per(th.postTaxAnnualCents)}`} />}
          <div className="my-1 border-t border-line" />
          <Row label={`Take-home pay (${periodLabel})`} value={per(th.netAnnualCents)} bold accent />
        </div>
        <p className="mt-2 text-xs text-ink3">
          {period === "check" && (multiFreq ? "Per-paycheck amounts use your first job's pay schedule. " : `Based on your ${freqLabel} pay schedule. `)}
          That's an effective tax rate of {Math.round(th.effectiveTaxRate * 100)}% on your gross pay.
        </p>
      </Card>

      {/* Take-home summary + save */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3 sm:items-center">
          <div className="sm:col-span-2">
            <div className="smallcaps text-[12px] font-medium text-ink3">Your monthly take-home</div>
            <div className="tnum font-display text-[36px] font-bold leading-none text-accent">{money(th.netMonthlyCents)}</div>
            <p className="mt-1 text-xs text-ink3">
              ≈ {money(Math.round(th.netAnnualCents / 52))}/week · {money(Math.round(th.netAnnualCents / 26))} every 2 weeks.
              This is the income your Budget, Debt planner, and FIRE page use.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="check" size={14} />} Save & use for budgeting
            </Button>
            <button className="text-xs text-ink3 hover:text-ink" onClick={clear}>
              Use my transactions instead
            </button>
          </div>
        </div>
      </Card>

      <p className="text-[11px] text-ink3">
        {TAX_YEAR} estimate using federal brackets, the standard deduction, Social Security &amp; Medicare, and your
        state's income tax. It doesn't include tax credits (like the child tax credit), city/local taxes, or small
        state payroll items (e.g. NJ unemployment/family-leave). Not tax advice — check your pay stub for exact figures.
      </p>
    </div>
  );
}

function JobCard({
  job,
  index,
  canRemove,
  onChange,
  onRemove
}: {
  job: Job;
  index: number;
  canRemove: boolean;
  onChange: (p: Partial<Job>) => void;
  onRemove: () => void;
}) {
  const grossWeek = (job.hourlyCents / 100) * job.hoursPerWeek;
  const grossYear = grossWeek * 52;
  const perYear = PAY_FREQS.find((f) => f.value === job.payFreq)?.perYear ?? 26;
  const perCheck = grossYear / perYear;

  const setBenefit = (id: string, p: Partial<Benefit>) =>
    onChange({ benefits: job.benefits.map((b) => (b.id === id ? { ...b, ...p } : b)) });

  return (
    <Card
      title={index === 0 ? "Your job" : `Job ${index + 1}`}
      action={
        canRemove ? (
          <button className="text-xs text-ink3 hover:text-bad" onClick={onRemove}>
            Remove
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Nickname</span>
          <Input value={job.name} onChange={(e) => onChange({ name: e.target.value })} className="w-full" placeholder="e.g. Barista" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Hourly wage</span>
          <Dollar cents={job.hourlyCents} onChange={(v) => onChange({ hourlyCents: v })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Hours per week</span>
          <Input
            type="number"
            value={job.hoursPerWeek}
            min={0}
            max={100}
            onChange={(e) => onChange({ hoursPerWeek: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Paid</span>
          <Select value={job.payFreq} onChange={(e) => onChange({ payFreq: e.target.value as PayFreq })} className="w-full">
            {PAY_FREQS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </Select>
        </label>
      </div>

      {job.hourlyCents > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Per week" value={moneyWhole(Math.round(grossWeek * 100))} />
          <Mini label="Per month" value={moneyWhole(Math.round((grossYear / 12) * 100))} />
          <Mini label="Per year" value={moneyWhole(Math.round(grossYear * 100))} />
          <Mini label="Each paycheck" value={moneyWhole(Math.round(perCheck * 100))} accent />
        </div>
      )}

      {/* Benefits */}
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-ink2">Paycheck deductions & benefits</div>
        {job.benefits.length === 0 && (
          <p className="mb-2 text-xs text-ink3">
            Add things taken out of your paycheck: 401(k), health insurance, HSA, etc. Pre-tax ones lower your taxes.
          </p>
        )}
        <div className="space-y-2">
          {job.benefits.map((b) => (
            <div key={b.id} className="grid grid-cols-2 items-center gap-2 rounded-lg bg-surface2/40 p-2 sm:grid-cols-[1.4fr_1fr_1fr_1.1fr_auto]">
              <Input value={b.name} onChange={(e) => setBenefit(b.id, { name: e.target.value })} placeholder="e.g. 401(k)" className="!h-8 !text-xs" />
              <Dollar cents={b.amountCents} onChange={(v) => setBenefit(b.id, { amountCents: v })} small />
              <Select value={b.freq} onChange={(e) => setBenefit(b.id, { freq: e.target.value as Freq })} className="!h-8 !text-xs">
                {BENEFIT_FREQS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
              <Select value={b.timing} onChange={(e) => setBenefit(b.id, { timing: e.target.value as "pre" | "post" })} className="!h-8 !text-xs">
                <option value="pre">Pre-tax</option>
                <option value="post">Post-tax</option>
              </Select>
              <button className="justify-self-center text-ink3 hover:text-bad" onClick={() => onChange({ benefits: job.benefits.filter((x) => x.id !== b.id) })}>
                <Icon name="trash" size={14} />
              </button>
              {b.timing === "pre" && (
                <label className="col-span-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink3 sm:col-span-5">
                  <input
                    type="checkbox"
                    checked={Boolean(b.ficaExempt)}
                    onChange={(e) => setBenefit(b.id, { ficaExempt: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  Also skips Social Security &amp; Medicare (check for health insurance, HSA, FSA — not 401(k))
                </label>
              )}
            </div>
          ))}
        </div>
        <button className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => onChange({ benefits: [...job.benefits, newBenefit()] })}>
          <Icon name="plus" size={12} /> Add a deduction
        </button>
      </div>
    </Card>
  );
}

// ---------- small pieces ----------

function Bar({ w, color, label }: { w: string; color: string; label: string }) {
  const pct = parseFloat(w);
  return (
    <div className="flex items-center justify-center" style={{ width: w, background: color, minWidth: pct > 0 ? 2 : 0 }}>
      {pct >= 9 && <span className="truncate px-1">{label}</span>}
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={bold ? "text-ink" : "text-ink2"}>{label}</span>
      <span className={`tnum ${bold ? "font-semibold" : ""} ${accent ? "text-accent" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface2/40 px-2 py-1.5">
      <div className="smallcaps text-[10px] text-ink3">{label}</div>
      <div className={`tnum font-display text-[16px] font-semibold ${accent ? "text-accent" : "text-ink"}`}>{value}</div>
    </div>
  );
}

/**
 * Dollar input that supports decimals (e.g. an hourly wage of $28.85). Keeps the
 * raw text you type in local state so an in-progress "28." or "28.5" isn't
 * clobbered by re-deriving the value from cents; re-syncs if cents changes
 * externally (e.g. when a saved profile loads).
 */
function Dollar({ cents, onChange, small }: { cents: number; onChange: (cents: number) => void; small?: boolean }) {
  const fmt = (v: number) => (v === 0 ? "" : String(v / 100));
  const [text, setText] = useState(() => fmt(cents));
  useEffect(() => {
    const parsed = Math.max(0, Math.round((Number(text.replace(/[^0-9.]/g, "")) || 0) * 100));
    if (parsed !== cents) setText(fmt(cents));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute ${small ? "left-2 top-1/2 -translate-y-1/2 text-xs" : "left-2.5 top-1/2 -translate-y-1/2 text-sm"} text-ink3`}>$</span>
      <Input
        value={text}
        placeholder="0"
        onChange={(e) => {
          let clean = e.target.value.replace(/[^0-9.]/g, "");
          const dot = clean.indexOf(".");
          if (dot !== -1) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, ""); // keep one decimal point
          setText(clean);
          onChange(Math.max(0, Math.round((Number(clean) || 0) * 100)));
        }}
        inputMode="decimal"
        className={`w-full ${small ? "!h-8 pl-5 !text-xs" : "pl-6"}`}
      />
    </div>
  );
}
