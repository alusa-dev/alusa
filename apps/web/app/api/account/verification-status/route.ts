import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getAccountVerificationStatus } from '@alusa/finance/use-cases/kyc/get-account-verification-status';
import { createPerfTimer, withPerfTimer } from '@/lib/perf-logger';
import { PrivateMemoryCache, privateCacheControl } from '@/lib/private-cache';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);
const verificationCache = new PrivateMemoryCache<unknown>({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});
const verificationCacheControl = privateCacheControl({
  maxAgeSeconds: 30,
  staleWhileRevalidateSeconds: 120,
});

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': verificationCacheControl, ...headers },
  });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * GET /api/account/verification-status
 *
 * Endpoint unificado de verificação de conta.
 * Retorna estado de produto (5 estados) + ações de verificação já resolvidas no backend.
 *
 * Query params:
 *   - fresh=1 — ignora cache e busca direto no provedor
 */
export async function GET(req: Request) {
  const timer = createPerfTimer('api/account/verification-status');
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });
    const contaId = user.contaId;

    const url = new URL(req.url);
    const fresh = url.searchParams.get('fresh') === '1';
    const cacheKey = contaId;

    if (!fresh) {
      const cached = verificationCache.get(cacheKey);
      if (cached.body && (cached.state === 'HIT' || cached.state === 'STALE')) {
        timer.end('GET /verification-status (cache hit)', { fresh, cacheState: cached.state });
        return json(200, cached.body, { 'x-alusa-cache': cached.state });
      }
    }

    const result = await withPerfTimer(
      'finance.getAccountVerificationStatus',
      'call use-case',
      () => getAccountVerificationStatus(contaId, { fresh })
    );

    if (!result.ready) {
      timer.end('GET /verification-status (not ready)', { fresh });
      return json(
        202,
        {
          data: null,
          reason: 'NOT_READY',
          subaccountProvisioning: result.subaccountProvisioning,
        },
        { 'Retry-After': '2' },
      );
    }

    const body = { data: result.data };
    if (!fresh) {
      verificationCache.set(cacheKey, body);
    }

    timer.end('GET /verification-status (cache miss)', { fresh });
    return json(200, body, { 'x-alusa-cache': 'MISS' });
  } catch (error) {
    console.error('[Account Verification Status][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
