import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getAccountVerificationStatus } from '@alusa/finance/use-cases/kyc/get-account-verification-status';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);
const CACHE_TTL_MS = 30_000;
const verificationCache = new Map<string, { expiresAt: number; body: unknown }>();

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'private, max-age=30, stale-while-revalidate=60', ...headers },
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
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const url = new URL(req.url);
    const fresh = url.searchParams.get('fresh') === '1';
    const cacheKey = user.contaId;

    if (!fresh) {
      const cached = verificationCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return json(200, cached.body, { 'x-alusa-cache': 'HIT' });
      }
    }

    const result = await getAccountVerificationStatus(user.contaId, { fresh });

    if (!result.ready) {
      return json(202, { data: null, reason: 'NOT_READY' }, { 'Retry-After': '2' });
    }

    const body = { data: result.data };
    if (!fresh) {
      verificationCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        body,
      });
    }

    return json(200, body, { 'x-alusa-cache': 'MISS' });
  } catch (error) {
    console.error('[Account Verification Status][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
