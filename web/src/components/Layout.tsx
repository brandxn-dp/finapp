import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { Icon } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/transactions", label: "Transactions", icon: "list" },
  { to: "/budget", label: "Budget", icon: "target" },
  { to: "/debts", label: "Debt Planner", icon: "card" },
  { to: "/savings", label: "Savings", icon: "wallet" },
  { to: "/fire", label: "FIRE", icon: "flame" },
  { to: "/settings", label: "Settings", icon: "sliders" }
];
const ADMIN_NAV = { to: "/admin", label: "Admin", icon: "shield" };

function Brand({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="px-2 pb-4 pt-6 text-center">
        <div className="font-display text-[22px] font-bold leading-none text-accent">F</div>
      </div>
    );
  }
  return (
    <div className="px-4 pb-4 pt-6 text-center">
      <div className="font-display text-[24px] font-bold leading-none tracking-wide text-ink">
        Fin<span className="text-accent">App</span>
      </div>
      <div className="smallcaps mt-1 text-[10px] tracking-[0.28em] text-ink3">self·hosted ledger</div>
      <div className="brand-fleuron mt-1.5 select-none text-[13px] leading-none text-ink3/80" aria-hidden="true">
        ❦
      </div>
    </div>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink2 hover:bg-surface2 hover:text-ink ${collapsed ? "justify-center" : ""}`}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
    </button>
  );
}

/** Faint acanthus scrollwork watermark — pure ornament, sits under everything. */
function AcanthusCorner() {
  return (
    <svg
      viewBox="0 0 300 300"
      className="acanthus-deco pointer-events-none fixed -bottom-10 -right-10 z-0 h-[340px] w-[340px] text-ink opacity-[0.05] dark:opacity-[0.06]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* main volute */}
      <path d="M290 290 C 180 285, 95 240, 88 160 C 83 105, 120 70, 165 74 C 202 78, 224 108, 219 140 C 215 166, 192 182, 168 177 C 149 173, 138 156, 142 139 C 145 126, 157 118, 169 122 C 178 125, 182 134, 179 142" />
      {/* leaf fronds curling off the spiral */}
      <path d="M88 160 C 70 190, 45 205, 12 200 C 40 214, 70 212, 92 196" />
      <path d="M100 210 C 90 235, 70 252, 40 256 C 68 264, 96 254, 112 232" />
      <path d="M150 250 C 148 270, 136 285, 116 292 C 140 294, 160 284, 168 264" />
      <path d="M165 74 C 175 52, 196 40, 224 42 C 200 30, 176 34, 158 52" />
      {/* bud */}
      <path d="M219 140 C 236 132, 248 138, 252 152 C 258 136, 250 122, 234 118" />
    </svg>
  );
}

/**
 * Prompt the first user to claim pre-existing (pre-accounts) data into their
 * household. Shows on every app open while unclaimed data exists; claiming it
 * assigns everything to the current household and the prompt then disappears.
 */
function ClaimDataBanner() {
  const { me, refresh } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden || !me?.user || !me.is_first_user || me.unclaimed_count === 0) return null;

  const claim = async () => {
    setBusy(true);
    try {
      await api.post("/api/claim");
      await refresh();
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-accent/30 bg-accent-soft/60 px-4 py-3 text-sm">
      <Icon name="wallet" size={18} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-ink">Move your existing data into this household.</span>{" "}
        <span className="text-ink2">
          There's finance data from before you had an account. Claim it to bring your accounts, transactions, budgets
          and debts into your household.
        </span>
      </div>
      <button
        onClick={claim}
        disabled={busy}
        className="btn-emboss inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:brightness-108 disabled:opacity-50"
      >
        Move my data here
      </button>
      <button onClick={() => setHidden(true)} className="rounded-md p-1 text-ink3 hover:text-ink" title="Hide until next time">
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/** Household picker + signed-in user + logout, for the sidebar footer. */
function AccountBox({ collapsed }: { collapsed: boolean }) {
  const { me, switchHousehold, logout } = useAuth();
  if (!me?.user) return null;

  if (collapsed) {
    return (
      <button
        onClick={logout}
        className="flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm text-ink2 hover:bg-surface2 hover:text-ink"
        title={`${me.user.name || me.user.email} — sign out`}
      >
        <Icon name="x" size={16} />
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      {me.households.length > 1 && (
        <select
          value={me.active_household_id ?? ""}
          onChange={(e) => switchHousehold(Number(e.target.value))}
          className="field-skeu h-8 w-full rounded-lg border border-line bg-surface px-2 text-xs text-ink"
          title="Switch household"
        >
          {me.households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.members > 1 ? ` · ${h.members}` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="min-w-0 truncate text-xs text-ink3" title={me.user.email}>
          {me.user.name || me.user.email}
        </span>
        <button onClick={logout} className="shrink-0 text-xs text-ink3 hover:text-bad" title="Sign out">
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const { me } = useAuth();
  const navItems = me?.is_admin ? [...NAV, ADMIN_NAV] : NAV;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("finapp-nav-collapsed") === "1");
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      localStorage.setItem("finapp-nav-collapsed", v ? "0" : "1");
      return !v;
    });

  return (
    <div className="relative flex h-full">
      <AcanthusCorner />
      {/* Desktop sidebar */}
      <aside
        className={`app-sidebar z-10 hidden shrink-0 flex-col border-r border-line bg-[var(--glass)] backdrop-blur-md transition-[width] md:flex ${collapsed ? "w-16" : "w-56"}`}
      >
        <Brand collapsed={collapsed} />
        <nav className="flex-1 space-y-0.5 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                  isActive
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-ink2 hover:bg-surface2 hover:text-ink"
                }`
              }
            >
              <Icon name={item.icon} size={16} />
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-1.5 border-t border-line p-2">
          {!collapsed && <AccountBox collapsed={collapsed} />}
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={toggleCollapsed}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink2 hover:bg-surface2 hover:text-ink ${collapsed ? "justify-center" : ""}`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="text-lg leading-none">{collapsed ? "»" : "«"}</span>
            {!collapsed && "Collapse"}
          </button>
          {collapsed && <AccountBox collapsed={collapsed} />}
        </div>
      </aside>

      {/* Main */}
      <main className="z-10 min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <ClaimDataBanner />
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav — roomy touch targets, safe-area aware */}
      <nav
        className="app-bottomnav fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[var(--glass)] backdrop-blur-lg md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] ${
                isActive ? "font-medium text-accent" : "text-ink3"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                    isActive ? "bg-accent/12" : ""
                  }`}
                >
                  <Icon name={item.icon} size={22} />
                </span>
                {item.label.split(" ")[0]}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
