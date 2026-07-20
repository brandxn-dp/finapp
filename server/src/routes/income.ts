import type { FastifyInstance } from "fastify";
import { db, getHouseholdSetting, setHouseholdSetting } from "../db.js";

const PROFILE_KEY = "income_profile";
const NET_KEY = "income_net_monthly";
const GROSS_KEY = "income_gross_monthly";

/**
 * Stores the household's paycheck/tax profile and the resulting take-home pay.
 * The tax math itself lives in the web app (web/src/lib/tax.ts) so the Income
 * page can recompute live; the server just persists the profile plus the final
 * net/gross monthly figures, which the Budget, Debt, and FIRE features read.
 */
export function registerIncomeRoutes(app: FastifyInstance): void {
  app.get("/api/income", async (req) => {
    const hid = req.householdId!;
    const raw = getHouseholdSetting(hid, PROFILE_KEY);
    let profile: unknown = null;
    if (raw) {
      try {
        profile = JSON.parse(raw);
      } catch {
        profile = null;
      }
    }
    const num = (k: string) => {
      const v = getHouseholdSetting(hid, k);
      return v != null && Number.isFinite(Number(v)) ? Number(v) : 0;
    };
    return {
      profile,
      net_monthly_cents: num(NET_KEY),
      gross_monthly_cents: num(GROSS_KEY)
    };
  });

  app.put("/api/income", async (req, reply) => {
    const hid = req.householdId!;
    const b = req.body as { profile?: unknown; net_monthly_cents?: number; gross_monthly_cents?: number };
    if (!b || typeof b.profile !== "object" || b.profile === null) {
      return reply.code(400).send({ error: "A profile object is required." });
    }
    const net = Math.max(0, Math.round(Number(b.net_monthly_cents ?? 0)));
    const gross = Math.max(0, Math.round(Number(b.gross_monthly_cents ?? 0)));
    setHouseholdSetting(hid, PROFILE_KEY, JSON.stringify(b.profile));
    setHouseholdSetting(hid, NET_KEY, String(net));
    setHouseholdSetting(hid, GROSS_KEY, String(gross));
    return { ok: true, net_monthly_cents: net, gross_monthly_cents: gross };
  });

  app.delete("/api/income", async (req) => {
    const hid = req.householdId!;
    db.prepare("DELETE FROM household_settings WHERE household_id = ? AND key IN (?, ?, ?)").run(
      hid,
      PROFILE_KEY,
      NET_KEY,
      GROSS_KEY
    );
    return { ok: true };
  });
}

/** Monthly take-home the household set on the Income page, or null if none. */
export function householdNetMonthly(hid: number): number | null {
  const v = getHouseholdSetting(hid, NET_KEY);
  const n = v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
