import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  GLOBAL_ADMIN_SESSION_COOKIE,
  verifyGlobalAdminSessionToken,
} from '@/features/global-admin/auth/session';
import { isWhitelabelTreasuryPath } from '@/lib/finance/financial-capabilities';
type WizardSnapshot = { completedAt?: string | null; step?: number | null };
type WizardResponse = { data?: { wizard?: WizardSnapshot } };
type AccountAccessResponse = { ok?: boolean; reason?: string };

const isTest = process.env.TEST_ROUTES_ENABLED === 'true';

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

async function verifyAccountAccess(req: NextRequest): Promise<{ blocked: false } | { blocked: true; reason?: string }> {
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

/** Chamadas aqui influenciam TTFB das rotas cobertas. HTML autenticado tende a não ser cacheável por segurança de sessão — limitação de bfcache é esperada. */
export default async function middleware(req: NextRequest) {
  if (isTest) {
    // Em testes E2E, não forçar login
    return NextResponse.next();
  }

  const pathname = req.nextUrl.pathname;

  if (pathname === '/developer' || pathname.startsWith('/developer/')) {
    const developerLoginUrl = new URL('/developer/login', req.nextUrl.origin);
    const developerDashboardUrl = new URL('/developer/dashboard', req.nextUrl.origin);
    const token = req.cookies.get(GLOBAL_ADMIN_SESSION_COOKIE)?.value ?? null;
    const session = await verifyGlobalAdminSessionToken(token);
    const isDeveloperLogin = pathname === '/developer/login';

    if (!session && !isDeveloperLogin) {
      developerLoginUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(developerLoginUrl);
    }

    if (session && (pathname === '/developer' || isDeveloperLogin)) {
      return NextResponse.redirect(developerDashboardUrl);
    }

    if (!session && isDeveloperLogin) {
      return NextResponse.next();
    }

    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const url = req.nextUrl.clone();
    const signInUrl = new URL('/auth/login', url.origin);
    signInUrl.searchParams.set('expired', 'true');
    // Preservar a rota original (inclui querystring), para retornar após login.
    signInUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  const accessState = await verifyAccountAccess(req);
  if (accessState.blocked) {
    const signInUrl = new URL('/auth/login', req.nextUrl.origin);
    signInUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);

    if (accessState.reason === 'ACCOUNT_DEACTIVATED') {
      signInUrl.searchParams.set('account', 'deactivated');
    } else if (accessState.reason === 'USER_INACTIVE') {
      signInUrl.searchParams.set('account', 'inactive-user');
    } else {
      signInUrl.searchParams.set('expired', 'true');
    }

    const response = NextResponse.redirect(signInUrl);
    clearAuthSessionCookies(response);
    return response;
  }

  const isEmailVerified = (token as { emailVerified?: boolean } | null)?.emailVerified === true;

  if (!isEmailVerified) {
    const confirmEmailUrl = new URL('/auth/confirm-email', req.nextUrl.origin);
    confirmEmailUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(confirmEmailUrl);
  }

  // Rotas do onboarding financeiro: não redirecionar para evitar loop
  const financeIntegrationMode = (token as { financeIntegrationMode?: string } | null)?.financeIntegrationMode;
  const isExternalFinanceMode = financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT';
  const externalOnboardingPath = '/finance/external-onboarding';
  const isWizardPath = pathname === '/finance/wizard' || pathname.startsWith('/finance/wizard/');
  const isExternalOnboardingPath =
    pathname === externalOnboardingPath || pathname.startsWith(`${externalOnboardingPath}/`);
  const isOnboardingPath = isWizardPath || isExternalOnboardingPath;

  if (isOnboardingPath) {
    if (!isExternalFinanceMode && isExternalOnboardingPath) {
      return NextResponse.redirect(new URL('/finance/wizard', req.nextUrl.origin));
    }

    return NextResponse.next();
  }

  // Apenas verificar onboarding para ADMIN
  const userRole = (token as { role?: string } | null)?.role;
  const isAdmin = typeof userRole === 'string' && userRole.toUpperCase() === 'ADMIN';
  
  if (!isAdmin) {
    return NextResponse.next();
  }

  if (isExternalFinanceMode) {
    if (isWhitelabelTreasuryPath(pathname)) {
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
        return NextResponse.redirect(new URL('/finance/wizard', req.nextUrl.origin));
      }
    }
  } catch {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = { 
  matcher: [
    '/developer',
    '/developer/:path*',
    '/dashboard',
    '/admin/:path*',
    '/alunos/:path*',
    '/colaboradores/:path*',
    '/configuracoes/:path*',
    '/conta/:path*',
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
    '/finance/:path*'
  ] 
};
