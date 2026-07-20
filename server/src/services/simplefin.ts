import { db, getHouseholdSetting, setHouseholdSetting } from "../db.js";
import { importHash, inferAccountType, normalizePayee } from "../util.js";
import { applyRules, applyMerchantCache } from "./categorizer.js";

// SimpleFIN connections are per-household (each household links its own banks).
const ACCESS_URL_KEY = "simplefin_access_url";
const LAST_SYNC_KEY = "simplefin_last_sync";

export function isConnected(hid: number): boolean {
  return getHouseholdSetting(hid, ACCESS_URL_KEY) !== null;
}

export function lastSync(hid: number): string | null {
  return getHouseholdSetting(hid, LAST_SYNC_KEY);
}

export function disconnect(hid: number): void {
  db.prepare("DELETE FROM household_settings WHERE household_id = ? AND key IN (?, ?)").run(
    hid,
    ACCESS_URL_KEY,
    LAST_SYNC_KEY
  );
}

/**
 * A SimpleFIN setup token is a base64-encoded claim URL. POSTing to the claim
 * URL (once) returns the permanent access URL. The claim URL is single-use.
 */
export async function claimSetupToken(setupToken: string, hid: number): Promise<void> {
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
  setHouseholdSetting(hid, ACCESS_URL_KEY, accessUrl);
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
  relinked: number; // existing accounts adopted onto a new SimpleFIN id (kept their history)
  errors: string[];
}

export async function sync(hid: number): Promise<SyncResult> {
  const accessUrl = getHouseholdSetting(hid, ACCESS_URL_KEY);
  if (!accessUrl) throw new Error("SimpleFIN is not connected.");

  // The access URL embeds basic-auth credentials; fetch() rejects those in the
  // URL itself, so split them out into an Authorization header.
  const u = new URL(accessUrl);
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  u.username = "";
  u.password = "";

  const last = getHouseholdSetting(hid, LAST_SYNC_KEY);
  const lookbackDays = last ? 30 : 365;
  const startDate = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  const endpoint = `${u.toString().replace(/\/$/, "")}/accounts?start-date=${startDate}`;
  const res = await fetch(endpoint, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`SimpleFIN sync failed (HTTP ${res.status}).`);
  const data = (await res.json()) as { errors?: string[]; accounts?: SfAccount[] };

  // Account resolution, in order of preference:
  //  1. an account already linked to this SimpleFIN id → update its balance
  //  2. an existing same-name account not tied to another incoming id → ADOPT it
  //     onto the new id (this is what makes a recreated SimpleFIN app re-link to
  //     your old account and keep its history, instead of making a duplicate)
  //  3. otherwise a brand-new account
  const findBySfid = db.prepare("SELECT id FROM accounts WHERE simplefin_id = ? AND household_id = ?");
  const sameName = db.prepare(
    "SELECT id, simplefin_id FROM accounts WHERE household_id = ? AND archived = 0 AND lower(trim(name)) = lower(trim(?))"
  );
  const updateBalance = db.prepare("UPDATE accounts SET balance_cents = ? WHERE id = ?");
  const adopt = db.prepare("UPDATE accounts SET simplefin_id = ?, balance_cents = ? WHERE id = ?");
  const insertAccount = db.prepare(
    "INSERT INTO accounts (name, type, currency, balance_cents, simplefin_id, household_id) VALUES (?, ?, ?, ?, ?, ?)"
  );

  // Recreating a SimpleFIN app changes transaction ids too, so external-id dedup
  // alone can't spot re-synced history. For adopted accounts we also skip any
  // transaction we already hold by content (date + amount + normalized payee).
  const contentExists = db.prepare(
    "SELECT 1 FROM transactions WHERE account_id = ? AND date = ? AND amount_cents = ? AND payee_norm = ?"
  );
  const insertTxn = db.prepare(
    `INSERT INTO transactions (account_id, date, amount_cents, payee, payee_norm, memo, external_id, import_hash, household_id)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM deleted_txns dt WHERE dt.account_id = ? AND (dt.external_id = ? OR dt.import_hash = ?))
     ON CONFLICT(account_id, external_id) DO NOTHING`
  );

  let newTransactions = 0;
  let relinked = 0;
  const accounts = data.accounts ?? [];
  const incomingIds = new Set(accounts.map((a) => a.id));
  const adoptedIds = new Set<number>();

  const run = db.transaction(() => {
    for (const acct of accounts) {
      const orgName = acct.org?.name ? `${acct.org.name} — ` : "";
      const fullName = `${orgName}${acct.name}`;
      const balanceCents = Math.round(Number(acct.balance) * 100) || 0;

      let accountId: number;
      const byId = findBySfid.get(acct.id, hid) as { id: number } | undefined;
      if (byId) {
        accountId = byId.id;
        updateBalance.run(balanceCents, accountId);
      } else {
        const cands = sameName.all(hid, fullName) as Array<{ id: number; simplefin_id: string | null }>;
        // Adopt a same-name account that isn't already claimed this run and isn't
        // the live match for a different incoming account.
        const cand = cands.find(
          (c) => !adoptedIds.has(c.id) && (c.simplefin_id === null || !incomingIds.has(c.simplefin_id))
        );
        if (cand) {
          accountId = cand.id;
          adopt.run(acct.id, balanceCents, cand.id);
          adoptedIds.add(cand.id);
          relinked++;
        } else {
          accountId = insertAccount.run(
            fullName,
            inferAccountType(fullName),
            acct.currency || "USD",
            balanceCents,
            acct.id,
            hid
          ).lastInsertRowid as number;
        }
      }

      const isAdopted = adoptedIds.has(accountId);
      for (const t of acct.transactions ?? []) {
        if (t.pending) continue; // only book settled transactions
        const date = new Date(t.posted * 1000).toISOString().slice(0, 10);
        const amountCents = Math.round(Number(t.amount) * 100);
        if (!Number.isFinite(amountCents)) continue;
        const payee = (t.payee || t.description || "").trim();
        const norm = normalizePayee(payee);
        // For a re-linked account, don't re-add transactions we already have from
        // the old app under different ids.
        if (isAdopted && contentExists.get(accountId, date, amountCents, norm)) continue;
        const hash = importHash(accountId, date, amountCents, payee);
        newTransactions += insertTxn.run(
          accountId,
          date,
          amountCents,
          payee,
          norm,
          (t.memo || t.description || "").trim(),
          t.id,
          hash,
          hid,
          accountId,
          t.id,
          hash
        ).changes;
      }
    }
  });
  run();

  // Instant, free categorization passes; AI is triggered separately.
  const autoCategorized = applyRules(false, hid) + applyMerchantCache(hid);
  setHouseholdSetting(hid, LAST_SYNC_KEY, new Date().toISOString());

  return {
    accounts: accounts.length,
    newTransactions,
    autoCategorized,
    relinked,
    errors: data.errors ?? []
  };
}
