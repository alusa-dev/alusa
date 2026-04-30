import { NextResponse } from 'next/server';

import {
  fulfillStoreSale,
  getStoreSaleById,
  StoreSaleError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../_helpers';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { contaId, operatorId } = await getStoreRequestContext();
    const { id } = await context.params;

    await fulfillStoreSale({
      contaId,
      saleId: id,
      operatorId,
    });

    const sale = await getStoreSaleById({ contaId, saleId: id });
    if (!sale) {
      return jsonError(404, 'VENDA_NAO_ENCONTRADA', 'Venda não encontrada.');
    }

    return NextResponse.json({ data: sale });
  } catch (error) {
    if (error instanceof StoreSaleError) {
      return jsonError(error.status, error.code, error.message);
    }

    const authError = error as { status?: number; code?: string; message?: string };
    if (authError.status && authError.code) {
      return jsonError(authError.status, authError.code, authError.message ?? 'Erro');
    }

    return jsonError(500, 'ERRO_CUMPRIR_VENDA', (error as Error).message);
  }
}
