import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/lib/auth-options';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

type SessionUser = {
  id?: string;
  role?: string;
  contaId?: string;
  email?: string | null;
  name?: string | null;
  financeIntegrationMode?: string | null;
};

export type TenantSessionContext = {
  contaId: string;
  userId: string;
  tx: TenantTransactionClient;
};

export type TenantSessionResolution =
  | {
      ok: true;
      contaId: string;
      userId: string;
      role?: string;
      email?: string | null;
      name?: string | null;
      financeIntegrationMode?: string | null;
    }
  | { ok: false; reason: 'UNAUTHENTICATED' | 'CONTA_MISMATCH' };

/**
 * The authenticated session is the tenant authority for user-facing HTTP APIs.
 * A client-supplied contaId is accepted only as a backwards-compatible
 * consistency check; it never selects the tenant.
 */
export async function resolveTenantSession(
  requestedContaId?: string | null,
): Promise<TenantSessionResolution> {
  let session: { user?: SessionUser } | null = null;
  try {
    // Promise.resolve também mantém os testes e adapters legados seguros quando
    // um mock retorna a sessão de forma síncrona.
    const rawSession = await Promise.resolve(getServerSession(authOptions));
    session = rawSession as { user?: SessionUser } | null;
  } catch {
    session = null;
  }
  const user = (session as { user?: SessionUser } | null)?.user;
  const contaId = user?.contaId?.trim();
  const userId = user?.id?.trim();

  if (!contaId || !userId) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  const requested = requestedContaId?.trim();
  if (requested && requested !== contaId) {
    return { ok: false, reason: 'CONTA_MISMATCH' };
  }

  return {
    ok: true,
    contaId,
    userId,
    role: user?.role?.trim() || undefined,
    email: user?.email ?? null,
    name: user?.name ?? null,
    financeIntegrationMode: user?.financeIntegrationMode ?? null,
  };
}

export async function withTenantSession<T>(
  handler: (_ctx: TenantSessionContext) => Promise<T>,
): Promise<T | NextResponse> {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason === 'CONTA_MISMATCH' ? 'Conta inválida' : 'Não autenticado' },
      { status: auth.reason === 'CONTA_MISMATCH' ? 403 : 401 },
    );
  }

  return runWithTenant(auth.contaId, async (tx) =>
    handler({
      contaId: auth.contaId,
      userId: auth.userId,
      tx,
    }),
  );
}
