import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { db, deleteHousehold, purgeEmptyHouseholds } from "../db.js";
import { isAdmin, setAdmin } from "../services/auth.js";

const startedAt = Date.now();

/** Count admins, so we never demote or delete the last one. */
function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1").get() as { n: number }).n;
}

export function registerAdminRoutes(app: FastifyInstance): void {
  // Every /api/admin route requires an admin session (on top of the global guard).
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!isAdmin(req.userId!)) {
      reply.code(403).send({ error: "Admins only." });
      return false;
    }
    return true;
  };

  app.get("/api/admin/overview", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    let dbBytes = 0;
    try {
      dbBytes = fs.statSync(path.join(config.dataDir, "finapp.sqlite")).size;
    } catch {
      /* ignore */
    }
    return {
      users: one("SELECT COUNT(*) AS n FROM users"),
      admins: adminCount(),
      households: one("SELECT COUNT(*) AS n FROM households"),
      memberships: one("SELECT COUNT(*) AS n FROM household_members"),
      accounts: one("SELECT COUNT(*) AS n FROM accounts"),
      transactions: one("SELECT COUNT(*) AS n FROM transactions"),
      budgets: one("SELECT COUNT(*) AS n FROM budgets"),
      debts: one("SELECT COUNT(*) AS n FROM debts"),
      categories: one("SELECT COUNT(*) AS n FROM categories"),
      active_sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > datetime('now')"),
      pending_invites: one("SELECT COUNT(*) AS n FROM invites WHERE accepted_at IS NULL AND expires_at > datetime('now')"),
      unclaimed_accounts: one("SELECT COUNT(*) AS n FROM accounts WHERE household_id IS NULL"),
      db_bytes: dbBytes,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      registration_open: process.env.REGISTRATION_INVITE_ONLY !== "1"
    };
  });

  app.get("/api/admin/users", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      users: db
        .prepare(
          `SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.active_household_id,
                  (SELECT COUNT(*) FROM household_members hm WHERE hm.user_id = u.id) AS households,
                  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > datetime('now')) AS active_sessions
           FROM users u ORDER BY u.id`
        )
        .all()
    };
  });

  app.get("/api/admin/households", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const households = db
      .prepare(
        `SELECT h.id, h.name, h.created_at,
                (SELECT COUNT(*) FROM household_members hm WHERE hm.household_id = h.id) AS members,
                (SELECT COUNT(*) FROM accounts a WHERE a.household_id = h.id) AS accounts,
                (SELECT COUNT(*) FROM transactions t WHERE t.household_id = h.id) AS transactions
         FROM households h ORDER BY h.id`
      )
      .all() as Array<{ id: number; name: string; created_at: string; members: number; accounts: number; transactions: number }>;
    const memberRows = db
      .prepare(
        `SELECT hm.household_id, u.email, u.name, hm.role
         FROM household_members hm JOIN users u ON u.id = hm.user_id ORDER BY hm.role, u.name`
      )
      .all() as Array<{ household_id: number; email: string; name: string; role: string }>;
    const byHh = new Map<number, Array<{ email: string; name: string; role: string }>>();
    for (const m of memberRows) {
      if (!byHh.has(m.household_id)) byHh.set(m.household_id, []);
      byHh.get(m.household_id)!.push({ email: m.email, name: m.name, role: m.role });
    }
    return { households: households.map((h) => ({ ...h, member_list: byHh.get(h.id) ?? [] })) };
  });

  // ----- Admin actions -----

  app.post("/api/admin/users/:id/admin", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const makeAdmin = Boolean((req.body as { admin?: boolean })?.admin);
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) {
      return reply.code(404).send({ error: "User not found." });
    }
    if (!makeAdmin && adminCount() <= 1 && isAdmin(id)) {
      return reply.code(400).send({ error: "Can't remove the last admin." });
    }
    setAdmin(id, makeAdmin);
    return { ok: true };
  });

  app.post("/api/admin/users/:id/logout", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const info = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return { ok: true, revoked: info.changes };
  });

  app.delete("/api/admin/users/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (id === req.userId!) return reply.code(400).send({ error: "You can't delete your own account here." });
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) {
      return reply.code(404).send({ error: "User not found." });
    }
    if (isAdmin(id) && adminCount() <= 1) return reply.code(400).send({ error: "Can't delete the last admin." });
    // FK cascades remove the user's sessions and memberships; then clean up any
    // household left with no members (and all its data).
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    const purged = purgeEmptyHouseholds();
    return { ok: true, households_removed: purged };
  });

  app.delete("/api/admin/households/:id", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (!db.prepare("SELECT 1 FROM households WHERE id = ?").get(id)) {
      return reply.code(404).send({ error: "Household not found." });
    }
    deleteHousehold(id);
    return { ok: true };
  });
}
