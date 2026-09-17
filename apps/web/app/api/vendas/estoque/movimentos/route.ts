import { NextResponse } from 'next/server';

import {
  listInventoryMovements,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../_helpers';
import { listInventoryMovementsQueryDTOSchema } from '@/features/vendas/dtos';

export async function GET(request: Request) {
  try {
    const { contaId } = await getStoreRequestContext();
    const url = new URL(request.url);
    const parsed = listInventoryMovementsQueryDTOSchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Parâmetros inválidos.', parsed.error.flatten());
    }

    const data = await listInventoryMovements({
      contaId,
      ...parsed.data,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof StoreInventoryError) {
      return jsonError(error.status, error.code, error.message);
    }

    const authError = error as { status?: number; code?: string; message?: string };
    if (authError.status && authError.code) {
      return jsonError(authError.status, authError.code, authError.message ?? 'Erro');
    }

    return jsonError(500, 'ERRO_LISTAR_MOVIMENTOS', 'Não foi possível carregar os movimentos.');
  }
}
