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
export type StateCode = "NJ" | "IL" | "NY" | "NYC";
export type Freq = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual";
export type PayFreq = "weekly" | "biweekly" | "semimonthly" | "monthly";
export type PayType = "hourly" | "salary";

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
  payType?: PayType; // "hourly" (default) or "salary"
  hourlyCents: number;
  hoursPerWeek: number;
  annualSalaryCents?: number; // used when payType === "salary"
  payFreq: PayFreq;
  benefits: Benefit[];
}

/** Non-taxed cash / side income added straight to take-home. */
export interface CashIncome {
  id: string;
  name: string;
  amountCents: number;
  freq: Freq;
}

export interface IncomeProfile {
  filing: Filing;
  state: StateCode;
  jobs: Job[];
  cash?: CashIncome[];
}

/** Annual gross wages for a job (from a salary, or hourly × hours × 52). */
export function jobGrossAnnualCents(job: Job): number {
  if (job.payType === "salary") return Math.round(job.annualSalaryCents ?? 0);
  return Math.round(job.hourlyCents * job.hoursPerWeek * 52);
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

// New York State (2025). NY has its own standard deduction.
const NY_STD: Record<Filing, number> = { single: 8000, married: 16050, head: 11200 };
const NY_BRACKETS: Record<Filing, Array<[number, number]>> = {
  single: [
    [0, 0.04],
    [8500, 0.045],
    [11700, 0.0525],
    [13900, 0.055],
    [80650, 0.06],
    [215400, 0.0685],
    [1077550, 0.0965],
    [5000000, 0.103],
    [25000000, 0.109]
  ],
  married: [
    [0, 0.04],
    [17150, 0.045],
    [23600, 0.0525],
    [27900, 0.055],
    [161550, 0.06],
    [323200, 0.0685],
    [2155350, 0.0965],
    [5000000, 0.103],
    [25000000, 0.109]
  ],
  head: [
    [0, 0.04],
    [12800, 0.045],
    [17650, 0.0525],
    [20900, 0.055],
    [107650, 0.06],
    [269300, 0.0685],
    [1616450, 0.0965],
    [5000000, 0.103],
    [25000000, 0.109]
  ]
};
// New York City resident tax (2025), applied to NY taxable income.
const NYC_BRACKETS: Record<Filing, Array<[number, number]>> = {
  single: [
    [0, 0.03078],
    [12000, 0.03762],
    [25000, 0.03819],
    [50000, 0.03876]
  ],
  married: [
    [0, 0.03078],
    [21600, 0.03762],
    [45000, 0.03819],
    [90000, 0.03876]
  ],
  head: [
    [0, 0.03078],
    [14400, 0.03762],
    [30000, 0.03819],
    [60000, 0.03876]
  ]
};

export const STATE_TAX: Record<StateCode, StateTax> = {
  NJ: {
    name: "New Jersey",
    tax: (stateWages, filing) =>
      bracketTax(Math.max(0, stateWages - NJ_EXEMPTION[filing]), NJ_BRACKETS[filing])
  },
  IL: {
    name: "Illinois",
    tax: (stateWages, filing) => Math.max(0, stateWages - IL_EXEMPTION[filing]) * IL_RATE
  },
  NY: {
    name: "New York",
    tax: (stateWages, filing) => bracketTax(Math.max(0, stateWages - NY_STD[filing]), NY_BRACKETS[filing])
  },
  NYC: {
    name: "New York City",
    tax: (stateWages, filing) => {
      const taxable = Math.max(0, stateWages - NY_STD[filing]);
      return bracketTax(taxable, NY_BRACKETS[filing]) + bracketTax(taxable, NYC_BRACKETS[filing]);
    }
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
  cashAnnualCents: number; // untaxed cash income added to take-home
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
    grossD += jobGrossAnnualCents(job) / 100;
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
  // Untaxed cash / side income adds straight to take-home.
  const cashD = (p.cash ?? []).reduce((s, ci) => s + (ci.amountCents / 100) * FREQ_PER_YEAR[ci.freq], 0);
  // Take-home = what lands in your bank = wages − taxes − every deduction + cash.
  const netAnnualD = grossD - totalTaxD - preTaxD - postTaxD + cashD;

  return {
    grossAnnualCents: c(grossD),
    preTaxAnnualCents: c(preTaxD),
    postTaxAnnualCents: c(postTaxD),
    federalCents: c(federalD),
    socialSecurityCents: c(socialSecurityD),
    medicareCents: c(medicareD),
    stateCents: c(stateD),
    totalTaxCents: c(totalTaxD),
    cashAnnualCents: c(cashD),
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
