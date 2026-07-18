import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {}
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("finapp-theme", theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
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

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return theme === "dark" ? DARK : LIGHT;
}
