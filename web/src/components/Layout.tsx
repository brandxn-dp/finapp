import { NavLink, Outlet } from "react-router-dom";
import { useTheme } from "../lib/theme";
import { Icon } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/transactions", label: "Transactions", icon: "list" },
  { to: "/budget", label: "Budget", icon: "target" },
  { to: "/debts", label: "Debt Planner", icon: "card" },
  { to: "/savings", label: "Savings", icon: "wallet" },
  { to: "/settings", label: "Settings", icon: "sliders" }
];

function Brand() {
  return (
    <div className="px-4 pb-4 pt-6 text-center">
      <div className="gilded font-display text-[24px] font-bold leading-none tracking-wide">FinApp</div>
      <div className="smallcaps mt-1 text-[10px] tracking-[0.28em] text-ink3">self·hosted ledger</div>
      <div className="mt-1.5 select-none text-[13px] leading-none text-ink3/80" aria-hidden="true">
        ❦
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink2 hover:bg-surface2 hover:text-ink"
      title="Toggle theme"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

/** Faint acanthus scrollwork watermark — pure ornament, sits under everything. */
function AcanthusCorner() {
  return (
    <svg
      viewBox="0 0 300 300"
      className="pointer-events-none fixed -bottom-10 -right-10 z-0 h-[340px] w-[340px] text-ink opacity-[0.05] dark:opacity-[0.06]"
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

export default function Layout() {
  return (
    <div className="relative flex h-full">
      <AcanthusCorner />
      {/* Desktop sidebar */}
      <aside className="z-10 hidden w-56 shrink-0 flex-col border-r border-line bg-[var(--glass)] backdrop-blur-md md:flex">
        <Brand />
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-accent/10 font-medium text-accent"
                    : "text-ink2 hover:bg-surface2 hover:text-ink"
                }`
              }
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-2">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main */}
      <main className="z-10 min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-[var(--glass)] backdrop-blur-lg md:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[9px] ${
                isActive ? "text-accent" : "text-ink3"
              }`
            }
          >
            <Icon name={item.icon} size={18} />
            {item.label.split(" ")[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
