import { NextResponse } from 'next/server';

import {
  ipFromRequest,
  rateLimitAsync,
  rateLimitSubject,
  strictRateLimitAsync,
  type RateLimitResult,
} from '@/lib/rate-limit';
import { rateLimitResponse } from '@/lib/security/rate-limit-response';

type TokenClaims = {
  id?: unknown;
  contaId?: unknown;
};

type RateLimitPolicy = {
  name: string;
  limit: number;
  tenantLimit?: number;
  ipLimit?: number;
  windowMs: number;
  failClosed: boolean;
  includeTenant: boolean;
  includeIp: boolean;
};

const READ_POLICY: RateLimitPolicy = {
  name: 'authenticated-read',
  limit: 600,
  tenantLimit: 3_000,
  windowMs: 60_000,
  failClosed: false,
  includeTenant: true,
  includeIp: false,
};

const MUTATION_POLICY: RateLimitPolicy = {
  name: 'mutation',
  limit: 120,
  tenantLimit: 600,
  ipLimit: 600,
  windowMs: 60_000,
  failClosed: false,
  includeTenant: true,
  includeIp: true,
};

const FINANCIAL_POLICY: RateLimitPolicy = {
  name: 'financial-mutation',
  limit: 20,
  tenantLimit: 120,
  ipLimit: 300,
  windowMs: 60_000,
  failClosed: true,
  includeTenant: true,
  includeIp: true,
};

const EXPENSIVE_POLICY: RateLimitPolicy = {
  name: 'expensive-operation',
  limit: 10,
  tenantLimit: 60,
  windowMs: 10 * 60_000,
  failClosed: true,
  includeTenant: true,
  includeIp: false,
};

const ADMIN_POLICY: RateLimitPolicy = {
  name: 'tenant-admin',
  limit: 60,
  tenantLimit: 300,
  ipLimit: 300,
  windowMs: 60_000,
  failClosed: true,
  includeTenant: true,
  includeIp: true,
};

const PUBLIC_WRITE_POLICY: RateLimitPolicy = {
  name: 'public-write',
  limit: 30,
  ipLimit: 30,
  windowMs: 10 * 60_000,
  failClosed: false,
  includeTenant: false,
  includeIp: true,
};

const PUBLIC_WRITE_PATHS = [
  '/api/public/early-access',
  '/api/users/register',
  '/api/users/first-register',
  '/api/users/accept',
];

const EXPENSIVE_SEGMENTS = [
  '/relatorios',
  '/relatorio',
  '/export',
  '/rebuild',
  '/reconcile',
  '/sync-asaas',
  '/sincronizar',
];

const FINANCIAL_SEGMENTS = [
  '/api/cobrancas',
  '/api/finance/',
  '/api/financeiro/',
  '/api/billing-agreements',
];

function isPathOrChild(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isExcludedFromGlobalPolicy(pathname: string): boolean {
  return [
    '/api/auth/',
    '/api/mobile/',
    '/api/webhooks/',
    '/api/jobs/',
    '/api/health',
    '/api/internal/health',
    '/api/internal/rls-health',
    '/api/observability/',
    '/api/public/contrato/',
    '/api/public/event-contrato/',
  ].some((prefix) => pathname.startsWith(prefix));
}

function resolvePolicy(pathname: string, method: string): RateLimitPolicy | null {
  const normalizedMethod = method.toUpperCase();
  if (isExcludedFromGlobalPolicy(pathname)) return null;

  if (PUBLIC_WRITE_PATHS.some((path) => isPathOrChild(pathname, path))) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod) ? PUBLIC_WRITE_POLICY : null;
  }

  const isUnsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod);
  if (pathname.startsWith('/api/admin/')) return ADMIN_POLICY;
  if (EXPENSIVE_SEGMENTS.some((segment) => pathname.includes(segment))) return EXPENSIVE_POLICY;
  if (!isUnsafe || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return READ_POLICY;
  }

  if (FINANCIAL_SEGMENTS.some((segment) => pathname.startsWith(segment) || pathname.includes(segment))) {
    return FINANCIAL_POLICY;
  }

  return MUTATION_POLICY;
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITER_UNAVAILABLE',
        message: 'Não foi possível validar a disponibilidade da API agora. Tente novamente.',
      },
    },
    { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } },
  );
}

function limitedResponse(result: RateLimitResult, policy: RateLimitPolicy): NextResponse {
  return rateLimitResponse(result, policy.limit);
}

async function check(
  key: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  return policy.failClosed
    ? strictRateLimitAsync(key, policy.limit, policy.windowMs)
    : rateLimitAsync(key, policy.limit, policy.windowMs);
}

/**
 * Applies the coarse API safety layer after proxy authentication. Route
 * handlers still own authorization, validation, idempotency and domain rules.
 */
export async function enforceApiRateLimit(
  request: Request,
  pathname: string,
  token?: TokenClaims | null,
): Promise<NextResponse | null> {
  const policy = resolvePolicy(pathname, request.method);
  if (!policy) return null;

  const userId = typeof token?.id === 'string' ? token.id.trim() : '';
  const contaId = typeof token?.contaId === 'string' ? token.contaId.trim() : '';
  const ip = ipFromRequest(request);

  if (policy.includeTenant && (!userId || !contaId)) {
    // The route protection layer remains the authority for authentication. Do
    // not create a shared/global bucket that could throttle unrelated tenants.
    return null;
  }

  const subjects: Array<{ kind: string; value: string }> = [];
  if (policy.includeTenant) {
    subjects.push({ kind: 'user', value: `${contaId}:${userId}` });
    subjects.push({ kind: 'tenant', value: contaId });
  }
  if (policy.includeIp) subjects.push({ kind: 'ip', value: ip });

  for (const subject of subjects) {
    const hashedSubject = await rateLimitSubject(subject.value);
    const subjectLimit = subject.kind === 'tenant'
      ? policy.tenantLimit ?? policy.limit
      : subject.kind === 'ip'
        ? policy.ipLimit ?? policy.limit
        : policy.limit;
    const subjectPolicy = { ...policy, limit: subjectLimit };
    const result = await check(`api:${policy.name}:${subject.kind}:${hashedSubject}`, subjectPolicy);

    if (result.source === 'unavailable') {
      console.error('[api-rate-limit][unavailable]', { profile: policy.name, subject: subject.kind });
      return unavailableResponse();
    }

    if (!result.ok) {
      console.warn('[api-rate-limit][blocked]', { profile: policy.name, subject: subject.kind });
      return limitedResponse(result, subjectPolicy);
    }
  }

  return null;
}

export const apiRateLimitPolicyNames = [
  READ_POLICY.name,
  MUTATION_POLICY.name,
  FINANCIAL_POLICY.name,
  EXPENSIVE_POLICY.name,
  ADMIN_POLICY.name,
  PUBLIC_WRITE_POLICY.name,
] as const;
