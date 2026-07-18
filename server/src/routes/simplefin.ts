import type { FastifyInstance } from "fastify";
import { claimSetupToken, disconnect, isConnected, lastSync, sync } from "../services/simplefin.js";

export function registerSimplefinRoutes(app: FastifyInstance): void {
  app.get("/api/simplefin/status", async () => {
    return { connected: isConnected(), last_sync: lastSync() };
  });

  app.post("/api/simplefin/claim", async (req, reply) => {
    const b = req.body as { token?: string };
    if (!b?.token?.trim()) return reply.code(400).send({ error: "Setup token is required." });
    try {
      await claimSetupToken(b.token);
      return { connected: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/simplefin/sync", async (_req, reply) => {
    try {
      return await sync();
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/simplefin", async () => {
    disconnect();
    return { connected: false };
  });
}
