"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  /** O tema escuro está temporariamente desativado em toda a aplicação. */
  theme: Theme;
  /** Tema aplicado em `document`; permanece sempre claro até a futura refatoração. */
  resolvedTheme: Theme;
  isDark: boolean;
  setTheme: (_t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme: Theme = "light";
  const resolvedTheme: Theme = "light";

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    try {
      window.localStorage.removeItem("alusa.theme");
    } catch {
      // O tema claro não depende de acesso ao armazenamento local.
    }
    document.cookie = "alusa.theme=; Path=/; Max-Age=0; SameSite=Lax";
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      // Keep route-specific responsive theme colors (for example, the public
      // event-map checkout) instead of replacing them with the app theme.
      if (document.querySelector('meta[name="theme-color"][media]')) return;

      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", "#FFFFFF");
    } catch {
      /* noop */
    }
  }, [resolvedTheme]);

  const setTheme = useCallback((_t: Theme) => undefined, []);
  const toggleTheme = useCallback(() => undefined, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      isDark: theme === "dark",
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
