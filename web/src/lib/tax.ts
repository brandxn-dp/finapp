/**
 * Paycheck / take-home tax estimator — TAX YEAR 2025.
 *
 * Mirrors what a standard paycheck calculator does: gross wages minus pre-tax
 * deductions and the standard deduction give taxable income, then federal
 * brackets, Social Security, Medicare, and state income tax apply. Amounts are
 * in integer cents. This is an estimate — it does not include tax credits
 * (child tax credit, EITC…), local/city taxes, or small state payroll items
 * (e.g. NJ unemployment / family-leave contributions).
 *
 * All figures are TAX YEAR 2025 (IRS, NJ Division of Taxation, IL Dept. of
 * Revenue). Add states in STATE_TAX below.
 */

export type Filing = "single" | "married" | "head";
export type StateCode = "NJ" | "IL";
export type Freq = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual";
export type PayFreq = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface Benefit {
  id: string;
  name: string;
  amountCents: number;
  freq: Freq;
  timing: "pre" | "post";
  /** Pre-tax items like health insurance / HSA also skip Social Security & Medicare (Section 125). 401(k) does not. */
  ficaExempt?: boolean;
}

export interface Job {
  id: string;
  name: string;
  hourlyCents: number;
  hoursPerWeek: number;
  payFreq: PayFreq;
  benefits: Benefit[];
}

export interface IncomeProfile {
  filing: Filing;
  state: StateCode;
  jobs: Job[];
}

// ---------- constants (2025) ----------

const FED_STD_DEDUCTION: Record<Filing, number> = { single: 15000, married: 30000, head: 22500 };

/** [lowerBound, rate] ascending. Applies to taxable income (after standard deduction). */
const FED_BRACKETS: Record<Filing, Array<[number, number]>> = {
  single: [
    [0, 0.1],
    [11925, 0.12],
    [48475, 0.22],
    [103350, 0.24],
    [197300, 0.32],
    [250525, 0.35],
    [626350, 0.37]
  ],
  married: [
    [0, 0.1],
    [23850, 0.12],
    [96950, 0.22],
    [206700, 0.24],
    [394600, 0.32],
    [501050, 0.35],
    [751600, 0.37]
  ],
  head: [
    [0, 0.1],
    [17000, 0.12],
    [64850, 0.22],
    [103350, 0.24],
    [197300, 0.32],
    [250500, 0.35],
    [626350, 0.37]
  ]
};

const SS_RATE = 0.062;
const SS_WAGE_BASE = 176100; // 2025 Social Security wage base
const MEDICARE_RATE = 0.0145;
const ADDL_MEDICARE_RATE = 0.009;
const ADDL_MEDICARE_THRESHOLD: Record<Filing, number> = { single: 200000, married: 250000, head: 200000 };

interface StateTax {
  name: string;
  /** Compute annual state income tax in dollars from state-taxable wages. */
  tax: (stateWages: number, filing: Filing) => number;
}

const NJ_BRACKETS: Record<Filing, Array<[number, number]>> = {
  // Single / married-filing-separately
  single: [
    [0, 0.014],
    [20000, 0.0175],
    [35000, 0.035],
    [40000, 0.05525],
    [75000, 0.0637],
    [500000, 0.0897],
    [1000000, 0.1075]
  ],
  // Married-filing-jointly / head of household
  married: [
    [0, 0.014],
    [20000, 0.0175],
    [50000, 0.0245],
    [70000, 0.035],
    [80000, 0.05525],
    [150000, 0.0637],
    [500000, 0.0897],
    [1000000, 0.1075]
  ],
  head: [
    [0, 0.014],
    [20000, 0.0175],
    [50000, 0.0245],
    [70000, 0.035],
    [80000, 0.05525],
    [150000, 0.0637],
    [500000, 0.0897],
    [1000000, 0.1075]
  ]
};
const NJ_EXEMPTION: Record<Filing, number> = { single: 1000, married: 2000, head: 2000 };

const IL_RATE = 0.0495; // flat since 2017
const IL_EXEMPTION: Record<Filing, number> = { single: 2775, married: 5550, head: 2775 };

export const STATE_TAX: Record<StateCode, StateTax> = {
  NJ: {
    name: "New Jersey",
    tax: (stateWages, filing) =>
      bracketTax(Math.max(0, stateWages - NJ_EXEMPTION[filing]), NJ_BRACKETS[filing])
  },
  IL: {
    name: "Illinois",
    tax: (stateWages, filing) => Math.max(0, stateWages - IL_EXEMPTION[filing]) * IL_RATE
  }
};

