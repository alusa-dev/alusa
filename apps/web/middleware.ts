import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { isWhitelabelTreasuryPath } from '@/lib/finance/financial-capabilities';
import { isPublicApiPath } from '@/lib/middleware/public-api-paths';
import { hasCronSecret, resolveRouteProtection } from '@/lib/security/route-protection-registry';
import { isTestRouteEnabled } from '@/lib/security/runtime-guards';

type WizardSnapshot = { completedAt?: string | null; step?: number | null };
type WizardResponse = { data?: { wizard?: WizardSnapshot } };
type AccountAccessResponse = { ok?: boolean; reason?: string };

const isTest = isTestRouteEnabled();
const legacyDeveloperPaths = [
  '/developer/dashboard',
  '/developer/search',
  '/developer/requests',
  '/developer/users',
  '/developer/tenants',
  '/developer/problems',
  '/developer/actions',
  '/developer/errors',
];
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const originCheckExemptApiPrefixes = [
  '/api/auth/',
  '/api/developer/auth/',
  '/api/global-admin/auth/',
  '/api/webhooks/',
  '/api/jobs/',
];

function clearAuthSessionCookies(response: NextResponse) {
  const cookieNames = [
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
    'next-auth.callback-url',
    '__Secure-next-auth.callback-url',
    'next-auth.csrf-token',
    '__Host-next-auth.csrf-token',
  ];

  for (const name of cookieNames) {
    response.cookies.set(name, '', { maxAge: 0, path: '/' });
  }
}

async function verifyAccountAccess(
  req: NextRequest,
): Promise<{ blocked: false } | { blocked: true; reason?: string }> {
  try {
    const accessUrl = new URL('/api/auth/account-access', req.nextUrl.origin);
    const response = await fetch(accessUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        cookie: req.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    });

    if (response.ok || response.status >= 500) {
      return { blocked: false };
    }

    const body = (await response.json().catch(() => null)) as AccountAccessResponse | null;
    return { blocked: true, reason: body?.reason };
  } catch {
    return { blocked: false };
  }
}

