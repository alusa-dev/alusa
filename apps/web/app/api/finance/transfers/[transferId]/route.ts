import { NextRequest, NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  getTransferDetail,
  mapTransferDetailOutputToDTO,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ transferId: string }> }) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const capabilityBlock = blockUnavailableFinanceCapability(auth.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const { transferId } = await context.params;
    if (!transferId?.trim()) {
      return json(400, { error: 'TRANSFER_ID_INVALIDO' });
    }

    const data = await getTransferDetail({
      contaId: auth.contaId,
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
