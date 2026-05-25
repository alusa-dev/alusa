/**
 * Rotas em que o tema escuro da conta não deve refletir (auth e onboarding financeiro).
 * Usado pelo ThemeProvider e pelo script `theme-init` no layout raiz.
 */
export const AUTH_LIGHT_THEME_PATH_PREFIXES = [
  '/auth',
  '/finance/external-onboarding',
  '/finance/wizard',
] as const;

/** Rotas no grupo (auth) que não passam por `/auth/...`. */
export const AUTH_LIGHT_THEME_ROOT_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/confirm-email',
  '/verify-email',
  '/complete-profile',
  '/accept',
  '/loading',
] as const;

export function shouldForceLightThemePathname(pathname: string): boolean {
  const p = pathname || '';
  for (const prefix of AUTH_LIGHT_THEME_PATH_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return true;
  }
  for (const root of AUTH_LIGHT_THEME_ROOT_PATHS) {
    if (p === root || p.startsWith(`${root}/`)) return true;
  }
  return false;
}
