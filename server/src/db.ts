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

-- Optional named line items under a budget category ("Transportation" folder →
-- "Car payment" $500 + "Gas" $100). When a category has any line items, its
-- budget total is kept in sync as the sum of them.
CREATE TABLE IF NOT EXISTS budget_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_budget_items_cat ON budget_items(category_id);

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

-- Snapshots of deleted accounts, so a whole account (and its transactions) can be restored
CREATE TABLE IF NOT EXISTS deleted_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  orig_id       INTEGER,
  name          TEXT NOT NULL,
  type          TEXT,
  currency      TEXT,
  balance_cents INTEGER,
  simplefin_id  TEXT,
  txn_count     INTEGER NOT NULL DEFAULT 0,
  deleted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL,
  apr               REAL NOT NULL,
  min_payment_cents INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== Auth & multi-tenancy =====
-- A user is a person who logs in. A household is a data workspace; all financial
-- data belongs to a household, and users are members of one or more households.
-- A solo household = private data; a multi-member household = shared data.
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL DEFAULT '',
  password_hash       TEXT NOT NULL,
  active_household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS households (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS household_members (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',   -- owner | member
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (household_id, user_id)
);

-- Opaque session tokens; only their SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Single-use-ish invite links to join a household.
CREATE TABLE IF NOT EXISTS invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  accepted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Per-household key/value (e.g. include_credit) — distinct from global settings.
CREATE TABLE IF NOT EXISTS household_settings (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
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

// Lightweight migrations: extend deleted_txns into a full trash bin (snapshots
// of what was deleted, so items can be listed and restored).
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(deleted_txns)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  const add: Array<[string, string]> = [
    ["date", "TEXT"],
    ["amount_cents", "INTEGER"],
    ["payee", "TEXT"],
    ["memo", "TEXT"],
    ["category_id", "INTEGER"],
    ["account_name", "TEXT"],
    // Links a tombstoned txn to the deleted_accounts row it went down with, so
    // restoring the account brings its transactions back as a group.
    ["deleted_account_ref", "INTEGER"]
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) db.exec(`ALTER TABLE deleted_txns ADD COLUMN ${name} ${type}`);
  }
}

// Admin flag on users (guarded). The first user is the instance admin; if an
// install predates this column, promote the earliest user so there's always one.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!cols.has("is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  const anyAdmin = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get() as { n: number }).n;
  const anyUser = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  if (anyAdmin === 0 && anyUser > 0) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)").run();
  }
}

// Multi-tenancy migration: every owned table gets a household_id. Existing rows
// keep NULL (= "unclaimed") until the first user claims them into their household.
const OWNED_TABLES = [
  "accounts",
  "transactions",
  "budgets",
  "budget_items",
  "debts",
  "rules",
  "merchant_cache",
  "recurring_overrides",
  "deleted_txns",
  "deleted_accounts"
];
for (const table of OWNED_TABLES) {
  const cols = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!cols.has("household_id")) db.exec(`ALTER TABLE ${table} ADD COLUMN household_id INTEGER`);
}

