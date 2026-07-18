import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db.js";
import { config } from "../config.js";

interface CategoryRow {
  id: number;
  name: string;
  grp: string;
  kind: string;
}

interface PayeeSample {
  payee_norm: string;
  payee: string;
  memo: string;
  avg_cents: number;
  count: number;
}

export interface CategorizeResult {
  byRule: number;
  byCache: number;
  byAi: number;
  newMerchants: number;
  remaining: number;
  aiUsed: boolean;
  error?: string;
}

/**
 * Categorization pipeline, cheapest first:
 *  1. user rules (substring match on payee)
 *  2. merchant cache (payees seen before, AI or manual)
 *  3. Claude, batched — only genuinely new merchants, results cached forever
 */
export async function runCategorization(useAi: boolean): Promise<CategorizeResult> {
  const result: CategorizeResult = {
    byRule: applyRules(),
    byCache: applyMerchantCache(),
    byAi: 0,
    newMerchants: 0,
    remaining: 0,
    aiUsed: false
  };

  if (useAi && config.anthropicApiKey) {
    try {
      const ai = await aiCategorizeNewMerchants();
      result.byAi = ai.updated;
      result.newMerchants = ai.newMerchants;
      result.aiUsed = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  result.remaining = (
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL").get() as {
      n: number;
    }
  ).n;
  return result;
}

/** Apply user rules to uncategorized transactions. Returns rows updated. */
export function applyRules(): number {
  const rules = db
    .prepare("SELECT id, pattern, category_id FROM rules ORDER BY length(pattern) DESC")
    .all() as Array<{ id: number; pattern: string; category_id: number }>;
  if (rules.length === 0) return 0;

  const update = db.prepare(
    `UPDATE transactions SET category_id = ?, categorized_by = 'rule'
     WHERE category_id IS NULL AND (lower(payee) LIKE ? OR lower(memo) LIKE ?)`
  );
  let total = 0;
  const run = db.transaction(() => {
    for (const r of rules) {
      const like = `%${r.pattern.toLowerCase()}%`;
      total += update.run(r.category_id, like, like).changes;
    }
  });
  run();
  return total;
}

/** Apply the merchant cache to uncategorized transactions. Returns rows updated. */
export function applyMerchantCache(): number {
  return db
    .prepare(
      `UPDATE transactions SET
         category_id = (SELECT mc.category_id FROM merchant_cache mc WHERE mc.payee_norm = transactions.payee_norm),
         categorized_by = 'cache'
       WHERE category_id IS NULL
         AND payee_norm != ''
         AND EXISTS (SELECT 1 FROM merchant_cache mc WHERE mc.payee_norm = transactions.payee_norm)`
    )
    .run().changes;
}

/**
 * Remember a manual categorization so every future transaction from the same
 * merchant gets it without asking the AI again. Manual always outranks AI.
 */
export function rememberManualChoice(payeeNorm: string, categoryId: number): void {
  if (!payeeNorm) return;
  db.prepare(
    `INSERT INTO merchant_cache (payee_norm, category_id, source, updated_at)
     VALUES (?, ?, 'manual', datetime('now'))
     ON CONFLICT(payee_norm) DO UPDATE SET category_id = excluded.category_id, source = 'manual', updated_at = datetime('now')`
  ).run(payeeNorm, categoryId);
}

const BATCH_SIZE = 80;

async function aiCategorizeNewMerchants(): Promise<{ updated: number; newMerchants: number }> {
  // Distinct merchants with uncategorized transactions that the cache has never seen
  const pending = db
    .prepare(
      `SELECT t.payee_norm,
              MIN(t.payee)  AS payee,
              MIN(t.memo)   AS memo,
              CAST(AVG(t.amount_cents) AS INTEGER) AS avg_cents,
              COUNT(*)      AS count
       FROM transactions t
       WHERE t.category_id IS NULL
         AND t.payee_norm != ''
         AND NOT EXISTS (SELECT 1 FROM merchant_cache mc WHERE mc.payee_norm = t.payee_norm)
       GROUP BY t.payee_norm
       ORDER BY count DESC`
    )
    .all() as PayeeSample[];

  if (pending.length === 0) return { updated: 0, newMerchants: 0 };

  const categories = db
    .prepare("SELECT id, name, grp, kind FROM categories ORDER BY grp, name")
    .all() as CategoryRow[];
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  let updated = 0;
  let newMerchants = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const assignments = await classifyBatch(client, categories, batch);

    const upsertCache = db.prepare(
      `INSERT INTO merchant_cache (payee_norm, category_id, source, updated_at)
       VALUES (?, ?, 'ai', datetime('now'))
       ON CONFLICT(payee_norm) DO NOTHING`
    );
    const updateTxns = db.prepare(
      `UPDATE transactions SET category_id = ?, categorized_by = 'ai'
       WHERE category_id IS NULL AND payee_norm = ?`
    );

    const apply = db.transaction(() => {
      for (const a of assignments) {
        const cat = byName.get(a.category.toLowerCase());
        if (!cat) continue; // model returned an unknown category name — leave uncategorized
        upsertCache.run(a.payee_norm, cat.id);
        newMerchants++;
        updated += updateTxns.run(cat.id, a.payee_norm).changes;
      }
    });
    apply();
  }

  return { updated, newMerchants };
}

async function classifyBatch(
  client: Anthropic,
  categories: CategoryRow[],
  batch: PayeeSample[]
): Promise<Array<{ payee_norm: string; category: string }>> {
  const categoryList = categories
    .map((c) => `- ${c.name} (${c.grp}, ${c.kind})`)
    .join("\n");
  const merchantList = batch
    .map((p, idx) => {
      const dir = p.avg_cents < 0 ? "money out" : "money in";
      const memo = p.memo && p.memo !== p.payee ? ` | memo: ${p.memo.slice(0, 60)}` : "";
      return `${idx}. key="${p.payee_norm}" | raw="${p.payee.slice(0, 80)}"${memo} | avg $${Math.abs(p.avg_cents / 100).toFixed(2)} ${dir} | seen ${p.count}x`;
    })
    .join("\n");

  const schema = {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            category: { type: "string" }
          },
          required: ["index", "category"],
          additionalProperties: false
        }
      }
    },
    required: ["assignments"],
    additionalProperties: false
  } as const;

  const response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 16000,
    system:
      "You classify bank transaction merchants into personal budgeting categories. " +
      "Pick exactly one category name from the provided list for each merchant, copied verbatim. " +
      "Use the amount direction as a hint (money in is usually income; money out is spending). " +
      "Transfers between own accounts, credit card payments described as payments, and Zelle/Venmo between people go to Transfers. " +
      "If a merchant is genuinely unrecognizable, use Miscellaneous.",
    messages: [
      {
        role: "user",
        content: `Categories:\n${categoryList}\n\nMerchants to classify:\n${merchantList}\n\nReturn one assignment per merchant, using each merchant's list index.`
      }
    ],
    output_config: { format: { type: "json_schema", schema } }
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to process this batch.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Categorization response was truncated; try again (smaller batch).");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text) as { assignments: Array<{ index: number; category: string }> };
  return parsed.assignments
    .filter((a) => Number.isInteger(a.index) && a.index >= 0 && a.index < batch.length)
    .map((a) => ({ payee_norm: batch[a.index].payee_norm, category: a.category }));
}
