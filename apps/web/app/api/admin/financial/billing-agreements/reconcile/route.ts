import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import {
  createPrismaBillingIntegrityRepository,
  reconcileBillingAgreementIntegrity,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const executeSchema = z.object({
  actionIds: z.array(z.string().min(1)).min(1).max(100),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions).catch(() => null);
  const user = (session as { user?: SessionUser } | null)?.user;
  if (!user?.id || !user.contaId) return { error: 'NAO_AUTENTICADO' as const, status: 401 };
  if (user.role?.toUpperCase() !== 'ADMIN') return { error: 'SEM_PERMISSAO' as const, status: 403 };
  return { user: { id: user.id, contaId: user.contaId } };
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Gera o plano tenant-scoped; nenhuma escrita é executada. */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return json(auth.status ?? 403, { error: auth.error });
    const repository = createPrismaBillingIntegrityRepository(prisma);
    const audit = await reconcileBillingAgreementIntegrity({
      contaId: auth.user.contaId,
      repository,
      dryRun: true,
    });
    return json(200, audit);
  } catch (error) {
    console.error('[BillingAgreement integrity][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

/** Aplica somente actionIds pertencentes ao plano recalculado no mesmo tenant. */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return json(auth.status ?? 403, { error: auth.error });
    const parsed = executeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json(400, { error: 'PAYLOAD_INVALIDO', issues: parsed.error.issues });
    const repository = createPrismaBillingIntegrityRepository(prisma);
    const result = await reconcileBillingAgreementIntegrity({
      contaId: auth.user.contaId,
      repository,
      dryRun: false,
      actionIds: parsed.data.actionIds,
    });
    return json(200, result);
  } catch (error) {
    console.error('[BillingAgreement integrity][POST]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
