import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  getTransferDetail,
  mapTransferDetailOutputToDTO,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string; financeIntegrationMode?: string | null };

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function GET(_req: NextRequest, context: { params: Promise<{ transferId: string }> }) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(user.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const { transferId } = await context.params;
    if (!transferId?.trim()) {
      return json(400, { error: 'TRANSFER_ID_INVALIDO' });
    }

    const data = await getTransferDetail({
      contaId: user.contaId,
      transferId,
    });

    return json(200, { data: mapTransferDetailOutputToDTO(data) });
  } catch (error) {
    if (error instanceof Error && error.message === 'TRANSFER_NAO_ENCONTRADA') {
      return json(404, { error: 'TRANSFER_NAO_ENCONTRADA' });
    }

    console.error('[Finance Transfer Detail][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;