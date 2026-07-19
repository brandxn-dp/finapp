import { useEffect, useState } from "react";
import { api, useApi } from "../lib/api";
import type { Account, Category, DeletedAccount, Rule, Settings as AppSettings, TrashItem } from "../lib/api";
import { money, shortDate } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { Theme } from "../lib/theme";
import { useAuth } from "../lib/auth";
import { Button, Card, Icon, Input, Modal, PageHeader, Select, Spinner, useToast } from "../components/ui";

const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "retirement", "loan", "cash", "other"];

const THEMES: Array<{ id: Theme; label: string; hint: string; swatch: string }> = [
  { id: "light", label: "Light Academia", hint: "Warm parchment & sepia ink", swatch: "linear-gradient(135deg,#f1eee4,#e6e1cd 60%,#55703c)" },
  { id: "dark", label: "Dark Academia", hint: "Candlelit forest study", swatch: "linear-gradient(135deg,#1d1f17,#272a1f 60%,#9db27a)" },
  { id: "aero", label: "Frutiger Aero", hint: "Glossy sky, water & glass", swatch: "linear-gradient(135deg,#5cb8f5,#c7efff 55%,#97dd8c)" }
];

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <Card title="Appearance">
      <p className="mb-3 text-xs text-ink2">Pick a look. Your choice is remembered on this device.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              theme === t.id ? "border-accent ring-2 ring-accent/40" : "border-line hover:bg-surface2"
            }`}
          >
            <div className="mb-2 h-16 w-full rounded-lg border border-line shadow-inner" style={{ background: t.swatch }} />
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
              {theme === t.id && <Icon name="check" size={14} className="text-accent" />}
              {t.label}
            </div>
            <div className="text-[11px] text-ink3">{t.hint}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function Settings() {
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <HouseholdCard />
      <AppearanceCard />
      <SimplefinCard />
      <CalcPrefsCard />
      <AiCard />
      <AccountsCard />
      <RulesCard />
      <CategoriesCard />
      <TrashCard />
      <DangerZoneCard />
      <p className="text-[11px] text-ink3">
        FinApp is self-hosted: your data lives in a single SQLite file on your server. Deleted transactions sit in
        the Trash above and are remembered so bank syncs can't re-import them. The AI features send only
        merchant names and aggregated statistics to the Anthropic API — never account numbers or balances per
        transaction. Insights are educational, not professional financial advice.
      </p>
    </div>
  );
}

interface Member {
  id: number;
  email: string;
  name: string;
  role: string;
}

function HouseholdCard() {
  const { me, switchHousehold, refresh, logout } = useAuth();
  const { toast } = useToast();
  const active = me?.households.find((h) => h.id === me.active_household_id);
  const [newName, setNewName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteLink, setInviteLink] = useState("");

  useEffect(() => {
    if (me?.active_household_id) {
      api
        .get<{ members: Member[] }>(`/api/households/${me.active_household_id}/members`)
        .then((r) => setMembers(r.members))
        .catch(() => setMembers([]));
    }
  }, [me?.active_household_id]);

  if (!me?.user) return null;

  const createHousehold = async () => {
    if (!newName.trim()) return;
    try {
      await api.post("/api/households", { name: newName.trim() });
      setNewName("");
      await refresh();
      window.location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const makeInvite = async () => {
    try {
      const r = await api.post<{ token: string }>(`/api/households/${me.active_household_id}/invites`, {});
      setInviteLink(`${window.location.origin}/invite/${r.token}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const leave = async () => {
    if (!window.confirm(`Leave "${active?.name}"? You'll lose access to its shared data unless re-invited.`)) return;
    try {
      await api.del(`/api/households/${me.active_household_id}/members/${me.user!.id}`);
      await refresh();
      window.location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const removeMember = async (uid: number) => {
    try {
      await api.del(`/api/households/${me.active_household_id}/members/${uid}`);
      const r = await api.get<{ members: Member[] }>(`/api/households/${me.active_household_id}/members`);
      setMembers(r.members);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <Card
      title="Household"
      collapsible
      defaultOpen={false}
      summary={`${active?.name ?? "—"} · ${members.length} member${members.length === 1 ? "" : "s"}`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface2/40 px-3 py-2">
          <span className="min-w-0 text-sm text-ink2">
            Signed in as <span className="font-medium text-ink">{me.user.name || me.user.email}</span>
            <span className="ml-1 text-xs text-ink3">({me.user.email})</span>
          </span>
          <Button size="sm" variant="ghost" onClick={logout}>
            <Icon name="x" size={14} /> Sign out
          </Button>
        </div>

        {me.households.length > 1 && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Active household</span>
            <Select
              value={me.active_household_id ?? ""}
              onChange={(e) => switchHousehold(Number(e.target.value))}
              className="w-full max-w-xs"
            >
              {me.households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </Select>
          </label>
        )}

        <div>
          <div className="mb-1 text-xs font-medium text-ink2">Members of {active?.name}</div>
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate text-ink">
                  {m.name || m.email}
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-ink3">{m.role}</span>
                  {m.id === me.user!.id && <span className="ml-1 text-xs text-ink3">(you)</span>}
                </span>
                {m.id !== me.user!.id && members.length > 1 && (
                  <button className="shrink-0 text-xs text-ink3 hover:text-bad" onClick={() => removeMember(m.id)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-ink2">Invite someone to share this household</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="subtle" onClick={makeInvite}>
              <Icon name="link" size={14} /> Create invite link
            </Button>
            {inviteLink && (
              <input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.target.select()}
                className="field-skeu h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-xs text-ink2"
              />
            )}
          </div>
          {inviteLink && (
            <p className="mt-1 text-[11px] text-ink3">
              Send this link to someone with an account. It's valid for 7 days and works once.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Start a new household</span>
            <div className="flex gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rental property" className="w-48" />
              <Button size="sm" variant="subtle" onClick={createHousehold} disabled={!newName.trim()}>
                <Icon name="plus" size={14} /> Create
              </Button>
            </div>
          </label>
          {me.households.length > 1 && (
            <Button size="sm" variant="danger" onClick={leave}>
              Leave this household
            </Button>
          )}
        </div>
      </div>
    </Card>
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState<Account | null>(null);
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

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = async (a: Account) => {
    if (!window.confirm(`Move "${a.name}" and its ${a.txn_count} transactions to the trash? You can restore it from Trash below.`)) return;
    try {
      await api.del(`/api/accounts/${a.id}`);
      toast(`Moved ${a.name} to the trash.`, "info");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const bulkDelete = async () => {
    const chosen = (accounts ?? []).filter((a) => selected.has(a.id));
    const txnTotal = chosen.reduce((s, a) => s + a.txn_count, 0);
    if (!window.confirm(`Move ${chosen.length} accounts (${txnTotal} transactions) to the trash? Restorable from Trash below.`)) return;
    try {
      const r = await api.post<{ deleted: number }>("/api/accounts/bulk-delete", { ids: [...selected] });
      toast(`Moved ${r.deleted} accounts to the trash.`, "good");
      setSelected(new Set());
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
        selected.size > 0 ? (
          <Button size="sm" variant="danger" onClick={bulkDelete}>
            <Icon name="trash" size={14} /> Delete {selected.size} selected
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={autoType} title="Guess types (savings, credit, loan…) from account names">
            <Icon name="sparkle" size={14} /> Auto-detect types
          </Button>
        )
      }
    >
      {accounts && accounts.length > 0 && (
        <label className="mb-1 flex items-center gap-2 pb-1 text-xs text-ink3">
          <input
            type="checkbox"
            checked={accounts.every((a) => selected.has(a.id))}
            onChange={(e) => setSelected(e.target.checked ? new Set(accounts.map((a) => a.id)) : new Set())}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Select all
        </label>
      )}
      <ul className="divide-y divide-line">
        {accounts?.map((a) => (
          <li key={a.id} className={`flex flex-wrap items-center gap-3 py-2.5 first:pt-0 ${selected.has(a.id) ? "bg-accent/8" : ""}`}>
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm text-ink">
                <NameEditor name={a.name} onSave={(name) => update(a.id, { name })} />
                {a.simplefin_id && <span className="text-[10px] uppercase tracking-wider text-accent">simplefin</span>}
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
            <button
              className="p-1 text-ink3 hover:text-accent disabled:opacity-30"
              onClick={() => setMerging(a)}
              disabled={(accounts?.length ?? 0) < 2}
              title="Merge this account's transactions into another"
            >
              <Icon name="link" size={14} />
            </button>
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
      {merging && (
        <MergeAccountModal
          source={merging}
          accounts={(accounts ?? []).filter((a) => a.id !== merging.id)}
          onClose={() => setMerging(null)}
          onDone={() => {
            setMerging(null);
            refetch();
          }}
        />
      )}
    </Card>
  );
}

/** Fold one account's transactions (and balance) into another. */
function MergeAccountModal({
  source,
  accounts,
  onClose,
  onDone
}: {
  source: Account;
  accounts: Account[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [into, setInto] = useState<string>(accounts[0] ? String(accounts[0].id) : "");
  const [busy, setBusy] = useState(false);

  const merge = async () => {
    if (!into) return;
    setBusy(true);
    try {
      const r = await api.post<{ moved: number }>(`/api/accounts/${source.id}/merge`, { into: Number(into) });
      const target = accounts.find((a) => String(a.id) === into);
      toast(`Merged ${source.name} into ${target?.name ?? "account"} — moved ${r.moved} transactions.`, "good");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Merge account" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink2">
          Move all <strong>{source.txn_count}</strong> transactions from <strong>{source.name}</strong> into another
          account and add its balance there. <strong>{source.name}</strong> then goes to the trash (restorable).
          Use this to consolidate transactions under the account name you actually want.
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Merge into</span>
          <Select value={into} onChange={(e) => setInto(e.target.value)} className="w-full">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.txn_count} txns)</option>
            ))}
          </Select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={merge} disabled={busy || !into}>
            {busy ? <Spinner /> : <Icon name="link" size={14} />} Merge
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CalcPrefsCard() {
  const { data: st, refetch } = useApi<AppSettings>("/api/settings");
  const { toast } = useToast();
  const toggle = async (include: boolean) => {
    try {
      await api.put("/api/settings", { include_credit: include });
      toast(include ? "Credit-card spending now counts." : "Now counting only checking, savings & cash.", "info");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };
  return (
    <Card title="Spending & income calculations">
      <p className="mb-3 text-xs text-ink2">
        By default, all spending and income figures across the app count only your <strong>checking, savings, and
        cash</strong> accounts. Credit-card, loan, investment, and retirement accounts are left out — a card purchase
        and the later payment from checking would otherwise double-count.
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={st?.include_credit ?? false}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Also include credit-card accounts in spending &amp; income
      </label>
      <p className="mt-1.5 text-[11px] text-ink3">
        Turn this on if you put most spending on cards and pay them in full — it counts the purchases directly.
        Loans, investments, and retirement never count either way.
      </p>
    </Card>
  );
}

function NameEditor({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <button
        className="truncate text-left text-sm text-ink underline decoration-dotted underline-offset-2 hover:text-accent"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        title="Rename account"
      >
        {name}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const trimmed = value.trim();
        if (trimmed && trimmed !== name) onSave(trimmed);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="!h-7 w-56 !px-2 !text-sm"
    />
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
  const { data: accounts, refetch: refetchAccounts } = useApi<DeletedAccount[]>("/api/trash/accounts");
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

  const restoreAccount = async (a: DeletedAccount) => {
    try {
      const r = await api.post<{ restored: number }>(`/api/trash/accounts/${a.id}/restore`);
      toast(`Restored ${a.name} with ${r.restored} transactions.`, "good");
      refetchAccounts();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const count = (items?.length ?? 0) + (accounts?.length ?? 0);
  return (
    <Card
      title="Trash"
      collapsible
      defaultOpen={false}
      summary={`${accounts?.length ?? 0} accounts · ${items?.length ?? 0} transactions`}
    >
      <p className="mb-3 text-xs text-ink3">
        Deleted accounts and transactions land here and stay remembered, so bank syncs and CSV re-imports can't
        quietly bring them back. Restore anything you removed by mistake — restoring an account brings its
        transactions with it.
      </p>

      {accounts && accounts.length > 0 && (
        <div className="mb-4">
          <div className="smallcaps mb-1.5 text-[11px] font-medium text-ink3">Deleted accounts</div>
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 border-b border-line py-2 text-sm last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{a.name}</span>
                <span className="text-[11px] text-ink3">
                  {a.type ?? "account"} · {a.txn_count} transactions · deleted{" "}
                  {new Date(a.deleted_at + "Z").toLocaleDateString()}
                </span>
              </span>
              <span className="tnum shrink-0 text-ink2">{money(a.balance_cents ?? 0)}</span>
              <Button size="sm" variant="ghost" onClick={() => restoreAccount(a)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}

      {count === 0 ? (
        <p className="py-4 text-center text-sm text-ink3">The trash is empty.</p>
      ) : items && items.length > 0 ? (
        <div>
          {accounts && accounts.length > 0 && (
            <div className="smallcaps mb-1.5 text-[11px] font-medium text-ink3">Deleted transactions</div>
          )}
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
        </div>
      ) : null}
    </Card>
  );
}

function DangerZoneCard() {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      await api.post("/api/factory-reset", { confirm: "DELETE EVERYTHING" });
      toast("All data erased. FinApp is back to a fresh install.", "info");
      setConfirm("");
      // Full reload so every page drops its cached data
      setTimeout(() => window.location.assign("/"), 800);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Danger zone" collapsible defaultOpen={false} summary="Factory reset">
      <div className="rounded-xl border border-bad/40 bg-bad/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-bad">
          <Icon name="alert" size={16} /> Factory reset
        </div>
        <p className="mt-1.5 text-xs text-ink2">
          Permanently deletes <strong>everything</strong> — all accounts, transactions, budgets, debts, rules, the
          trash, your API key, and the SimpleFIN connection — and restores the default categories. This cannot be
          undone. Consider backing up your <code className="rounded bg-surface2 px-1 py-0.5">/data</code> volume first.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink2">
            Type <code className="rounded bg-surface2 px-1.5 py-0.5 font-medium">DELETE EVERYTHING</code> to confirm:
          </span>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE EVERYTHING" className="w-48" />
          <Button variant="danger" onClick={reset} disabled={busy || confirm !== "DELETE EVERYTHING"}>
            {busy ? <Spinner /> : <Icon name="trash" size={14} />} Erase all data
          </Button>
        </div>
      </div>
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
