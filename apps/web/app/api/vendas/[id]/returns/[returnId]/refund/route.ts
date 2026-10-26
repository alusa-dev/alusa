import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getStoreSaleById, StoreSaleRefundError } from '@alusa/finance';
import { canRequestFinancialRefund } from '@/features/finance/shared/refund-permission';

import { getStoreWriteRequestContext, jsonError } from '../../../../_helpers';
import { requestStoreSaleRefundFromApp } from '@/src/server/sales/store-sale-refund.service';

const inputSchema = z.object({ mode: z.enum(['REQUEST', 'RETRY_DENIED']).default('REQUEST') });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; returnId: string }> },
) {
  try {
    const { contaId, operatorId, role } = await getStoreWriteRequestContext();
    if (!role || !canRequestFinancialRefund(role)) {
      return jsonError(403, 'ACESSO_NEGADO', 'Somente ADMIN ou FINANCEIRO pode solicitar estornos.');
    }

    const body = await request.json().catch(() => ({}));
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return jsonError(422, 'ERRO_VALIDACAO', 'Modo de estorno inválido.', parsed.error.flatten());

    const { id, returnId } = await context.params;
    await requestStoreSaleRefundFromApp({
      contaId,
      saleId: id,
      returnId,
      actorId: operatorId,
      role,
      mode: parsed.data.mode,
    });

    const sale = await getStoreSaleById({ contaId, saleId: id });
    if (!sale) return jsonError(404, 'VENDA_NAO_ENCONTRADA', 'Venda não encontrada.');
    return NextResponse.json({ data: sale });
  } catch (error) {
    if (error instanceof StoreSaleRefundError) return jsonError(error.status, error.code, error.message);
    const authError = error as { status?: number; code?: string; message?: string };
    if (authError.status && authError.code) return jsonError(authError.status, authError.code, authError.message ?? 'Erro');
    return jsonError(500, 'ERRO_SOLICITAR_ESTORNO', 'Não foi possível solicitar o estorno.');
  }
}
