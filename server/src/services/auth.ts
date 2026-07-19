import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, seedDefaultCategories } from "../db.js";

const SESSION_COOKIE = "finapp_session";
const SESSION_DAYS = 30;

// ----- Password hashing (scrypt, built into node — no native deps) -----

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ----- Sessions (opaque token; only its hash is stored) -----

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    sha256(token),
    userId,
    expires
  );
  return token;
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Resolve a raw session token to its user id, or null if missing/expired. */
export function userIdForToken(token: string | undefined): number | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(sha256(token)) as { user_id: number; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }
  return row.user_id;
}

// ----- Cookies -----

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionTokenFrom(req: FastifyRequest): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

/** True when the request arrived over HTTPS (directly or via a proxy). */
function isSecure(req: FastifyRequest): boolean {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  return proto === "https" || req.protocol === "https";
}

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string): void {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (isSecure(req)) attrs.push("Secure");
  reply.header("set-cookie", attrs.join("; "));
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply): void {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecure(req)) attrs.push("Secure");
  reply.header("set-cookie", attrs.join("; "));
}

// ----- Login rate limiting / lockout (in-memory; matters for internet exposure) -----

const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const attempts = new Map<string, { fails: number; until: number }>();

export function loginBlocked(key: string): number {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}

export function recordFail(key: string): void {
  const a = attempts.get(key) ?? { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.until = Date.now() + LOCK_MS;
    a.fails = 0;
  }
  attempts.set(key, a);
}

export function clearFails(key: string): void {
  attempts.delete(key);
}

// ----- Users & households -----

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  active_household_id: number | null;
  is_admin: number;
}

export function isAdmin(userId: number): boolean {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}

export function setAdmin(userId: number, admin: boolean): void {
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, userId);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as UserRow | undefined;
}

export function userById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

/** The only user allowed to claim pre-existing (unclaimed) data is the very first. */
export function isFirstUser(userId: number): boolean {
  const row = db.prepare("SELECT MIN(id) AS first FROM users").get() as { first: number | null };
  return row.first === userId;
}

export function createHousehold(name: string): number {
  return db.prepare("INSERT INTO households (name) VALUES (?)").run(name).lastInsertRowid as number;
}

export function addMember(householdId: number, userId: number, role: "owner" | "member"): void {
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)
     ON CONFLICT(household_id, user_id) DO NOTHING`
  ).run(householdId, userId, role);
}

export function isMember(householdId: number, userId: number): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?")
      .get(householdId, userId)
  );
}

export function householdsForUser(userId: number): Array<{ id: number; name: string; role: string; members: number }> {
  return db
    .prepare(
      `SELECT h.id, h.name, hm.role,
              (SELECT COUNT(*) FROM household_members m WHERE m.household_id = h.id) AS members
       FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       WHERE hm.user_id = ?
       ORDER BY h.id`
    )
    .all(userId) as Array<{ id: number; name: string; role: string; members: number }>;
}

/** The user's active household id, falling back to (and persisting) their first membership. */
export function resolveActiveHousehold(user: UserRow): number | null {
  if (user.active_household_id && isMember(user.active_household_id, user.id)) {
    return user.active_household_id;
  }
  const first = db
    .prepare("SELECT household_id FROM household_members WHERE user_id = ? ORDER BY household_id LIMIT 1")
    .get(user.id) as { household_id: number } | undefined;
  if (!first) return null;
  db.prepare("UPDATE users SET active_household_id = ? WHERE id = ?").run(first.household_id, user.id);
  return first.household_id;
}

export function setActiveHousehold(userId: number, householdId: number): void {
  db.prepare("UPDATE users SET active_household_id = ? WHERE id = ?").run(householdId, userId);
}

/**
 * Create a user with their own personal household. Returns ids. If seeding is
 * requested, the new household gets the default category set; the very first
 * user on an install with pre-existing data skips seeding so they can instead
 * claim that data (which brings its own categories).
 */
export function createUser(
  email: string,
  name: string,
  password: string,
  seedCategories: boolean
): { userId: number; householdId: number } {
  const run = db.transaction(() => {
    const userId = db
      .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
      .run(email.toLowerCase(), name, hashPassword(password)).lastInsertRowid as number;
    const householdName = name.trim() ? `${name.trim()}'s Household` : "My Household";
    const householdId = createHousehold(householdName);
    addMember(householdId, userId, "owner");
    db.prepare("UPDATE users SET active_household_id = ? WHERE id = ?").run(householdId, userId);
    if (seedCategories) seedDefaultCategories(householdId);
    return { userId, householdId };
  });
  return run();
}
