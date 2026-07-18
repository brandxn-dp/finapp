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
    <div className="flex items-center gap-2.5 px-4 py-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
        F
      </div>
      <div>
        <div className="text-sm font-semibold leading-none text-ink">FinApp</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-widest text-ink3">self-hosted</div>
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

export default function Layout() {
  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
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
      <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface md:hidden">
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
