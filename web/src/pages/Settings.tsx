import { useEffect, useState } from "react";
import { api, useApi } from "../lib/api";
import type { Account, Category, Rule, Settings as AppSettings, TrashItem } from "../lib/api";
import { money, shortDate } from "../lib/format";
import { useTheme } from "../lib/theme";
import { Button, Card, Icon, Input, PageHeader, Select, Spinner, useToast } from "../components/ui";

const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "retirement", "loan", "cash", "other"];

export default function Settings() {
  const { theme, toggle } = useTheme();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        action={
          <Button variant="ghost" size="sm" onClick={toggle}>
            <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
        }
      />
      <SimplefinCard />
      <AiCard />
      <AccountsCard />
      <RulesCard />
      <CategoriesCard />
      <TrashCard />
      <p className="text-[11px] text-ink3">
        FinApp is self-hosted: your data lives in a single SQLite file on your server. Deleted transactions sit in
        the Trash above and are remembered so bank syncs can't re-import them. The AI features send only
        merchant names and aggregated statistics to the Anthropic API — never account numbers or balances per
        transaction. Insights are educational, not professional financial advice.
      </p>
    </div>
  );
}

function SimplefinCard() {
  const { data: st, refetch } = useApi<AppSettings>("/api/settings");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();

  const claim = async () => {
    setBusy("claim");
    try {
      await api.post("/api/simplefin/claim", { token });
      setToken("");
      toast("SimpleFIN connected. Run a sync to pull your accounts.", "good");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      const r = await api.post<{ accounts: number; newTransactions: number; autoCategorized: number }>(
        "/api/simplefin/sync"
      );
      toast(
        `Synced ${r.accounts} accounts — ${r.newTransactions} new transactions, ${r.autoCategorized} auto-categorized.`,
        "good"
      );
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    await api.del("/api/simplefin");
    toast("SimpleFIN disconnected. Existing transactions were kept.", "info");
    refetch();
  };

  return (
    <Card title="Bank sync (SimpleFIN)">
      {st?.simplefin_connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-3 py-1 text-xs font-medium text-good">
            <Icon name="check" size={12} /> Connected
          </span>
          {st.simplefin_last_sync && (
            <span className="text-xs text-ink3">
              last sync {new Date(st.simplefin_last_sync).toLocaleString()}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={sync} disabled={busy !== null}>
              {busy === "sync" ? <Spinner /> : <Icon name="refresh" size={14} />} Sync now
            </Button>
            <Button size="sm" variant="danger" onClick={disconnect}>Disconnect</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink2">
            SimpleFIN Bridge (~$1.50/mo) connects US &amp; Canadian banks. Create an account at{" "}
            <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noreferrer" className="text-accent underline">
              beta-bridge.simplefin.org
            </a>
            , link your bank, generate a <strong>setup token</strong>, and paste it here. The token is claimed once and
            exchanged for a private access URL stored only on your server.
          </p>
          <div className="flex gap-2">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste SimpleFIN setup token…"
              className="w-full max-w-md"
            />
            <Button onClick={claim} disabled={!token.trim() || busy !== null}>
              {busy === "claim" ? <Spinner /> : <Icon name="link" size={14} />} Connect
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const CLAUDE_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — budget" }
];

function AiCard() {
  const { data: st, refetch } = useApi<AppSettings>("/api/settings");
  const { toast } = useToast();
  const [provider, setProvider] = useState<"anthropic" | "ollama">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-opus-4-8");
  const [customModel, setCustomModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!st) return;
    setProvider(st.ai_provider);
    const known = CLAUDE_MODELS.some((m) => m.id === st.anthropic_model);
    setModel(known ? st.anthropic_model : "custom");
    setCustomModel(known ? "" : st.anthropic_model);
    setOllamaUrl(st.ollama_url);
    setOllamaModel(st.ollama_model);
  }, [st]);

  const save = async () => {
    setBusy(true);
    try {
      const resolvedModel = model === "custom" ? customModel.trim() : model;
      await api.put("/api/settings", {
        ai_provider: provider,
        // Empty key input means "keep what's stored" — clearing is explicit via the button
        ...(apiKey.trim() ? { anthropic_api_key: apiKey.trim() } : {}),
        ai_model: resolvedModel,
        ollama_url: ollamaUrl.trim(),
        ollama_model: ollamaModel.trim()
      });
      setApiKey("");
      toast("AI settings saved.", "good");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    await api.put("/api/settings", { anthropic_api_key: "" });
    toast("Stored API key removed.", "info");
    refetch();
  };

  return (
    <Card
      title="AI categorization & insights"
      action={
        st ? (
          st.ai_configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-3 py-1 text-xs font-medium text-good">
              <Icon name="check" size={12} /> {st.ai_provider === "ollama" ? `Ollama · ${st.model}` : st.model}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/10 px-3 py-1 text-xs font-medium text-warn">
              <Icon name="alert" size={12} /> Not configured
            </span>
          )
        ) : undefined
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Provider</span>
          <Select value={provider} onChange={(e) => setProvider(e.target.value as "anthropic" | "ollama")}>
            <option value="anthropic">Anthropic Claude (cloud API)</option>
            <option value="ollama">Ollama (local model on your server)</option>
          </Select>
        </label>

        {provider === "anthropic" ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-64 flex-1">
                <span className="mb-1 block text-xs font-medium text-ink2">
                  API key{" "}
                  {st?.anthropic_key_set && (
                    <span className="text-good">
                      · configured{st.anthropic_key_source === "env" ? " via environment variable" : ""}
                    </span>
                  )}
                </span>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={st?.anthropic_key_set ? "•••••••• (leave blank to keep)" : "sk-ant-…"}
                  className="w-full"
                  autoComplete="off"
                />
              </label>
              {st?.anthropic_key_source === "app" && (
                <Button variant="ghost" size="sm" onClick={clearKey}>Remove stored key</Button>
              )}
            </div>
            <p className="text-[11px] text-ink3">
              Get a key at{" "}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-accent underline">
                console.anthropic.com
              </a>
              . Stored only in your SQLite file on your server. Merchants are classified once and remembered, so a
              year of statements costs pennies.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink2">Model</span>
                <Select value={model} onChange={(e) => setModel(e.target.value)}>
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  <option value="custom">Custom model id…</option>
                </Select>
              </label>
              {model === "custom" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink2">Custom model id</span>
                  <Input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="claude-…" className="w-56" />
                </label>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <label className="block min-w-64 flex-1">
                <span className="mb-1 block text-xs font-medium text-ink2">Ollama URL</span>
                <Input
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://192.168.1.10:11434"
                  className="w-full"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink2">Model</span>
                <Input value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} placeholder="e.g. llama3.1:8b" className="w-44" />
              </label>
            </div>
            <p className="text-[11px] text-ink3">
              Runs fully local — nothing leaves your network. Use your server's LAN address, not{" "}
              <code className="rounded bg-surface2 px-1 py-0.5">localhost</code> (FinApp runs inside a container).
              Small local models are noticeably less accurate at categorization than Claude; expect to correct more.
            </p>
          </>
        )}

        <div className="flex justify-end border-t border-line pt-3">
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="check" size={14} />} Save AI settings
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AccountsCard() {
  const { data: accounts, refetch } = useApi<Account[]>("/api/accounts");
  const [name, setName] = useState("");
  const { toast } = useToast();

  const add = async () => {
    if (!name.trim()) return;
    await api.post("/api/accounts", { name: name.trim() });
    setName("");
    refetch();
  };

  const update = async (id: number, body: Record<string, unknown>) => {
    await api.patch(`/api/accounts/${id}`, body);
    refetch();
  };

  const remove = async (a: Account) => {
    if (!window.confirm(`Delete "${a.name}" and its ${a.txn_count} transactions? This cannot be undone.`)) return;
    try {
      await api.del(`/api/accounts/${a.id}`);
      toast(`Deleted ${a.name}.`, "info");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const autoType = async () => {
    const r = await api.post<{ changed: number; changes: Array<{ name: string; to: string }> }>(
      "/api/accounts/auto-type"
    );
    toast(
      r.changed === 0
        ? "All account types already look right."
        : `Reclassified ${r.changed}: ${r.changes.map((c) => `${c.name} → ${c.to}`).join(", ")}`,
      r.changed === 0 ? "info" : "good"
    );
    refetch();
  };

  const total = (accounts ?? []).reduce((s, a) => s + a.balance_cents, 0);
  return (
    <Card
      title="Accounts"
      collapsible
      defaultOpen={false}
      summary={`${accounts?.length ?? 0} accounts · ${money(total)} net`}
      action={
        <Button size="sm" variant="ghost" onClick={autoType} title="Guess types (savings, credit, loan…) from account names">
          <Icon name="sparkle" size={14} /> Auto-detect types
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {accounts?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink">
                {a.name}
                {a.simplefin_id && <span className="ml-2 text-[10px] uppercase tracking-wider text-accent">simplefin</span>}
              </div>
              <div className="text-xs text-ink3">{a.txn_count} transactions</div>
            </div>
            <Select
              value={a.type}
              onChange={(e) => update(a.id, { type: e.target.value })}
              className="!h-7 !text-xs"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
            <BalanceEditor account={a} onSave={(cents) => update(a.id, { balance_cents: cents })} />
            <button className="p-1 text-ink3 hover:text-bad" onClick={() => remove(a)} title="Delete account">
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New account name…" className="w-64" />
        <Button size="sm" variant="subtle" onClick={add} disabled={!name.trim()}>
          <Icon name="plus" size={14} /> Add
        </Button>
      </div>
    </Card>
  );
}

function BalanceEditor({ account, onSave }: { account: Account; onSave: (cents: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(account.balance_cents / 100));
  if (!editing) {
    return (
      <button
        className="tnum text-sm text-ink underline decoration-dotted underline-offset-2"
        onClick={() => {
          setValue(String(account.balance_cents / 100));
          setEditing(true);
        }}
        title="Edit balance"
      >
        {money(account.balance_cents)}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      $
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const cents = Math.round(Number(value) * 100);
          if (Number.isFinite(cents) && cents !== account.balance_cents) onSave(cents);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="!h-7 w-24 !px-2 !text-xs"
      />
    </span>
  );
}

function RulesCard() {
  const { data: rules, refetch } = useApi<Rule[]>("/api/rules");
  const { data: categories } = useApi<Category[]>("/api/categories");
  const [pattern, setPattern] = useState("");
  const [catId, setCatId] = useState("");
  const { toast } = useToast();

  const add = async () => {
    if (!pattern.trim() || !catId) return;
    const r = await api.post<{ applied: number }>("/api/rules", {
      pattern: pattern.trim(),
      category_id: Number(catId)
    });
    toast(`Rule added — applied to ${r.applied} existing transactions.`, "good");
    setPattern("");
    refetch();
  };

  const forceApply = async () => {
    if (
      !window.confirm(
        "Force-apply all rules? Matching transactions will be recategorized even if they already have a category — including ones you set by hand. Rules always win."
      )
    ) {
      return;
    }
    const r = await api.post<{ applied: number }>("/api/categorize/apply-rules", { force: true });
    toast(
      r.applied === 0 ? "No transactions needed changing." : `Force-applied rules to ${r.applied} transactions.`,
      "good"
    );
  };

  return (
    <Card
      title="Categorization rules"
      action={
        <Button size="sm" variant="ghost" onClick={forceApply} title="Re-run every rule over all transactions, overriding existing categories">
          <Icon name="refresh" size={14} /> Force re-apply all
        </Button>
      }
    >
      <p className="mb-3 text-xs text-ink3">
        Rules match a payee substring and always win over AI. The AI also learns automatically from every manual
        category change you make.
      </p>
      {rules && rules.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-sm first:pt-0">
              <code className="rounded bg-surface2 px-2 py-0.5 text-xs text-ink">{r.pattern}</code>
              <span className="text-ink3">→</span>
              <span className="text-ink">{r.category_icon} {r.category_name}</span>
              <button
                className="ml-auto p-1 text-ink3 hover:text-bad"
                onClick={async () => {
                  await api.del(`/api/rules/${r.id}`);
                  refetch();
                }}
                title="Delete rule"
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="payee contains…" className="w-52" />
        <Select value={catId} onChange={(e) => setCatId(e.target.value)}>
          <option value="">Choose category…</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </Select>
        <Button size="sm" variant="subtle" onClick={add} disabled={!pattern.trim() || !catId}>
          <Icon name="plus" size={14} /> Add rule
        </Button>
      </div>
    </Card>
  );
}

function TrashCard() {
  const { data: items, refetch } = useApi<TrashItem[]>("/api/trash");
  const { toast } = useToast();

  const restore = async (t: TrashItem) => {
    try {
      await api.post(`/api/trash/${t.id}/restore`);
      toast(`Restored ${t.payee || "transaction"}.`, "good");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <Card
      title="Trash"
      collapsible
      defaultOpen={false}
      summary={`${items?.length ?? 0} deleted transactions`}
    >
      <p className="mb-3 text-xs text-ink3">
        Deleted transactions land here and stay remembered, so bank syncs and CSV re-imports can't quietly bring
        them back. Restore anything you deleted by mistake.
      </p>
      {!items || items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink3">The trash is empty.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b border-line py-2 text-sm last:border-0">
              <span className="tnum w-14 shrink-0 text-xs text-ink2">{shortDate(t.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{t.payee || "(no payee)"}</span>
                <span className="text-[11px] text-ink3">
                  {t.account_name ?? "unknown account"} · {t.from_sync ? "bank sync" : "CSV import"} · deleted{" "}
                  {new Date(t.deleted_at + "Z").toLocaleDateString()}
                </span>
              </span>
              <span className="tnum shrink-0 font-medium text-ink">{money(t.amount_cents)}</span>
              <Button size="sm" variant="ghost" onClick={() => restore(t)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CategoriesCard() {
  const { data: categories, refetch } = useApi<Category[]>("/api/categories");
  const [name, setName] = useState("");
  const [grp, setGrp] = useState("lifestyle");
  const { toast } = useToast();

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post("/api/categories", { name: name.trim(), grp, kind: grp === "income" ? "income" : "expense" });
      setName("");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const remove = async (c: Category) => {
    if (c.txn_count > 0 && !window.confirm(`"${c.name}" is used by ${c.txn_count} transactions — they'll become uncategorized. Delete anyway?`)) {
      return;
    }
    await api.del(`/api/categories/${c.id}`);
    refetch();
  };

  const groups: Array<[string, string]> = [
    ["income", "Income"],
    ["essential", "Needs"],
    ["lifestyle", "Wants"],
    ["savings", "Savings"],
    ["other", "Other"]
  ];

  return (
    <Card
      title="Categories"
      collapsible
      defaultOpen={false}
      summary={`${categories?.length ?? 0} categories`}
    >
      <div className="space-y-3">
        {groups.map(([key, label]) => {
          const items = (categories ?? []).filter((c) => c.grp === key);
          if (items.length === 0) return null;
          return (
            <div key={key}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((c) => (
                  <span key={c.id} className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink">
                    {c.icon} {c.name}
                    <button className="hidden text-ink3 hover:text-bad group-hover:inline" onClick={() => remove(c)} title="Delete">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category…" className="w-52" />
        <Select value={grp} onChange={(e) => setGrp(e.target.value)}>
          <option value="essential">Needs</option>
          <option value="lifestyle">Wants</option>
          <option value="savings">Savings</option>
          <option value="income">Income</option>
          <option value="other">Other</option>
        </Select>
        <Button size="sm" variant="subtle" onClick={add} disabled={!name.trim()}>
          <Icon name="plus" size={14} /> Add
        </Button>
      </div>
    </Card>
  );
}
