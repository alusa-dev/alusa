"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { shouldForceLightThemePathname } from "@/lib/auth-light-theme-paths";

type Theme = "light" | "dark";

type ThemeContextValue = {
  /** Preferência do usuário (localStorage/cookie), independente da rota atual. */
  theme: Theme;
  /** Tema aplicado em `document` (modo escuro ignorado nas rotas de auth/onboarding financeiro). */
  resolvedTheme: Theme;
  isDark: boolean;
  setTheme: (_t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPersistedPreference(): Theme | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem("alusa.theme") as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  const cookieMatch = document.cookie.match(/(?:^|; )alusa\.theme=(light|dark)(?:;|$)/);
  if (cookieMatch) return cookieMatch[1] as Theme;
  return null;
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light"; // SSR usa cookie no layout
  const persisted = readPersistedPreference();
  if (persisted) return persisted;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const resolvedTheme = useMemo(() => {
    const p = pathname ?? "";
    if (shouldForceLightThemePathname(p)) return "light";
    return theme;
  }, [pathname, theme]);

  const persistUserThemePreference = useCallback((t: Theme) => {
    window.localStorage.setItem("alusa.theme", t);
    try {
      document.cookie = `alusa.theme=${t}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      /* ignore cookie set errors */
    }
  }, []);

  const syncRootToTheme = useCallback((t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  useEffect(() => {
    syncRootToTheme(resolvedTheme);
  }, [resolvedTheme, syncRootToTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      const content = resolvedTheme === "dark" ? "#0D1015" : "#FFFFFF";
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    } catch {
      /* noop */
    }
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (t: Theme) => {
      persistUserThemePreference(t);
      setThemeState(t);
    },
    [persistUserThemePreference],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((p) => {
      const next = p === "light" ? "dark" : "light";
      persistUserThemePreference(next);
      return next;
    });
  }, [persistUserThemePreference]);

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
