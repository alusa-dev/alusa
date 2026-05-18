import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';

import { authOptions } from '@/lib/auth-options';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

type SessionUser = {
  id?: string;
  contaId?: string;
};

export type TenantSessionContext = {
  contaId: string;
  userId: string;
  tx: TenantTransactionClient;
};

type TenantSessionFailure = { ok: false; response: NextResponse };
type TenantSessionSuccess = { ok: true; contaId: string; userId: string };

async function resolveTenantSession(): Promise<TenantSessionSuccess | TenantSessionFailure> {
  const session = await getServerSession(authOptions);
  const user = (session as { user?: SessionUser } | null)?.user;
  const contaId = user?.contaId?.trim();
  const userId = user?.id?.trim();

  if (!contaId || !userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }),
    };
  }

  return { ok: true, contaId, userId };
}

export async function withTenantSession<T>(
  handler: (ctx: TenantSessionContext) => Promise<T>,
): Promise<T | NextResponse> {
  const auth = await resolveTenantSession();
  if (!auth.ok) return auth.response;

  return runWithTenant(auth.contaId, async (tx) =>
    handler({
      contaId: auth.contaId,
      userId: auth.userId,
      tx,
    }),
  );
}