// Categories were globally UNIQUE(name); per-household they must allow the same
// name in different households. Rebuild once to drop that global constraint and
// add household_id + UNIQUE(household_id, name). Ids are preserved so existing
// transactions/budgets/rules keep pointing at the right rows.
{
  const cols = new Set(
    (db.prepare("PRAGMA table_info(categories)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!cols.has("household_id")) {
    db.pragma("foreign_keys = OFF");
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE categories_new (
          id           INTEGER PRIMARY KEY,
          household_id INTEGER,
          name         TEXT NOT NULL,
          grp          TEXT NOT NULL DEFAULT 'other',
          kind         TEXT NOT NULL DEFAULT 'expense',
          icon         TEXT NOT NULL DEFAULT '',
          is_default   INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO categories_new (id, household_id, name, grp, kind, icon, is_default)
          SELECT id, NULL, name, grp, kind, icon, is_default FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;
        CREATE UNIQUE INDEX idx_cat_hh_name ON categories(household_id, name);
      `);
    });
    rebuild();
    db.pragma("foreign_keys = ON");
  }
}

// merchant_cache and recurring_overrides were keyed by payee_norm alone. Per
// household the same merchant can appear in two households, so widen the key to
// (household_id, payee_norm) by rebuilding the table once.
function widenPayeeKey(table: string, extraCols: string): void {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;
  const hid = info.find((c) => c.name === "household_id");
  if (!hid || hid.pk > 0) return; // already part of the primary key
  const cols = info.map((c) => c.name).join(", ");
  db.pragma("foreign_keys = OFF");
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE ${table}_new (
        household_id INTEGER,
        payee_norm   TEXT NOT NULL,
        ${extraCols},
        PRIMARY KEY (household_id, payee_norm)
      );
      INSERT INTO ${table}_new (${cols}) SELECT ${cols} FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${table}_new RENAME TO ${table};
    `);
  });
  rebuild();
  db.pragma("foreign_keys = ON");
}
widenPayeeKey(
  "merchant_cache",
  "category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, source TEXT NOT NULL DEFAULT 'ai', updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
);
widenPayeeKey(
  "recurring_overrides",
  "status TEXT NOT NULL DEFAULT 'ignored', created_at TEXT NOT NULL DEFAULT (datetime('now'))"
);

// accounts.simplefin_id was globally UNIQUE; two households linking the same bank
// would collide. Rebuild once to make uniqueness per-household instead.
{
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'").get() as {
    sql: string;
  }).sql;
  if (/simplefin_id\s+TEXT\s+UNIQUE/i.test(sql)) {
    db.pragma("foreign_keys = OFF");
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE accounts_new (
          id            INTEGER PRIMARY KEY,
          name          TEXT NOT NULL,
          type          TEXT NOT NULL DEFAULT 'checking',
          currency      TEXT NOT NULL DEFAULT 'USD',
          balance_cents INTEGER NOT NULL DEFAULT 0,
          simplefin_id  TEXT,
          archived      INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          household_id  INTEGER
        );
        INSERT INTO accounts_new (id, name, type, currency, balance_cents, simplefin_id, archived, created_at, household_id)
          SELECT id, name, type, currency, balance_cents, simplefin_id, archived, created_at, household_id FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_new RENAME TO accounts;
        CREATE UNIQUE INDEX idx_acct_hh_sfid ON accounts(household_id, simplefin_id);
      `);
    });
    rebuild();
    db.pragma("foreign_keys = ON");
  }
}

// The above index was originally created PARTIAL (WHERE simplefin_id IS NOT NULL).
// SQLite only accepts a partial index as an `ON CONFLICT(...)` arbiter if the
// conflict clause repeats the same WHERE — so the SimpleFIN sync upsert failed
// with "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
// Rebuild it non-partial (composite NULLs stay distinct, so manual accounts are
// unaffected) on any DB that still has the partial version.
{
  const idx = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_acct_hh_sfid'")
    .get() as { sql: string | null } | undefined;
  if (idx && idx.sql && /where/i.test(idx.sql)) {
    db.exec("DROP INDEX idx_acct_hh_sfid");
    db.exec("CREATE UNIQUE INDEX idx_acct_hh_sfid ON accounts(household_id, simplefin_id)");
  }
}

/** Seed the default category set into a household (used when a new one is created). */
export function seedDefaultCategories(householdId: number): void {
  const ins = db.prepare(
    "INSERT INTO categories (household_id, name, grp, kind, icon, is_default) VALUES (?, ?, ?, ?, ?, 1)"
  );
  const seed = db.transaction(() => {
    for (const [name, grp, kind, icon] of DEFAULT_CATEGORIES) ins.run(householdId, name, grp, kind, icon);
  });
  seed();
}

// Fresh installs seed an unclaimed default category set so the very first user
// has something to claim. Existing installs already have categories (untouched).
const catCount = (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
if (catCount === 0) {
  const ins = db.prepare(
    "INSERT INTO categories (household_id, name, grp, kind, icon, is_default) VALUES (NULL, ?, ?, ?, ?, 1)"
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

// ----- Per-household settings (e.g. include_credit) -----
export function getHouseholdSetting(householdId: number, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM household_settings WHERE household_id = ? AND key = ?")
    .get(householdId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setHouseholdSetting(householdId: number, key: string, value: string): void {
  db.prepare(
    `INSERT INTO household_settings (household_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value`
  ).run(householdId, key, value);
}

// Every table whose rows are owned by a household (categories included).
const HOUSEHOLD_OWNED = [
  "accounts",
  "transactions",
  "categories",
  "budgets",
  "budget_items",
  "debts",
  "rules",
  "merchant_cache",
  "recurring_overrides",
  "deleted_txns",
  "deleted_accounts"
];

/** Count rows not yet assigned to any household (the "before accounts" data). */
export function unclaimedCount(): number {
  let total = 0;
  for (const t of HOUSEHOLD_OWNED) {
    total += (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE household_id IS NULL`).get() as { n: number }).n;
  }
  return total;
}

/** Assign all unclaimed rows to a household — the one-time "claim your data" move. */
export function claimUnclaimedInto(householdId: number): number {
  let moved = 0;
  const run = db.transaction(() => {
    for (const t of HOUSEHOLD_OWNED) {
      moved += db.prepare(`UPDATE ${t} SET household_id = ? WHERE household_id IS NULL`).run(householdId).changes;
    }
  });
  run();
  return moved;
}

/** Permanently delete a household and everything it owns (admin action). */
export function deleteHousehold(householdId: number): void {
  const run = db.transaction(() => {
    for (const t of HOUSEHOLD_OWNED) db.prepare(`DELETE FROM ${t} WHERE household_id = ?`).run(householdId);
    db.prepare("DELETE FROM household_settings WHERE household_id = ?").run(householdId);
    db.prepare("DELETE FROM household_members WHERE household_id = ?").run(householdId);
    db.prepare("DELETE FROM invites WHERE household_id = ?").run(householdId);
    db.prepare("DELETE FROM households WHERE id = ?").run(householdId);
  });
  run();
  db.pragma("wal_checkpoint(TRUNCATE)");
}

/** Delete households that no longer have any members (e.g. after removing a user). */
export function purgeEmptyHouseholds(): number {
  const empties = db
    .prepare("SELECT id FROM households WHERE id NOT IN (SELECT DISTINCT household_id FROM household_members)")
    .all() as Array<{ id: number }>;
  for (const h of empties) deleteHousehold(h.id);
  return empties.length;
}

/** Reset just one household's data (scoped factory reset) and re-seed its categories. */
export function resetHousehold(householdId: number): void {
  const run = db.transaction(() => {
    for (const t of HOUSEHOLD_OWNED) {
      db.prepare(`DELETE FROM ${t} WHERE household_id = ?`).run(householdId);
    }
    db.prepare("DELETE FROM household_settings WHERE household_id = ?").run(householdId);
    seedDefaultCategories(householdId);
  });
  run();
  db.pragma("wal_checkpoint(TRUNCATE)");
}