function isSameOriginUrl(value: string | null, origin: string): boolean {
  if (!value) return true;

  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function shouldValidateApiOrigin(pathname: string, method: string): boolean {
  if (!pathname.startsWith('/api/') || !unsafeMethods.has(method.toUpperCase())) {
    return false;
  }

  return !originCheckExemptApiPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function logMiddlewareRedirect(pathname: string, reason: string, status: number) {
  if (process.env.NODE_ENV === 'production' && process.env.PERF_LOGS !== 'true') {
    return;
  }

  console.info('[middleware:redirect]', { pathname, reason, status });
}

const protectedPagePrefixes = [
  '/dashboard',
  '/admin/',
  '/alunos/',
  '/colaboradores/',
  '/configuracoes/',
  '/conta/',
  '/ajuda',
  '/modalidades/',
  '/planos/',
  '/professores/',
  '/matriculas/',
  '/antecipacoes/',
  '/portal/',
  '/vendas/',
  '/finance/',
  '/financeiro/',
] as const;

function isProtectedPagePath(pathname: string): boolean {
  return protectedPagePrefixes.some((prefix) => {
    if (prefix.endsWith('/')) {
      return pathname.startsWith(prefix);
    }

    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function redirectToSignIn(req: NextRequest, params: Record<string, string>) {
  const signInUrl = new URL('/auth/login', req.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);

  for (const [key, value] of Object.entries(params)) {
    signInUrl.searchParams.set(key, value);
  }

  logMiddlewareRedirect(req.nextUrl.pathname, 'unauthenticated_page', 307);
  return NextResponse.redirect(signInUrl);
}

function handleApiRequest(req: NextRequest): NextResponse | null {
  const pathname = req.nextUrl.pathname;

  if (shouldValidateApiOrigin(pathname, req.method)) {
    const origin = req.headers.get('origin');
    const referer = req.headers.get('referer');
    if (!isSameOriginUrl(origin, req.nextUrl.origin) || !isSameOriginUrl(referer, req.nextUrl.origin)) {
      return NextResponse.json(
        { error: 'Origem da requisição não permitida.' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  const protection = resolveRouteProtection(pathname);
  if (protection === 'CRON_SECRET' && !hasCronSecret(req)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  return null;
}

async function handleProtectedPage(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return redirectToSignIn(req, { expired: 'true' });
  }

  const accessState = await verifyAccountAccess(req);
  if (accessState.blocked) {
    const params: Record<string, string> = {};
    if (accessState.reason === 'ACCOUNT_DEACTIVATED') {
      params.account = 'deactivated';
    } else if (accessState.reason === 'USER_INACTIVE') {
      params.account = 'inactive-user';
    } else {
      params.expired = 'true';
    }

    const response = redirectToSignIn(req, params);
    clearAuthSessionCookies(response);
    return response;
  }

  const isEmailVerified = (token as { emailVerified?: boolean } | null)?.emailVerified === true;

  if (!isEmailVerified) {
    const confirmEmailUrl = new URL('/auth/confirm-email', req.nextUrl.origin);
    confirmEmailUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    logMiddlewareRedirect(pathname, 'email_unverified', 307);
    return NextResponse.redirect(confirmEmailUrl);
  }

  const financeIntegrationMode = (token as { financeIntegrationMode?: string } | null)
    ?.financeIntegrationMode;
  const isExternalFinanceMode = financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';
  const externalOnboardingPath = '/finance/external-onboarding';
  const isWizardPath = pathname === '/finance/wizard' || pathname.startsWith('/finance/wizard/');
  const isExternalOnboardingPath =
    pathname === externalOnboardingPath || pathname.startsWith(`${externalOnboardingPath}/`);
  const isOnboardingPath = isWizardPath || isExternalOnboardingPath;

  if (isOnboardingPath) {
    if (!isExternalFinanceMode && isExternalOnboardingPath) {
      logMiddlewareRedirect(pathname, 'external_onboarding_mismatch', 307);
      return NextResponse.redirect(new URL('/finance/wizard', req.nextUrl.origin));
    }

    return NextResponse.next();
  }

  const userRole = (token as { role?: string } | null)?.role;
  const isAdmin = typeof userRole === 'string' && userRole.toUpperCase() === 'ADMIN';

  if (!isAdmin) {
    return NextResponse.next();
  }

  if (isExternalFinanceMode) {
    if (isWhitelabelTreasuryPath(pathname)) {
      logMiddlewareRedirect(pathname, 'external_finance_treasury_block', 307);
      return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
    }

    return NextResponse.next();
  }

  try {
    const wizardUrl = new URL('/api/kyc/wizard', req.nextUrl.origin);
    const response = await fetch(wizardUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        cookie: req.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
    });

    if (response.ok) {
      const json = (await response.json().catch(() => null)) as WizardResponse | null;
      const wizard = json?.data?.wizard ?? null;
      const step = typeof wizard?.step === 'number' ? wizard.step : null;
      const isCompleted = Boolean(wizard?.completedAt) || step === 6;
      if (!isCompleted) {
        logMiddlewareRedirect(pathname, 'finance_wizard_incomplete', 307);
        return NextResponse.redirect(new URL('/finance/wizard', req.nextUrl.origin));
      }
    }
  } catch {
    return NextResponse.next();
  }

  return NextResponse.next();
}

/** Chamadas aqui influenciam TTFB das rotas cobertas. HTML autenticado tende a não ser cacheável por segurança de sessão — limitação de bfcache é esperada. */
export default async function middleware(req: NextRequest) {
  if (isTest) {
    return NextResponse.next();
  }

  const host = req.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host === 'www.alusa.app') {
    const apexUrl = new URL(req.nextUrl.pathname + req.nextUrl.search, 'https://alusa.app');
    logMiddlewareRedirect(req.nextUrl.pathname, 'www_to_apex', 308);
    return NextResponse.redirect(apexUrl, 308);
  }

  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith('/api/')) {
    const apiResponse = handleApiRequest(req);
    if (apiResponse) {
      return apiResponse;
    }

    return NextResponse.next();
  }

  if (pathname === '/developer' || pathname.startsWith('/developer/')) {
    if (pathname === '/developer/login') {
      return NextResponse.next();
    }

    if (
      legacyDeveloperPaths.some(
        (legacyPath) => pathname === legacyPath || pathname.startsWith(`${legacyPath}/`),
      )
    ) {
      return NextResponse.redirect(new URL('/developer', req.nextUrl.origin));
    }

    return NextResponse.next();
  }

  if (!isProtectedPagePath(pathname)) {
    return NextResponse.next();
  }

  return handleProtectedPage(req);
}

export const config = {
  matcher: [
    '/',
    '/developer',
    '/developer/:path*',
    '/dashboard',
    '/admin/:path*',
    '/alunos/:path*',
    '/colaboradores/:path*',
    '/configuracoes/:path*',
    '/conta/:path*',
    '/ajuda',
    '/ajuda/:path*',
    '/modalidades/:path*',
    '/planos/:path*',
    '/professores/:path*',
    '/matriculas/:path*',
    '/antecipacoes/:path*',
    '/dashboard/:path*',
    '/portal/:path*',
    '/vendas/:path*',
    '/finance/wizard/:path*',
    '/financeiro/:path*',
    '/finance/:path*',
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
