import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark" | "aero";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}>({
  theme: "light",
  setTheme: () => {},
  toggle: () => {}
});

function readTheme(): Theme {
  const el = document.documentElement;
  if (el.classList.contains("aero")) return "aero";
  if (el.classList.contains("dark")) return "dark";
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", theme === "dark");
    el.classList.toggle("aero", theme === "aero");
    localStorage.setItem("finapp-theme", theme);
  }, [theme]);

  // Quick toggle (used by the sidebar/header button) flips light↔dark; from
  // aero it returns to light. The full three-way choice lives in Settings.
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Validated chart palette (dataviz reference instance). Slots are assigned to
 * series in fixed order — never cycled, never re-ranked when filters change.
 */
export interface ChartColors {
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  grid: string;
  axis: string;
  muted: string;
  ink: string;
  ink2: string;
  surface: string;
  bar: string; // single-series magnitude bars/meters (moss accent)
  seq: string[]; // kept for API compat; all point at the accent family
}

// Earthy chart palette — forest-green + terracotta, validated colorblind-safe
// against both parchment surfaces (green/terracotta pass in both modes; the
// 50/30/20 gold third leans on legend + direct labels). Single-magnitude bars
// use the moss accent so they read as part of the theme, not a foreign chart.
const LIGHT: ChartColors = {
  s1: "#1baf7a", // green — income / growth / snowball
  s2: "#c25a2b", // terracotta — spending / outflow / avalanche
  s3: "#b08a1e", // ochre gold — third segment
  s4: "#3f6f93", // stone blue — occasional fourth
  s5: "#7a5a86", // muted plum
  s6: "#9c3f1a", // deep rust
  grid: "#ddd8c4",
  axis: "#c2bda4",
  muted: "#85826b",
  ink: "#26241a",
  ink2: "#52503f",
  surface: "#f8f6ee",
  bar: "#55703c",
  seq: ["#7c9a5a", "#6b8a48", "#5b7a3a", "#55703c", "#455d2e", "#374b24"]
};

const DARK: ChartColors = {
  s1: "#199e70",
  s2: "#d17544",
  s3: "#cba24a",
  s4: "#79a6c8",
  s5: "#b096bd",
  s6: "#d08a5f",
  grid: "#2f3226",
  axis: "#454936",
  muted: "#8b8a72",
  ink: "#e9e7d8",
  ink2: "#bdbba4",
  surface: "#1d1f17",
  bar: "#9db27a",
  seq: ["#7f9a5c", "#8ba767", "#9db27a", "#8ba767", "#7f9a5c", "#6f8a4c"]
};

// Frutiger Aero — bright blue/teal/green on glassy light surfaces. Uses the
// validated reference blue+green hues, which happen to be exactly this theme's
// language.
const AERO: ChartColors = {
  s1: "#1f7fd0", // blue — income / snowball
  s2: "#12a08a", // teal-green — spending / avalanche
  s3: "#e59500", // amber
  s4: "#3aa655",
  s5: "#7a5bd0",
  s6: "#e0483d",
  grid: "rgba(10,80,120,0.12)",
  axis: "rgba(10,80,120,0.28)",
  muted: "#3f7594",
  ink: "#0b3a54",
  ink2: "#2a5f7a",
  surface: "#f2fbff",
  bar: "#0a9bc4",
  seq: ["#8fd0ea", "#5cbbe0", "#2ba3d4", "#0a9bc4", "#0883ab", "#086a8a"]
};

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return theme === "dark" ? DARK : theme === "aero" ? AERO : LIGHT;
}
