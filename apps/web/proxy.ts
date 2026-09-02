import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { isWhitelabelTreasuryPath } from '@/lib/finance/financial-capabilities';
import { isPublicApiPath } from '@/lib/middleware/public-api-paths';
import { hasCronSecret, resolveRouteProtection } from '@/lib/security/route-protection-registry';
import { isTestRouteEnabled } from '@/lib/security/runtime-guards';
import { clearAuthCookies } from '@/lib/auth-cookies';
import {
  getKnownApiMethods,
  isKnownApiMethodAllowed,
  methodNotAllowedResponse,
} from '@/lib/security/http-method-observability';

type WizardSnapshot = { completedAt?: string | null; step?: number | null };
type WizardResponse = { data?: { wizard?: WizardSnapshot } };
type AccountAccessResponse = { ok?: boolean; reason?: string };

const isTest = isTestRouteEnabled();
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const financeiroPageRoles = new Set(['ADMIN', 'FINANCEIRO']);
const originCheckExemptApiPrefixes = [
  '/api/auth/',
  '/api/webhooks/',
  '/api/jobs/',
];

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

    if (response.ok) {
      return { blocked: false };
    }

    const body = (await response.json().catch(() => null)) as AccountAccessResponse | null;
    return { blocked: true, reason: body?.reason };
  } catch {
    return { blocked: true, reason: 'ACCESS_CHECK_UNAVAILABLE' };
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
  '/comunicacao',
  '/modalidades/',
  '/planos/',
  '/professores/',
  '/matriculas/',
  '/rematriculas/',
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

function isFinanceiroPagePath(pathname: string): boolean {
  return pathname === '/financeiro' || pathname.startsWith('/financeiro/');
}

function canAccessFinanceiroPages(role: unknown): boolean {
  return typeof role === 'string' && financeiroPageRoles.has(role.toUpperCase());
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

function platformBillingCapabilityForMutation(pathname: string, method: string) {
  if (!unsafeMethods.has(method.toUpperCase())) return null;

  const excluded = [
    '/api/auth/',
    '/api/webhooks/',
    '/api/jobs/',
    '/api/admin/',
    '/api/platform-billing/',
    '/api/conta/forma-pagamento',
    '/api/finance/transfers',
    '/api/finance/balance',
    '/api/finance/account-status',
    '/api/finance/realtime/',
  ];
  if (excluded.some((prefix) => pathname.startsWith(prefix))) return null;

  if (pathname === '/api/alunos' || pathname.startsWith('/api/alunos/')) return 'STUDENT_WRITE' as const;
  if (pathname === '/api/responsaveis' || pathname.startsWith('/api/responsaveis/')) return 'RESPONSIBLE_WRITE' as const;
  if (pathname === '/api/colaboradores' || pathname.startsWith('/api/colaboradores/')) return 'STAFF_WRITE' as const;
  if (pathname === '/api/turmas' || pathname.startsWith('/api/turmas/')) return 'CLASS_WRITE' as const;
  if (pathname === '/api/modalidades' || pathname.startsWith('/api/modalidades/')) return 'MODALITY_WRITE' as const;
  if (pathname === '/api/salas' || pathname.startsWith('/api/salas/')) return 'ROOM_WRITE' as const;
  if (pathname === '/api/aulas' || pathname.startsWith('/api/aulas/')) return 'LESSON_WRITE' as const;
  if (pathname === '/api/events' || pathname.startsWith('/api/events/')) return 'EVENT_WRITE' as const;
  if (pathname === '/api/vendas' || pathname.startsWith('/api/vendas/')) return 'STORE_WRITE' as const;
  if (pathname === '/api/matriculas' || pathname.startsWith('/api/matriculas/')) return 'ENROLLMENT_WRITE' as const;
  if (pathname === '/api/rematriculas' || pathname.startsWith('/api/rematriculas/')) return 'ENROLLMENT_WRITE' as const;
  if (pathname === '/api/contratos' || pathname.startsWith('/api/contratos/')) return 'CONTRACT_WRITE' as const;
  if (pathname === '/api/event-contracts' || pathname.startsWith('/api/event-contracts/')) return 'CONTRACT_WRITE' as const;
  if (pathname === '/api/billing-agreements' || pathname.startsWith('/api/billing-agreements/')) return 'ENROLLMENT_WRITE' as const;
  if (pathname === '/api/combos' || pathname.startsWith('/api/combos/')) return 'ADMIN_WRITE' as const;
  if (pathname === '/api/planos' || pathname.startsWith('/api/planos/')) return 'ADMIN_WRITE' as const;
  if (pathname === '/api/professores' || pathname.startsWith('/api/professores/')) return 'STAFF_WRITE' as const;
  if (pathname === '/api/users' || pathname.startsWith('/api/users/')) return 'ADMIN_WRITE' as const;
  if (pathname === '/api/descontos' || pathname.startsWith('/api/descontos/')) return 'FINANCIAL_CONFIG_WRITE' as const;
  if (pathname === '/api/configuracoes' || pathname.startsWith('/api/configuracoes/')) return 'FINANCIAL_CONFIG_WRITE' as const;
  if (
    pathname.startsWith('/api/finance/charges') ||
    pathname.startsWith('/api/finance/installments') ||
    pathname.startsWith('/api/finance/subscriptions') ||
    pathname.startsWith('/api/finance/invoices')
  ) return 'CHARGE_CREATE' as const;
  if (
    pathname.startsWith('/api/financeiro/relatorios') ||
    pathname.startsWith('/api/financeiro/extrato') ||
    pathname === '/api/financeiro/pagamentos' ||
    pathname.startsWith('/api/financeiro/pagamentos/') ||
    pathname.startsWith('/api/financeiro/saldo') ||
    pathname.startsWith('/api/financeiro/kpis') ||
    pathname.startsWith('/api/financeiro/indicadores')
  ) return null;
  if (pathname.startsWith('/api/financeiro/')) return 'FINANCIAL_CONFIG_WRITE' as const;
  if (
    pathname.startsWith('/api/cobrancas/') &&
    (pathname.endsWith('/resend') ||
      pathname.endsWith('/asaas-notify') ||
      pathname.endsWith('/sync-asaas') ||
      pathname.endsWith('/arquivos') ||
      pathname.endsWith('/forma-pagamento'))
  ) return null;
  if (pathname === '/api/cobrancas' || pathname.startsWith('/api/cobrancas/')) return 'CHARGE_CREATE' as const;

  return null;
}

function isLocalPlatformBillingBypass(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (process.env.PLATFORM_BILLING_LOCAL_BYPASS !== 'true') return false;

  return new Set(['localhost', '127.0.0.1', '::1']).has(req.nextUrl.hostname);
}

async function handleApiRequest(req: NextRequest): Promise<NextResponse | null> {
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

  const allowedMethods = getKnownApiMethods(pathname);
  if (allowedMethods && !isKnownApiMethodAllowed(req.method, allowedMethods)) {
    return methodNotAllowedResponse(req, allowedMethods, 'route_method_not_declared');
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const capability = platformBillingCapabilityForMutation(pathname, req.method);
  if (capability) {
    if (isLocalPlatformBillingBypass(req)) {
      console.info('[middleware:billing]', {
        pathname,
        capability,
        mode: 'local_bypass',
      });
      return null;
    }

    try {
      const accessUrl = new URL('/api/platform-billing/access', req.nextUrl.origin);
      accessUrl.searchParams.set('capability', capability);
      const response = await fetch(accessUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({
          error: 'PLATFORM_BILLING_ACCESS_RESTRICTED',
          message: 'Regularize o plano e faturamento para continuar.',
        }));
        return NextResponse.json(body, {
          status: response.status,
          headers: { 'cache-control': 'no-store' },
        });
      }
    } catch {
      return NextResponse.json(
        {
          error: 'PLATFORM_BILLING_ACCESS_CHECK_UNAVAILABLE',
          message: 'Não foi possível validar o acesso da conta. Tente novamente.',
        },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
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
    clearAuthCookies(response, req.headers.get('cookie'));
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
  if (isFinanceiroPagePath(pathname) && !canAccessFinanceiroPages(userRole)) {
    logMiddlewareRedirect(pathname, 'financeiro_role_forbidden', 307);
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }

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
export default async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isTest) {
    if (!pathname.startsWith('/api/') && (pathname === '/rematriculas' || pathname.startsWith('/rematriculas/'))) {
      return handleProtectedPage(req);
    }

    return NextResponse.next();
  }

  const host = req.headers.get('host')?.split(':')[0]?.toLowerCase();
  if (host === 'www.alusa.app') {
    const apexUrl = new URL(req.nextUrl.pathname + req.nextUrl.search, 'https://alusa.app');
    logMiddlewareRedirect(req.nextUrl.pathname, 'www_to_apex', 308);
    return NextResponse.redirect(apexUrl, 308);
  }

  if (pathname.startsWith('/api/')) {
    const apiResponse = await handleApiRequest(req);
    if (apiResponse) {
      return apiResponse;
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
    '/dashboard',
    '/admin/:path*',
    '/alunos/:path*',
    '/colaboradores/:path*',
    '/configuracoes/:path*',
    '/conta/:path*',
    '/ajuda',
    '/ajuda/:path*',
    '/comunicacao',
    '/comunicacao/:path*',
    '/modalidades/:path*',
    '/planos/:path*',
    '/professores/:path*',
    '/matriculas/:path*',
    '/rematriculas/:path*',
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
