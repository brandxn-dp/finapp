import crypto from "node:crypto";

/**
 * Normalize a raw bank payee string into a stable merchant key so the same
 * merchant matches across statements ("SQ *BLUE BOTTLE 0231 OAKLAND CA" ->
 * "blue bottle").
 */
export function normalizePayee(raw: string): string {
  let s = (raw ?? "").toLowerCase();
  // Common processor prefixes
  s = s.replace(/^(sq \*|sq\*|tst\*|tst \*|py \*|pp\*|paypal \*|paypal\*|sp \*|amzn mktp|pos debit[ -]*|pos [ -]*|debit card purchase[ -]*|ach debit[ -]*|recurring payment[ -]*|web pmt[ -]*)/g, "");
  // Strip everything that's not a letter, number or space
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  // Drop trailing store numbers / reference numbers (tokens that are all digits)
  s = s
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !/^\d+$/.test(tok))
    .join(" ");
  // Drop trailing US state codes when preceded by at least two words (city + state noise)
  const parts = s.split(" ");
  if (parts.length >= 3 && /^(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)$/.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ").trim().slice(0, 60);
}

/** Stable hash used to dedupe CSV imports (same account + date + amount + payee). */
export function importHash(accountId: number, date: string, amountCents: number, payee: string): string {
  return crypto
    .createHash("sha1")
    .update(`${accountId}|${date}|${amountCents}|${payee.trim().toLowerCase()}`)
    .digest("hex");
}

/** Parse a money string like "-1,234.56" or "$12.30" into integer cents. */
export function parseAmountToCents(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  const cleaned = value.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Parse common date formats into YYYY-MM-DD, or null if unparseable. */
export function parseDate(value: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  // ISO already
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // MM/DD/YYYY or M/D/YY
  m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let year = m[3];
    if (year.length === 2) year = (Number(year) > 70 ? "19" : "20") + year;
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Guess an account's type from its name ("Chase Sapphire Visa" -> credit). */
export function inferAccountType(name: string): string {
  const n = name.toLowerCase();
  if (/(visa|mastercard|amex|american express|discover|credit|card)\b/.test(n)) return "credit";
  if (/(mortgage|heloc|loan|auto ln|student|financing)/.test(n)) return "loan";
  if (/(401k|401\(k\)|403b|ira\b|roth|pension|retirement|tsp\b)/.test(n)) return "retirement";
  if (/(saving|sav\b|money market|mma|cd\b|certificate)/.test(n)) return "savings";
  if (/(invest|brokerage|hsa|529)/.test(n)) return "investment";
  if (/(cash|wallet)/.test(n)) return "cash";
  if (/(checking|chk|debit|spending)/.test(n)) return "checking";
  return "checking";
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
