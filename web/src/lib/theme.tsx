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
  seq: string[]; // sequential blue ramp, light -> dark
}

// Series hues are the validated reference set (re-validated 2026-07 against the
// parchment surfaces — light passes with the relief rule, dark passes clean).
// Chrome (grid/axis/ink/surface) follows the Light Academia theme.
const LIGHT: ChartColors = {
  s1: "#2a78d6",
  s2: "#1baf7a",
  s3: "#eda100",
  s4: "#008300",
  s5: "#4a3aa7",
  s6: "#e34948",
  grid: "#ddd8c4",
  axis: "#c2bda4",
  muted: "#85826b",
  ink: "#26241a",
  ink2: "#52503f",
  surface: "#f8f6ee",
  seq: ["#86b6ef", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"]
};

const DARK: ChartColors = {
  s1: "#3987e5",
  s2: "#199e70",
  s3: "#c98500",
  s4: "#008300",
  s5: "#9085e9",
  s6: "#e66767",
  grid: "#2f3226",
  axis: "#454936",
  muted: "#8b8a72",
  ink: "#e9e7d8",
  ink2: "#bdbba4",
  surface: "#1d1f17",
  seq: ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7"]
};

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return theme === "dark" ? DARK : LIGHT;
}
