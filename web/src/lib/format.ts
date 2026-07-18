const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

export function money(cents: number): string {
  return usd.format(cents / 100);
}

export function moneyWhole(cents: number): string {
  return usdWhole.format(Math.round(cents / 100));
}

/** Compact money for chart axes: $1.2k, $35k */
export function moneyCompact(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(Math.abs(d) >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(d)}`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function monthName(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function monthNameLong(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
