import { NextResponse } from 'next/server';

import { safeGetServerSession } from '@/lib/safe-server-session';

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function getStoreRequestContext() {
  const session = await safeGetServerSession();
  const user = session?.user as { contaId?: string | null; id?: string | null } | undefined;
  const contaId = user?.contaId?.trim() || null;
  const operatorId = user?.id?.trim() || null;

  if (!contaId || !operatorId) {
    throw Object.assign(new Error('Usuário não autenticado.'), {
      code: 'NAO_AUTENTICADO',
      status: 401,
    });
  }

  return { contaId, operatorId };
}
