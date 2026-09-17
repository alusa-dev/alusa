import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { blockUnavailableFinanceCapability } from '@/lib/finance/finance-capability-gate';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import { deleteTransferRecipient, listTransferRecipients } from '@alusa/finance';
import { financeTransferRecipientDeleteInputDTOSchema } from '@/features/finance/dtos';
const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const capabilityBlock = blockUnavailableFinanceCapability(auth.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const result = await listTransferRecipients({ contaId: auth.contaId, limit: 8 });
    return json(200, { data: result });
  } catch (error) {
    console.error('[Finance transfer recipients][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const capabilityBlock = blockUnavailableFinanceCapability(auth.financeIntegrationMode, 'transfers');
    if (capabilityBlock) return capabilityBlock;

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const { recipientId } = financeTransferRecipientDeleteInputDTOSchema.parse(await request.json().catch(() => null));

    const result = await deleteTransferRecipient({ contaId: auth.contaId, recipientId });
    if (result.removedCount === 0) {
      return json(404, { error: 'DESTINATARIO_NAO_ENCONTRADO' });
    }

    return json(200, { data: result });
  } catch (error) {
    if (error instanceof ZodError) return json(400, { error: 'RECIPIENT_ID_OBRIGATORIO' });
    console.error('[Finance transfer recipients][DELETE]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
