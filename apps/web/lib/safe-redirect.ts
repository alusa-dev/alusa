// Garante que callbackUrl seja um path interno seguro e opcionalmente força fallback.
// Impede open redirect e normaliza barra inicial.
export function safeRedirect(input: string | null | undefined, fallback = '/dashboard'): string {
  if (!input) return fallback;
  try {
    const candidate = input.trim();

    // Rejeita URLs absolutas externas
    if (/^https?:\/\//i.test(candidate)) return fallback;
    // Deve começar com '/'
    if (!candidate.startsWith('/')) return fallback;
    // Evita //, /\\, tentativa de path traversal e chars que indicam payload contaminado/logs JSON
    if (
      candidate.includes('..') ||
      candidate.startsWith('//') ||
      candidate.startsWith('/\\') ||
      /["'`{},<>\s\\]/.test(candidate)
    ) {
      return fallback;
    }

    const parsed = new URL(candidate, 'http://localhost');
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;

    if (!normalized.startsWith('/')) return fallback;
    if (/\/\//.test(normalized)) return fallback;

    return normalized === '/' ? fallback : normalized;
  } catch {
    return fallback;
  }
}

export function nextParamToRedirect(param: string | null): string {
  return safeRedirect(param, '/dashboard');
}

function adminNeedsFinanceOnboarding(financeStatus?: string | null): boolean {
  if (!financeStatus) return true;

  return (
    financeStatus === 'FINANCE_NOT_STARTED' ||
    financeStatus === 'FINANCE_ONBOARDING_STARTED'
  );
}

export function resolvePostVerificationRedirect(
  param: string | null | undefined,
  role?: string | null,
  financeStatus?: string | null,
): string {
  const redirectTo = safeRedirect(param, '');
  const isAdmin = typeof role === 'string' && role.toUpperCase() === 'ADMIN';

  if (isAdmin && adminNeedsFinanceOnboarding(financeStatus)) {
    if (!redirectTo || redirectTo === '/dashboard') {
      return '/finance/wizard';
    }
  }

  if (redirectTo) {
    return redirectTo;
  }

  return isAdmin
    ? '/finance/wizard'
    : '/dashboard';
}
