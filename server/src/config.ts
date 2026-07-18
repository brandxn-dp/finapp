import path from "node:path";

export const config = {
  port: Number(process.env.PORT ?? 8484),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), "..", "data"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-4-8",
  // In production the server also serves the built PWA
  webDist: process.env.WEB_DIST ?? path.resolve(process.cwd(), "..", "web", "dist"),
  isProd: process.env.NODE_ENV === "production"
};
