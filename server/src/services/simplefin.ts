import { db, getSetting, setSetting, deleteSetting } from "../db.js";
import { inferAccountType, normalizePayee } from "../util.js";
import { applyRules, applyMerchantCache } from "./categorizer.js";

const ACCESS_URL_KEY = "simplefin_access_url";
const LAST_SYNC_KEY = "simplefin_last_sync";

export function isConnected(): boolean {
  return getSetting(ACCESS_URL_KEY) !== null;
}

export function lastSync(): string | null {
  return getSetting(LAST_SYNC_KEY);
}

export function disconnect(): void {
  deleteSetting(ACCESS_URL_KEY);
  deleteSetting(LAST_SYNC_KEY);
}

/**
 * A SimpleFIN setup token is a base64-encoded claim URL. POSTing to the claim
 * URL (once) returns the permanent access URL. The claim URL is single-use.
 */
export async function claimSetupToken(setupToken: string): Promise<void> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8");
    if (!/^https:\/\//.test(claimUrl)) throw new Error("not a URL");
  } catch {
    throw new Error("That doesn't look like a valid SimpleFIN setup token.");
  }
  const res = await fetch(claimUrl, { method: "POST" });
  if (!res.ok) {
    throw new Error(`SimpleFIN claim failed (HTTP ${res.status}). Setup tokens are single-use — generate a new one.`);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\//.test(accessUrl)) {
    throw new Error("SimpleFIN returned an unexpected response.");
  }
  setSetting(ACCESS_URL_KEY, accessUrl);
}

interface SfTransaction {
  id: string;
  posted: number; // unix seconds
  amount: string; // dollars, e.g. "-4.50"
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
}

interface SfAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  "balance-date": number;
  org?: { name?: string; domain?: string };
  transactions?: SfTransaction[];
}

export interface SyncResult {
  accounts: number;
  newTransactions: number;
  autoCategorized: number;
  errors: string[];
}

export async function sync(): Promise<SyncResult> {
  const accessUrl = getSetting(ACCESS_URL_KEY);
  if (!accessUrl) throw new Error("SimpleFIN is not connected.");

  // The access URL embeds basic-auth credentials; fetch() rejects those in the
  // URL itself, so split them out into an Authorization header.
  const u = new URL(accessUrl);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  u.username = "";
  u.password = "";

  const last = getSetting(LAST_SYNC_KEY);
  const lookbackDays = last ? 30 : 365;
  const startDate = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  const endpoint = `${u.toString().replace(/\/$/, "")}/accounts?start-date=${startDate}`;
  const res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`SimpleFIN sync failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { errors?: string[]; accounts?: SfAccount[] };

  // Type is inferred from the name on first sight only — later syncs keep any
  // type the user has corrected by hand.
  const upsertAccount = db.prepare(
    `INSERT INTO accounts (name, type, currency, balance_cents, simplefin_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(simplefin_id) DO UPDATE SET balance_cents = excluded.balance_cents`
  );
  const getAccountId = db.prepare("SELECT id FROM accounts WHERE simplefin_id = ?");
  const insertTxn = db.prepare(
    `INSERT INTO transactions (account_id, date, amount_cents, payee, payee_norm, memo, external_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, external_id) DO NOTHING`
  );

  let newTransactions = 0;
  const accounts = data.accounts ?? [];

  const run = db.transaction(() => {
    for (const acct of accounts) {
      const orgName = acct.org?.name ? `${acct.org.name} — ` : "";
      const fullName = `${orgName}${acct.name}`;
      const balanceCents = Math.round(Number(acct.balance) * 100) || 0;
      upsertAccount.run(fullName, inferAccountType(fullName), acct.currency || "USD", balanceCents, acct.id);
      const accountId = (getAccountId.get(acct.id) as { id: number }).id;

      for (const t of acct.transactions ?? []) {
        if (t.pending) continue; // only book settled transactions
        const date = new Date(t.posted * 1000).toISOString().slice(0, 10);
        const amountCents = Math.round(Number(t.amount) * 100);
        if (!Number.isFinite(amountCents)) continue;
        const payee = (t.payee || t.description || "").trim();
        newTransactions += insertTxn.run(
          accountId,
          date,
          amountCents,
          payee,
          normalizePayee(payee),
          (t.memo || t.description || "").trim(),
          t.id
        ).changes;
      }
    }
  });
  run();

  // Instant, free categorization passes; AI is triggered separately.
  const autoCategorized = applyRules() + applyMerchantCache();
  setSetting(LAST_SYNC_KEY, new Date().toISOString());

  return {
    accounts: accounts.length,
    newTransactions,
    autoCategorized,
    errors: data.errors ?? []
  };
}
