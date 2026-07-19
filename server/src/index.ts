import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import "./db.js"; // opens the database and runs migrations/seed
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerTransactionRoutes } from "./routes/transactions.js";
import { registerInsightRoutes } from "./routes/insights.js";
import { registerDebtRoutes } from "./routes/debts.js";
import { registerSimplefinRoutes } from "./routes/simplefin.js";

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024, trustProxy: true });

if (!config.isProd) {
  // In dev the Vite proxy forwards same-origin, so cookies flow; allow credentials.
  await app.register(cors, { origin: true, credentials: true });
}

app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));

// Auth first: this installs the global guard + session resolution used by all routes.
registerAuthRoutes(app);
registerCoreRoutes(app);
registerTransactionRoutes(app);
registerInsightRoutes(app);
registerDebtRoutes(app);
registerSimplefinRoutes(app);

// In production, serve the built PWA and fall back to index.html for client routes
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`FinApp server on http://localhost:${config.port} (data: ${path.resolve(config.dataDir)})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
