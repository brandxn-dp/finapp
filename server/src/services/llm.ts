import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "../db.js";
import { config } from "../config.js";

export interface LlmConfig {
  provider: "anthropic" | "ollama";
  model: string; // resolved for the active provider
  apiKey: string;
  keySource: "app" | "env" | null;
  anthropicModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  configured: boolean;
}

/** Settings saved in the app win; environment variables are the fallback. */
export function resolveLlmConfig(): LlmConfig {
  const provider: LlmConfig["provider"] = getSetting("ai_provider") === "ollama" ? "ollama" : "anthropic";
  const dbKey = getSetting("anthropic_api_key") ?? "";
  const apiKey = dbKey || config.anthropicApiKey;
  const keySource: LlmConfig["keySource"] = dbKey ? "app" : config.anthropicApiKey ? "env" : null;
  const anthropicModel = getSetting("ai_model") || config.claudeModel;
  const ollamaUrl = (getSetting("ollama_url") || "http://localhost:11434").replace(/\/+$/, "");
  const ollamaModel = getSetting("ollama_model") || "";
  return {
    provider,
    model: provider === "ollama" ? ollamaModel : anthropicModel,
    apiKey,
    keySource,
    anthropicModel,
    ollamaUrl,
    ollamaModel,
    configured: provider === "ollama" ? Boolean(ollamaModel) : Boolean(apiKey)
  };
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** When set, the response text is guaranteed (Anthropic) or requested (Ollama) to match this JSON schema. */
  schema?: Record<string, unknown>;
}

/** One completion against whichever provider is configured. Returns the text. */
export async function llmComplete(req: LlmRequest): Promise<string> {
  const cfg = resolveLlmConfig();
  if (!cfg.configured) {
    throw new Error("AI is not configured — add an Anthropic API key or an Ollama model in Settings.");
  }
  return cfg.provider === "ollama" ? ollamaComplete(cfg, req) : anthropicComplete(cfg, req);
}

async function anthropicComplete(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: cfg.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }]
  };
  if (req.schema) {
    params.output_config = {
      format: { type: "json_schema", schema: req.schema as Record<string, unknown> }
    };
  }
  const response = await client.messages.create(params);
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The model response was truncated — try again with a smaller batch.");
  }
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

async function ollamaComplete(cfg: LlmConfig, req: LlmRequest): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user }
        ],
        // Ollama supports structured outputs by passing a JSON schema as `format`
        ...(req.schema ? { format: req.schema } : {}),
        options: { num_predict: req.maxTokens }
      })
    });
  } catch {
    throw new Error(`Couldn't reach Ollama at ${cfg.ollamaUrl} — is it running and reachable from this container?`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama request failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
