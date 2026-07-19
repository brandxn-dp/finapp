import { useApi, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { shortDate } from "../lib/format";
import { Button, Card, Icon, PageHeader, Spinner, useToast } from "../components/ui";

interface Overview {
  users: number;
  admins: number;
  households: number;
  memberships: number;
  accounts: number;
  transactions: number;
  budgets: number;
  debts: number;
  categories: number;
  active_sessions: number;
  pending_invites: number;
  unclaimed_accounts: number;
  db_bytes: number;
  uptime_seconds: number;
  registration_open: boolean;
}

interface AdminUser {
  id: number;
  email: string;
  name: string;
  is_admin: number;
  created_at: string;
  active_household_id: number | null;
  households: number;
  active_sessions: number;
}

interface AdminHousehold {
  id: number;
  name: string;
  created_at: string;
  members: number;
  accounts: number;
  transactions: number;
  member_list: Array<{ email: string; name: string; role: string }>;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function humanUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function Admin() {
  const { me } = useAuth();
  const { toast } = useToast();
  const { data: overview, refetch: refetchOverview } = useApi<Overview>("/api/admin/overview");
  const { data: usersData, refetch: refetchUsers } = useApi<{ users: AdminUser[] }>("/api/admin/users");
  const { data: hhData, refetch: refetchHh } = useApi<{ households: AdminHousehold[] }>("/api/admin/households");

  const refreshAll = () => {
    refetchOverview();
    refetchUsers();
    refetchHh();
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "good");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "bad");
    }
  };

  const toggleAdmin = (u: AdminUser) =>
    act(() => api.post(`/api/admin/users/${u.id}/admin`, { admin: u.is_admin !== 1 }), "Updated admin status.");

  const forceLogout = (u: AdminUser) =>
    act(() => api.post(`/api/admin/users/${u.id}/logout`), `Signed ${u.name || u.email} out everywhere.`);

  const deleteUser = (u: AdminUser) => {
    if (!window.confirm(`Delete ${u.name || u.email}? Households where they're the only member are deleted too. This can't be undone.`)) return;
    act(() => api.del(`/api/admin/users/${u.id}`), "User deleted.");
  };

  const deleteHousehold = (h: AdminHousehold) => {
    if (!window.confirm(`Delete household "${h.name}" and all ${h.transactions} transactions across ${h.accounts} accounts? This can't be undone.`)) return;
    act(() => api.del(`/api/admin/households/${h.id}`), "Household deleted.");
  };

  const stats: Array<{ label: string; value: string | number }> = overview
    ? [
        { label: "Users", value: overview.users },
        { label: "Admins", value: overview.admins },
        { label: "Households", value: overview.households },
        { label: "Accounts", value: overview.accounts },
        { label: "Transactions", value: overview.transactions },
        { label: "Active sessions", value: overview.active_sessions },
        { label: "Pending invites", value: overview.pending_invites },
        { label: "Database size", value: humanBytes(overview.db_bytes) },
        { label: "Server uptime", value: humanUptime(overview.uptime_seconds) }
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        sub="Instance-wide oversight — visible only to admins"
        action={
          <Button size="sm" variant="ghost" onClick={refreshAll}>
            <Icon name="refresh" size={14} /> Refresh
          </Button>
        }
      />

      <Card title="Instance overview">
        {!overview ? (
          <div className="flex justify-center py-8 text-ink3"><Spinner /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {stats.map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-surface2/40 px-3 py-2.5">
                  <div className="smallcaps text-[11px] text-ink3">{s.label}</div>
                  <div className="tnum font-display mt-0.5 text-[22px] font-semibold text-ink">{s.value}</div>
                </div>
              ))}
            </div>
            {overview.unclaimed_accounts > 0 && (
              <p className="mt-3 text-xs text-warn">
                {overview.unclaimed_accounts} account(s) are still unclaimed (from before logins existed).
              </p>
            )}
            <p className="mt-3 text-xs text-ink3">
              Open registration is <strong>{overview.registration_open ? "on" : "off"}</strong>. Set
              <code className="mx-1 rounded bg-surface2 px-1">REGISTRATION_INVITE_ONLY=1</code> to disable self-sign-up.
            </p>
          </>
        )}
      </Card>

      <Card title="Users">
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-ink3">
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2 text-center font-medium">Households</th>
                <th className="px-3 py-2 text-center font-medium">Sessions</th>
                <th className="px-3 py-2 text-center font-medium">Admin</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usersData?.users.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2.5">
                    <div className="text-ink">{u.name || "—"} {u.id === me?.user?.id && <span className="text-xs text-ink3">(you)</span>}</div>
                    <div className="text-xs text-ink3">{u.email}</div>
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2.5 text-xs text-ink2">{shortDate(u.created_at.slice(0, 10))}</td>
                  <td className="tnum px-3 py-2.5 text-center text-ink2">{u.households}</td>
                  <td className="tnum px-3 py-2.5 text-center text-ink2">{u.active_sessions}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleAdmin(u)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.is_admin ? "bg-accent/15 text-accent" : "text-ink3 hover:bg-surface2"}`}
                      title="Toggle admin"
                    >
                      {u.is_admin ? "Admin" : "—"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button className="rounded p-1 text-ink3 hover:text-ink" title="Sign out everywhere" onClick={() => forceLogout(u)}>
                        <Icon name="refresh" size={14} />
                      </button>
                      {u.id !== me?.user?.id && (
                        <button className="rounded p-1 text-ink3 hover:text-bad" title="Delete user" onClick={() => deleteUser(u)}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Households">
        <div className="space-y-2">
          {hhData?.households.map((h) => (
            <div key={h.id} className="rounded-lg border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{h.name}</span>
                  <span className="ml-2 text-xs text-ink3">
                    {h.members} member{h.members === 1 ? "" : "s"} · {h.accounts} accounts · {h.transactions} txns · created {shortDate(h.created_at.slice(0, 10))}
                  </span>
                </div>
                <button className="shrink-0 rounded p-1 text-ink3 hover:text-bad" title="Delete household" onClick={() => deleteHousehold(h)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {h.member_list.map((m) => (
                  <span key={m.email} className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-ink2" title={m.email}>
                    {m.name || m.email}
                    {m.role === "owner" && <span className="ml-1 text-accent">★</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-[11px] text-ink3">
        As admin you can see instance-wide counts and manage users and households, but you can't read another
        household's transactions from here — that stays private. To view a household's data, have an owner invite you.
      </p>
    </div>
  );
}
