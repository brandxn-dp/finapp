import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import { api, useApi } from "../lib/api";
import type { Account, Category, CategorizeResult, DuplicateGroups, Txn, TxnPage } from "../lib/api";
import { money, monthName, shortDate } from "../lib/format";
import { Button, Card, Empty, Icon, Input, Modal, PageHeader, Select, Spinner, useToast } from "../components/ui";

const PAGE = 100;

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const uncategorized = params.get("uncategorized") === "1";

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  // Month/category can arrive via URL (e.g. clicking a category on the Dashboard)
  const [month, setMonth] = useState(() => params.get("month") ?? "");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState(() => params.get("category_id") ?? "");
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [importing, setImporting] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [view, setView] = useState<"all" | "dupes">("all");
  const [detail, setDetail] = useState<Txn | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: accounts, refetch: refetchAccounts } = useApi<Account[]>("/api/accounts");
  const { data: categories } = useApi<Category[]>("/api/categories");

  const query = new URLSearchParams();
  if (debouncedQ) query.set("q", debouncedQ);
  if (month) query.set("month", month);
  if (accountId) query.set("account_id", accountId);
  if (categoryId) query.set("category_id", categoryId);
  if (uncategorized) query.set("uncategorized", "1");
  if (source) query.set("source", source);
  query.set("limit", String(limit));
  const { data: page, loading, refetch } = useApi<TxnPage>(`/api/transactions?${query.toString()}`);

  // Selection only makes sense within the current result set
  useEffect(() => setSelected(new Set()), [debouncedQ, month, accountId, categoryId, source, uncategorized]);

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Move ${selected.size} transactions to the trash? You can restore them from Settings → Trash.`)) return;
    try {
      const r = await api.post<{ deleted: number }>("/api/transactions/bulk-delete", { ids: [...selected] });
      toast(`Moved ${r.deleted} transactions to the trash.`, "good");
      setSelected(new Set());
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const months = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 18; i++) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);

  const runAi = async (reassess = false) => {
    if (reassess && !window.confirm(
      "Re-assess everything with AI? Previous AI categorizations are discarded and every merchant is re-judged from scratch (your manual choices and rules are kept). This re-classifies all merchants, so it costs accordingly."
    )) {
      return;
    }
    setBusyAi(true);
    try {
      const r = await api.post<CategorizeResult>("/api/categorize/run", { reassess });
      const parts = [
        r.byRule && `${r.byRule} by rules`,
        r.byCache && `${r.byCache} from known merchants`,
        r.byAi && `${r.byAi} by Claude (${r.newMerchants} new merchants learned)`
      ].filter(Boolean);
      if (r.error) toast(`Categorization: ${r.error}`, "bad");
      else if (parts.length === 0) toast("Nothing new to categorize.", "info");
      else toast(`Categorized ${parts.join(", ")}. ${r.remaining} still uncategorized.`, "good");
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusyAi(false);
    }
  };

  const setCategory = async (txn: Txn, catId: string) => {
    try {
      await api.patch(`/api/transactions/${txn.id}`, {
        category_id: catId === "" ? null : Number(catId)
      });
      refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactions"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant={view === "dupes" ? "subtle" : "ghost"}
              size="sm"
              onClick={() => setView(view === "dupes" ? "all" : "dupes")}
            >
              <Icon name="list" size={14} />
              {view === "dupes" ? "All transactions" : "Find duplicates"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runAi(false)} disabled={busyAi}>
              {busyAi ? <Spinner /> : <Icon name="sparkle" size={14} />}
              Auto-categorize
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => runAi(true)}
              disabled={busyAi}
              title="Discard previous AI categorizations and re-judge every merchant from scratch"
            >
              <Icon name="refresh" size={14} />
              Re-assess all
            </Button>
            <Button size="sm" onClick={() => setImporting(true)}>
              <Icon name="upload" size={14} />
              Import CSV
            </Button>
          </div>
        }
      />

      {view === "dupes" ? (
        <DuplicatesView categories={categories ?? []} onChanged={refetch} />
      ) : (
        <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
          <Input placeholder="Search payee or memo…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 pl-8" />
        </div>
        <Select value={month} onChange={(e) => { setMonth(e.target.value); setLimit(PAGE); }}>
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>{monthName(m)}</option>
          ))}
        </Select>
        <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setLimit(PAGE); }}>
          <option value="">All accounts</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setLimit(PAGE); }}>
          <option value="">All categories</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => { setSource(e.target.value); setLimit(PAGE); }} title="Filter by how the transaction got here">
          <option value="">Any source</option>
          <option value="csv">CSV imports</option>
          <option value="sync">Bank sync</option>
          <option value="manual">Manual / restored</option>
        </Select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink2">
          <input
            type="checkbox"
            checked={uncategorized}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.checked) next.set("uncategorized", "1");
              else next.delete("uncategorized");
              setParams(next, { replace: true });
              setLimit(PAGE);
            }}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Uncategorized only
        </label>
        {selected.size > 0 && (
          <Button variant="danger" size="sm" onClick={bulkDelete} className="ml-auto">
            <Icon name="trash" size={14} /> Delete {selected.size} selected
          </Button>
        )}
      </div>

      <Card className="overflow-hidden !p-0" >
        <div className="-mx-5 -my-4 overflow-x-auto">
          {loading && !page ? (
            <div className="flex justify-center py-16 text-ink3"><Spinner /></div>
          ) : !page || page.rows.length === 0 ? (
            <Empty
              icon="list"
              title="No transactions found"
              sub="Import a CSV or connect SimpleFIN in Settings to pull transactions automatically."
            />
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink3">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      title="Select all loaded"
                      checked={page.rows.length > 0 && page.rows.every((t) => selected.has(t.id))}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(page.rows.map((t) => t.id)) : new Set())
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </th>
                  <th className="px-2 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Payee</th>
                  <th className="px-3 py-3 font-medium">Account</th>
                  <th className="px-3 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.rows.map((t) => (
                  <tr
                    key={t.id}
                    className={`cursor-pointer hover:bg-surface2/60 ${selected.has(t.id) ? "bg-accent/8" : ""}`}
                    onClick={() => setDetail(t)}
                    title="Click for details"
                  >
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className="tnum whitespace-nowrap px-2 py-2.5 text-ink2">{shortDate(t.date)}</td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      <div className="truncate text-ink">{t.payee || "(no payee)"}</div>
                      {t.memo && t.memo !== t.payee && (
                        <div className="truncate text-xs text-ink3">{t.memo}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink3">{t.account_name}</td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <Select
                          value={t.category_id ?? ""}
                          onChange={(e) => setCategory(t, e.target.value)}
                          className={`!h-7 max-w-[180px] !text-xs ${t.category_id ? "" : "!text-warn"}`}
                        >
                          <option value="">— uncategorized —</option>
                          {categories?.map((c) => (
                            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                          ))}
                        </Select>
                        {t.categorized_by === "ai" && (
                          <span title="Categorized by Claude" className="text-accent"><Icon name="sparkle" size={12} /></span>
                        )}
                      </div>
                    </td>
                    <td className={`tnum whitespace-nowrap px-5 py-2.5 text-right font-medium ${t.amount_cents > 0 ? "text-good" : "text-ink"}`}>
                      {t.amount_cents > 0 ? "+" : ""}{money(t.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {page && page.rows.length < page.total && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Load more ({page.rows.length} of {page.total})
          </Button>
        </div>
      )}
        </>
      )}

      {importing && (
        <ImportWizard
          accounts={accounts ?? []}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            refetch();
            refetchAccounts();
          }}
        />
      )}

      {detail && (
        <TxnDetailModal
          txn={detail}
          categories={categories ?? []}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ---------------- Transaction details / editor ----------------

function TxnDetailModal({
  txn,
  categories,
  onClose,
  onChanged
}: {
  txn: Txn;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [payee, setPayee] = useState(txn.payee);
  const [memo, setMemo] = useState(txn.memo);
  const [date, setDate] = useState(txn.date);
  const [amount, setAmount] = useState((txn.amount_cents / 100).toFixed(2));
  const [categoryId, setCategoryId] = useState<string>(txn.category_id ? String(txn.category_id) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents)) {
      toast("That amount doesn't parse.", "bad");
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/transactions/${txn.id}`, {
        payee,
        memo,
        date,
        amount_cents: cents,
        category_id: categoryId === "" ? null : Number(categoryId)
      });
      toast("Transaction updated.", "good");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this transaction? It won't come back on future syncs or re-imports.")) return;
    try {
      await api.del(`/api/transactions/${txn.id}`);
      toast("Transaction deleted — it won't reappear on future syncs.", "info");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <Modal title="Transaction details" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <label className="block w-36">
            <span className="mb-1 block text-xs font-medium text-ink2">Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full" />
          </label>
          <label className="block w-32">
            <span className="mb-1 block text-xs font-medium text-ink2">Amount ($, − = out)</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.\-]/g, ""))} inputMode="decimal" className="w-full" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Payee</span>
          <Input value={payee} onChange={(e) => setPayee(e.target.value)} className="w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Memo</span>
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} className="w-full" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink2">Category</span>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full">
            <option value="">— uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </Select>
        </label>
        <p className="text-[11px] text-ink3">
          {txn.account_name} · {txn.categorized_by ? `categorized by ${txn.categorized_by === "ai" ? "AI" : txn.categorized_by}` : "uncategorized"} ·
          changing the category also teaches the merchant memory.
        </p>
        <div className="flex justify-between border-t border-line pt-3">
          <Button variant="danger" onClick={remove}>
            <Icon name="trash" size={14} /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="check" size={14} />} Save
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Duplicate review ----------------

