"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  setTheme: (_t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"; // SSR usa cookie no layout
  // 1) Se o HTML já veio com data-theme (SSR), respeita — evita qualquer flash/mismatch
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  // 2) Tenta cookie (caso algum ambiente sobrescreva o script inicial)
  const cookieMatch = document.cookie.match(/(?:^|; )alusa\.theme=(light|dark)(?:;|$)/);
  if (cookieMatch) return cookieMatch[1] as Theme;
  // 3) Tenta localStorage
  const saved = window.localStorage.getItem("alusa.theme") as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  // 4) Fallback para media query
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.setAttribute("data-theme", t);
    window.localStorage.setItem("alusa.theme", t);
    try {
      // Persiste também em cookie para SSR (evita flash ao recarregar)
      document.cookie = `alusa.theme=${t}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      // ignore cookie set errors
    }
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme, applyTheme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((p) => (p === "light" ? "dark" : "light")), []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, isDark: theme === "dark", setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