export const STATES = (Object.keys(STATE_TAX) as StateCode[]).map((code) => ({ code, name: STATE_TAX[code].name }));
export const FILINGS: Array<{ value: Filing; label: string }> = [
  { value: "single", label: "Single" },
  { value: "married", label: "Married filing jointly" },
  { value: "head", label: "Head of household" }
];

export const TAX_YEAR = 2025;

// ---------- math ----------

function bracketTax(income: number, brackets: Array<[number, number]>): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lo = brackets[i][0];
    const rate = brackets[i][1];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income > lo) tax += (Math.min(income, hi) - lo) * rate;
    else break;
  }
  return tax;
}

const FREQ_PER_YEAR: Record<Freq, number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 };

export interface TakeHome {
  grossAnnualCents: number;
  preTaxAnnualCents: number;
  postTaxAnnualCents: number;
  federalCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  stateCents: number;
  totalTaxCents: number;
  netAnnualCents: number;
  netMonthlyCents: number;
  grossMonthlyCents: number;
  effectiveTaxRate: number; // total tax / gross
}

/** Dollars → cents helpers keep the engine in whole dollars, then round to cents. */
const c = (dollars: number) => Math.round(dollars * 100);

export function computeTakeHome(p: IncomeProfile): TakeHome {
  let grossD = 0;
  let preTaxD = 0;
  let preTaxFicaExemptD = 0;
  let postTaxD = 0;

  for (const job of p.jobs) {
    grossD += (job.hourlyCents / 100) * job.hoursPerWeek * 52;
    for (const b of job.benefits) {
      const annual = (b.amountCents / 100) * FREQ_PER_YEAR[b.freq];
      if (b.timing === "pre") {
        preTaxD += annual;
        if (b.ficaExempt) preTaxFicaExemptD += annual;
      } else {
        postTaxD += annual;
      }
    }
  }

  const filing = p.filing;

  // Federal income tax: taxable = gross − pre-tax − standard deduction.
  const fedTaxable = Math.max(0, grossD - preTaxD - FED_STD_DEDUCTION[filing]);
  const federalD = bracketTax(fedTaxable, FED_BRACKETS[filing]);

  // FICA: only Section 125 pre-tax (health/HSA) reduces these; 401(k) does not.
  const ficaWagesD = Math.max(0, grossD - preTaxFicaExemptD);
  const socialSecurityD = SS_RATE * Math.min(ficaWagesD, SS_WAGE_BASE);
  const medicareD =
    MEDICARE_RATE * ficaWagesD + ADDL_MEDICARE_RATE * Math.max(0, ficaWagesD - ADDL_MEDICARE_THRESHOLD[filing]);

  // State income tax on wages after pre-tax deductions.
  const stateWagesD = Math.max(0, grossD - preTaxD);
  const stateD = STATE_TAX[p.state].tax(stateWagesD, filing);

  const totalTaxD = federalD + socialSecurityD + medicareD + stateD;
  // Take-home = what lands in your bank = gross − taxes − every deduction.
  const netAnnualD = grossD - totalTaxD - preTaxD - postTaxD;

  return {
    grossAnnualCents: c(grossD),
    preTaxAnnualCents: c(preTaxD),
    postTaxAnnualCents: c(postTaxD),
    federalCents: c(federalD),
    socialSecurityCents: c(socialSecurityD),
    medicareCents: c(medicareD),
    stateCents: c(stateD),
    totalTaxCents: c(totalTaxD),
    netAnnualCents: c(netAnnualD),
    netMonthlyCents: c(netAnnualD / 12),
    grossMonthlyCents: c(grossD / 12),
    effectiveTaxRate: grossD > 0 ? totalTaxD / grossD : 0
  };
}

export const PAY_FREQS: Array<{ value: PayFreq; label: string; perYear: number }> = [
  { value: "weekly", label: "Weekly", perYear: 52 },
  { value: "biweekly", label: "Every 2 weeks", perYear: 26 },
  { value: "semimonthly", label: "Twice a month", perYear: 24 },
  { value: "monthly", label: "Monthly", perYear: 12 }
];

export const BENEFIT_FREQS: Array<{ value: Freq; label: string }> = [
  { value: "weekly", label: "per week" },
  { value: "biweekly", label: "every 2 weeks" },
  { value: "semimonthly", label: "twice a month" },
  { value: "monthly", label: "per month" },
  { value: "annual", label: "per year" }
];