function DuplicatesView({
  categories,
  onChanged
}: {
  categories: Category[];
  onChanged: () => void;
}) {
  const { data, loading, refetch } = useApi<DuplicateGroups>("/api/transactions/duplicates");
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const groups = (data?.groups ?? []).filter((_, i) => !dismissed.has(i));

  const remove = async (id: number) => {
    try {
      await api.del(`/api/transactions/${id}`);
      toast("Transaction deleted.", "info");
      refetch();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const setCategory = async (id: number, catId: string) => {
    try {
      await api.patch(`/api/transactions/${id}`, { category_id: catId === "" ? null : Number(catId) });
      refetch();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  return (
    <Card title="Possible duplicates">
      <p className="mb-3 text-xs text-ink3">
        Same account, same amount, dates within three days, similar payee — usually a CSV import overlapping a
        bank sync. Nothing is deleted automatically: keep both, delete one, or fix a category, group by group.
      </p>
      {loading ? (
        <div className="flex justify-center py-10 text-ink3"><Spinner /></div>
      ) : groups.length === 0 ? (
        <Empty icon="check" title="No likely duplicates found" sub="Exact duplicates are already blocked at import time." />
      ) : (
        <div className="space-y-4">
          {groups.map((group, gi) => (
            <div key={group.map((t) => t.id).join("-")} className="rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line bg-surface2/60 px-3 py-1.5">
                <span className="text-xs font-medium text-ink2">
                  {group.length} matching · {money(group[0].amount_cents)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDismissed(new Set([...dismissed, gi]))}>
                  <Icon name="check" size={13} /> Keep all
                </Button>
              </div>
              <div className="divide-y divide-line">
                {group.map((t) => (
                  <div key={t.id} className="px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="tnum w-14 shrink-0 text-xs text-ink2">{shortDate(t.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{t.payee || "(no payee)"}</span>
                      <span className="tnum shrink-0 font-medium text-ink">{money(t.amount_cents)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink3">
                        {t.account_name} · {t.external_id ? "bank sync" : "CSV import"}
                      </span>
                      <Select
                        value={t.category_id ?? ""}
                        onChange={(e) => setCategory(t.id, e.target.value)}
                        className="!h-7 max-w-[150px] !text-xs"
                      >
                        <option value="">— uncategorized —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                        ))}
                      </Select>
                      <button
                        className="shrink-0 rounded p-1 text-ink3 hover:bg-bad/10 hover:text-bad"
                        onClick={() => remove(t.id)}
                        title="Delete this copy"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------- CSV import wizard ----------------

type RawRow = string[];

function ImportWizard({
  accounts,
  onClose,
  onDone
}: {
  accounts: Account[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [accountId, setAccountId] = useState<string>(accounts[0] ? String(accounts[0].id) : "new");
  const [newAccountName, setNewAccountName] = useState("");
  const [rows, setRows] = useState<RawRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [dateCol, setDateCol] = useState(0);
  const [amountCol, setAmountCol] = useState(1);
  const [payeeCol, setPayeeCol] = useState<number>(-1);
  const [memoCol, setMemoCol] = useState<number>(-1);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(false);

  const header = hasHeader && rows.length > 0 ? rows[0] : null;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columnCount = rows[0]?.length ?? 0;
  const colName = (i: number) => (header?.[i]?.trim() ? header[i] : `Column ${i + 1}`);

  const onFile = (file: File) => {
    setFileName(file.name);
    Papa.parse<RawRow>(file, {
      skipEmptyLines: "greedy",
      complete: (res) => {
        const parsed = (res.data as unknown as RawRow[]).filter((r) => r.length > 1);
        setRows(parsed);
        if (parsed.length > 0) {
          // Best-effort auto-mapping from header names
          const head = parsed[0].map((h) => (h ?? "").toLowerCase());
          const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
          const d = find("date");
          const a = find("amount");
          const p = find("payee", "description", "merchant", "name");
          const m = find("memo", "note");
          if (d >= 0) setDateCol(d);
          if (a >= 0) setAmountCol(a);
          setPayeeCol(p);
          setMemoCol(m);
          setHasHeader(d >= 0 || a >= 0 || p >= 0);
        }
      },
      error: () => toast("Couldn't parse that file — is it a CSV?", "bad")
    });
  };

  const preview = dataRows.slice(0, 5).map((r) => ({
    date: r[dateCol] ?? "",
    amount: r[amountCol] ?? "",
    payee: payeeCol >= 0 ? r[payeeCol] ?? "" : "",
    memo: memoCol >= 0 ? r[memoCol] ?? "" : ""
  }));

  const doImport = async () => {
    setBusy(true);
    try {
      let acctId: number;
      if (accountId === "new") {
        if (!newAccountName.trim()) {
          toast("Give the new account a name first.", "bad");
          setBusy(false);
          return;
        }
        const created = await api.post<Account>("/api/accounts", { name: newAccountName.trim() });
        acctId = created.id;
      } else {
        acctId = Number(accountId);
      }
      const payload = dataRows.map((r) => ({
        date: r[dateCol] ?? "",
        amount: r[amountCol] ?? "",
        payee: payeeCol >= 0 ? r[payeeCol] ?? "" : "",
        memo: memoCol >= 0 ? r[memoCol] ?? "" : ""
      }));
      const res = await api.post<{ imported: number; duplicates: number; invalid: number; autoCategorized: number }>(
        "/api/import",
        { account_id: acctId, invert_amounts: invert, rows: payload }
      );
      toast(
        `Imported ${res.imported} transactions (${res.duplicates} duplicates, ${res.invalid} invalid skipped, ${res.autoCategorized} auto-categorized). Run Auto-categorize to let Claude handle the rest.`,
        "good"
      );
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import CSV" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">Into account</span>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
              <option value="new">＋ New account…</option>
            </Select>
          </label>
          {accountId === "new" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink2">Account name</span>
              <Input value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="e.g. Chase Checking" />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink2">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="block text-sm text-ink2 file:mr-3 file:rounded-lg file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-fg hover:file:brightness-110"
            />
          </label>
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-surface2 p-3">
              {[
                { label: "Date", value: dateCol, set: setDateCol, optional: false },
                { label: "Amount", value: amountCol, set: setAmountCol, optional: false },
                { label: "Payee", value: payeeCol, set: setPayeeCol, optional: true },
                { label: "Memo", value: memoCol, set: setMemoCol, optional: true }
              ].map((f) => (
                <label key={f.label} className="block">
                  <span className="mb-1 block text-xs font-medium text-ink2">{f.label}</span>
                  <Select value={f.value} onChange={(e) => f.set(Number(e.target.value))}>
                    {f.optional && <option value={-1}>— none —</option>}
                    {Array.from({ length: columnCount }, (_, i) => (
                      <option key={i} value={i}>{colName(i)}</option>
                    ))}
                  </Select>
                </label>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1.5 pb-2 text-xs text-ink2">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                First row is a header
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 pb-2 text-xs text-ink2">
                <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                Flip signs (spending shown as positive)
              </label>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-ink2">
                Preview — {fileName} · {dataRows.length} rows
              </div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-ink3">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Payee</th>
                      <th className="px-3 py-2 font-medium">Memo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.map((r, i) => (
                      <tr key={i}>
                        <td className="tnum px-3 py-1.5 text-ink2">{r.date}</td>
                        <td className="tnum px-3 py-1.5 text-ink2">{r.amount}</td>
                        <td className="max-w-[220px] truncate px-3 py-1.5 text-ink">{r.payee}</td>
                        <td className="max-w-[160px] truncate px-3 py-1.5 text-ink3">{r.memo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={doImport} disabled={busy || dataRows.length === 0}>
                {busy ? <Spinner /> : <Icon name="upload" size={14} />}
                Import {dataRows.length} rows
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
