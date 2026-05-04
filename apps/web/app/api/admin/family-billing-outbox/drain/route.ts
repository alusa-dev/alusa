import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/session';
import { processFamilyBillingOutboxBatch } from '@/src/server/family-billing/processor';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Não autorizado.' } }, { status: 401 });
  }

  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return NextResponse.json({ error: { message: 'Permissão negada.' } }, { status: 403 });
  }

  try {
    const result = await processFamilyBillingOutboxBatch({ contaId: user.contaId, limit: 20 });
    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Falha ao drenar outbox familiar.',
      },
      { status: 500 },
    );
  }
}
