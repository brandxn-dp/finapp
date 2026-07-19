import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db, unclaimedCount, claimUnclaimedInto } from "../db.js";
import {
  addMember,
  clearFails,
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  findUserByEmail,
  householdsForUser,
  createHousehold,
  isFirstUser,
  isMember,
  loginBlocked,
  recordFail,
  resolveActiveHousehold,
  sessionTokenFrom,
  setActiveHousehold,
  setAdmin,
  setSessionCookie,
  userById,
  userIdForToken,
  verifyPassword
} from "../services/auth.js";
import { seedDefaultCategories } from "../db.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: number | null;
    householdId: number | null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const registrationOpen = process.env.REGISTRATION_INVITE_ONLY !== "1";

/** Public shape of the current user + their households. */
function medata(userId: number) {
  const user = userById(userId);
  if (!user) return { user: null };
  const households = householdsForUser(userId);
  const active = resolveActiveHousehold(user);
  return {
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin === 1 },
    households,
    active_household_id: active,
    is_first_user: isFirstUser(userId),
    is_admin: user.is_admin === 1,
    unclaimed_count: isFirstUser(userId) ? unclaimedCount() : 0
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.decorateRequest("userId", null);
  app.decorateRequest("householdId", null);

  // Public API routes that don't require a session.
  const PUBLIC = new Set([
    "/api/health",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/me"
  ]);

  // Global guard: resolve the session for every request, and require auth +
  // an active household for every /api route that isn't explicitly public.
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/")) return; // static assets / SPA fallback

    const uid = userIdForToken(sessionTokenFrom(req));
    if (uid) {
      const user = userById(uid);
      if (user) {
        req.userId = uid;
        req.householdId = resolveActiveHousehold(user);
      }
    }

    if (PUBLIC.has(path)) return;
    if (!req.userId) return reply.code(401).send({ error: "Not signed in." });
    // Household-management, admin, and auth routes work without an active household
    // (a user who left/deleted all of theirs must still be able to create or join one).
    const householdOptional =
      path.startsWith("/api/households") || path.startsWith("/api/admin") || path.startsWith("/api/auth");
    if (!householdOptional && !req.householdId) return reply.code(403).send({ error: "No active household." });
  });

  // ----- Register / login / logout / me -----

  app.post("/api/auth/register", async (req, reply) => {
    if (!registrationOpen) {
      return reply.code(403).send({ error: "Open registration is disabled on this server." });
    }
    const b = req.body as { email?: string; name?: string; password?: string };
    const email = (b?.email ?? "").trim().toLowerCase();
    const name = (b?.name ?? "").trim();
    const password = b?.password ?? "";
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: "Enter a valid email address." });
    if (password.length < 8) return reply.code(400).send({ error: "Password must be at least 8 characters." });
    if (findUserByEmail(email)) return reply.code(409).send({ error: "An account with that email already exists." });

    // The first user on an install that already has data skips category seeding
    // so they can claim the existing (unclaimed) data, which carries its own.
    const firstEver = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n === 0;
    const hasUnclaimed = unclaimedCount() > 0;
    const seed = !(firstEver && hasUnclaimed);

    const { userId } = createUser(email, name, password, seed);
    if (firstEver) setAdmin(userId, true); // the first account runs the instance
    const token = createSession(userId);
    setSessionCookie(req, reply, token);
    return medata(userId);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const b = req.body as { email?: string; password?: string };
    const email = (b?.email ?? "").trim().toLowerCase();
    const password = b?.password ?? "";
    const key = `${email}|${req.ip}`;
    const wait = loginBlocked(key);
    if (wait > 0) {
      return reply.code(429).send({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
    }
    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFail(key);
      return reply.code(401).send({ error: "Wrong email or password." });
    }
    clearFails(key);
    const token = createSession(user.id);
    setSessionCookie(req, reply, token);
    return medata(user.id);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = sessionTokenFrom(req);
    if (token) destroySession(token);
    clearSessionCookie(req, reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    if (!req.userId) return { user: null, registration_open: registrationOpen };
    return { ...medata(req.userId), registration_open: registrationOpen };
  });

  // ----- Households -----

  app.post("/api/households", async (req, reply) => {
    const name = ((req.body as { name?: string })?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "Household name is required." });
    const id = createHousehold(name);
    addMember(id, req.userId!, "owner");
    seedDefaultCategories(id);
    setActiveHousehold(req.userId!, id);
    return medata(req.userId!);
  });

  app.post("/api/households/switch", async (req, reply) => {
    const id = Number((req.body as { household_id?: number })?.household_id);
    if (!Number.isInteger(id) || !isMember(id, req.userId!)) {
      return reply.code(400).send({ error: "You're not a member of that household." });
    }
    setActiveHousehold(req.userId!, id);
    return medata(req.userId!);
  });

  app.get("/api/households/:id/members", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!isMember(id, req.userId!)) return reply.code(403).send({ error: "Not your household." });
    const members = db
      .prepare(
        `SELECT u.id, u.email, u.name, hm.role
         FROM household_members hm JOIN users u ON u.id = hm.user_id
         WHERE hm.household_id = ? ORDER BY hm.role, u.name`
      )
      .all(id);
    return { members };
  });

  app.delete("/api/households/:id/members/:userId", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const target = Number((req.params as { userId: string }).userId);
    if (!isMember(id, req.userId!)) return reply.code(403).send({ error: "Not your household." });
    const role = db
      .prepare("SELECT role FROM household_members WHERE household_id = ? AND user_id = ?")
      .get(id, req.userId!) as { role: string } | undefined;
    // You can always remove yourself (leave); only an owner can remove others.
    if (target !== req.userId! && role?.role !== "owner") {
      return reply.code(403).send({ error: "Only an owner can remove other members." });
    }
    const members = (db.prepare("SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?").get(id) as {
      n: number;
    }).n;
    if (members <= 1) return reply.code(400).send({ error: "Can't remove the last member of a household." });
    db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(id, target);
    return { ok: true };
  });

  // ----- Invites -----

  app.post("/api/households/:id/invites", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!isMember(id, req.userId!)) return reply.code(403).send({ error: "Not your household." });
    const token = crypto.randomBytes(18).toString("base64url");
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    db.prepare(
      "INSERT INTO invites (household_id, token, created_by, expires_at) VALUES (?, ?, ?, ?)"
    ).run(id, token, req.userId!, expires);
    return { token, expires_at: expires };
  });

  // Look up an invite (to show "Join <household>?") — must be signed in.
  app.get("/api/invites/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const inv = db
      .prepare(
        `SELECT i.household_id, i.expires_at, i.accepted_at, h.name AS household_name
         FROM invites i JOIN households h ON h.id = i.household_id WHERE i.token = ?`
      )
      .get(token) as
      | { household_id: number; expires_at: string; accepted_at: string | null; household_name: string }
      | undefined;
    if (!inv) return reply.code(404).send({ error: "Invite not found." });
    const valid = !inv.accepted_at && Date.parse(inv.expires_at) > Date.now();
    return { household_name: inv.household_name, valid, already_member: isMember(inv.household_id, req.userId!) };
  });

  app.post("/api/households/join", async (req, reply) => {
    const token = ((req.body as { token?: string })?.token ?? "").trim();
    const inv = db.prepare("SELECT * FROM invites WHERE token = ?").get(token) as
      | { id: number; household_id: number; expires_at: string; accepted_at: string | null }
      | undefined;
    if (!inv) return reply.code(404).send({ error: "Invite not found." });
    if (inv.accepted_at) return reply.code(410).send({ error: "That invite has already been used." });
    if (Date.parse(inv.expires_at) < Date.now()) return reply.code(410).send({ error: "That invite has expired." });
    addMember(inv.household_id, req.userId!, "member");
    db.prepare("UPDATE invites SET accepted_at = datetime('now'), accepted_by = ? WHERE id = ?").run(
      req.userId!,
      inv.id
    );
    setActiveHousehold(req.userId!, inv.household_id);
    return medata(req.userId!);
  });

  // ----- Claim pre-existing (unclaimed) data -----

  app.get("/api/claim/status", async (req) => {
    const canClaim = isFirstUser(req.userId!);
    return { can_claim: canClaim, unclaimed: canClaim ? unclaimedCount() : 0 };
  });

  app.post("/api/claim", async (req, reply) => {
    if (!isFirstUser(req.userId!)) {
      return reply.code(403).send({ error: "Only the first account can claim the original data." });
    }
    const moved = claimUnclaimedInto(req.householdId!);
    return { ok: true, moved };
  });
}
