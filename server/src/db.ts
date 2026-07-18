import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db: Database.Database = new Database(path.join(config.dataDir, "finapp.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'checking',
  currency      TEXT NOT NULL DEFAULT 'USD',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  simplefin_id  TEXT UNIQUE,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  grp        TEXT NOT NULL DEFAULT 'other',   -- income | essential | lifestyle | savings | other
  kind       TEXT NOT NULL DEFAULT 'expense', -- expense | income | transfer
  icon       TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL,           -- negative = money out, positive = money in
  payee          TEXT NOT NULL DEFAULT '',
  payee_norm     TEXT NOT NULL DEFAULT '',
  memo           TEXT NOT NULL DEFAULT '',
  category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  categorized_by TEXT,                       -- 'rule' | 'cache' | 'ai' | 'manual'
  external_id    TEXT,                       -- SimpleFIN transaction id
  import_hash    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_cat  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_hash ON transactions(import_hash);
CREATE INDEX IF NOT EXISTS idx_txn_norm ON transactions(payee_norm);

CREATE TABLE IF NOT EXISTS merchant_cache (
  payee_norm  TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'ai',   -- 'ai' | 'manual'
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,                -- lowercase substring matched against payee
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  category_id   INTEGER PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  monthly_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_overrides (
  payee_norm TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'ignored',  -- 'ignored' = user says this is not a real bill/subscription
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tombstones so user-deleted transactions stay deleted across re-syncs/re-imports
CREATE TABLE IF NOT EXISTS deleted_txns (
  account_id  INTEGER NOT NULL,
  external_id TEXT,
  import_hash TEXT,
  deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deleted_ext  ON deleted_txns(account_id, external_id);
CREATE INDEX IF NOT EXISTS idx_deleted_hash ON deleted_txns(account_id, import_hash);

CREATE TABLE IF NOT EXISTS debts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL,
  apr               REAL NOT NULL,
  min_payment_cents INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const DEFAULT_CATEGORIES: Array<[name: string, grp: string, kind: string, icon: string]> = [
  ["Salary", "income", "income", "💼"],
  ["Other Income", "income", "income", "🪙"],
  ["Rent & Mortgage", "essential", "expense", "🏠"],
  ["Utilities", "essential", "expense", "💡"],
  ["Groceries", "essential", "expense", "🛒"],
  ["Transportation", "essential", "expense", "🚗"],
  ["Insurance", "essential", "expense", "🛡️"],
  ["Healthcare", "essential", "expense", "🩺"],
  ["Debt Payments", "essential", "expense", "💳"],
  ["Childcare & Education", "essential", "expense", "🎓"],
  ["Dining Out", "lifestyle", "expense", "🍜"],
  ["Entertainment", "lifestyle", "expense", "🎬"],
  ["Shopping", "lifestyle", "expense", "🛍️"],
  ["Subscriptions", "lifestyle", "expense", "📺"],
  ["Travel", "lifestyle", "expense", "✈️"],
  ["Personal Care", "lifestyle", "expense", "💈"],
  ["Gifts & Donations", "lifestyle", "expense", "🎁"],
  ["Pets", "lifestyle", "expense", "🐾"],
  ["Savings", "savings", "expense", "🏦"],
  ["Investments", "savings", "expense", "📈"],
  ["Fees & Charges", "other", "expense", "🧾"],
  ["Transfers", "other", "transfer", "🔁"],
  ["Miscellaneous", "other", "expense", "📦"]
];

const catCount = (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
if (catCount === 0) {
  const ins = db.prepare(
    "INSERT INTO categories (name, grp, kind, icon, is_default) VALUES (?, ?, ?, ?, 1)"
  );
  const seed = db.transaction(() => {
    for (const [name, grp, kind, icon] of DEFAULT_CATEGORIES) ins.run(name, grp, kind, icon);
  });
  seed();
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
