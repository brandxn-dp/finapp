import { useState } from "react";
import { api, useApi } from "../lib/api";
import type { Account, Category, Rule, Settings as AppSettings } from "../lib/api";
import { money } from "../lib/format";
import { Button, Card, Icon, Input, Select, Spinner, useToast } from "../components/ui";

const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "loan", "cash", "other"];

export default function Settings() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
      </header>
      <SimplefinCard />
      <AiCard />
      <AccountsCard />
      <RulesCard />
      <CategoriesCard />
      <p className="text-[11px] text-ink3">
        FinApp is self-hosted: your data lives in a single SQLite file on your server. The AI features send only
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

function AiCard() {
  const { data: st } = useApi<AppSettings>("/api/settings");
  return (
    <Card title="AI categorization & insights">
      {st?.ai_configured ? (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-3 py-1 text-xs font-medium text-good">
            <Icon name="check" size={12} /> Configured
          </span>
          <span className="text-xs text-ink3">model: {st.model}</span>
        </div>
      ) : (
        <p className="text-sm text-ink2">
          Set the <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">ANTHROPIC_API_KEY</code> environment
          variable on the container (get a key at{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-accent underline">
            console.anthropic.com
          </a>
          ) to enable AI categorization and check-ins. Each merchant is classified once and remembered, so a whole
          year of statements costs pennies. Optionally set{" "}
          <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">CLAUDE_MODEL</code> (default{" "}
          <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">claude-opus-4-8</code>;{" "}
          <code className="rounded bg-surface2 px-1.5 py-0.5 text-xs">claude-haiku-4-5</code> is the budget option).
        </p>
      )}
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

  return (
    <Card title="Accounts">
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

  return (
    <Card title="Categorization rules">
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
    <Card title="Categories">
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
