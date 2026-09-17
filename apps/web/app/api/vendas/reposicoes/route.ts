import { NextResponse } from 'next/server';

import {
  createRestockOrder,
  listRestockOrders,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../_helpers';
import {
  createRestockOrderInputDTOSchema,
  listRestockOrdersQueryDTOSchema,
} from '@/features/vendas/dtos';

export async function GET(request: Request) {
  try {
    const { contaId } = await getStoreRequestContext();
    const url = new URL(request.url);
    const parsed = listRestockOrdersQueryDTOSchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Parâmetros inválidos.', parsed.error.flatten());
    }

    const data = await listRestockOrders({
      contaId,
      status: parsed.data.status,
      search: parsed.data.search,
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

    return jsonError(500, 'ERRO_LISTAR_REPOSICOES', 'Não foi possível carregar as reposições.');
  }
}

export async function POST(request: Request) {
  try {
    const { contaId, operatorId } = await getStoreRequestContext();
    const body = await request.json();
    const parsed = createRestockOrderInputDTOSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const data = await createRestockOrder({
      contaId,
      actorUserId: operatorId,
      requestId: parsed.data.requestId?.trim() || crypto.randomUUID(),
      supplierName: parsed.data.supplierName,
      expectedAt: parsed.data.expectedAt,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof StoreInventoryError) {
      return jsonError(error.status, error.code, error.message);
    }

    const authError = error as { status?: number; code?: string; message?: string };
    if (authError.status && authError.code) {
      return jsonError(authError.status, authError.code, authError.message ?? 'Erro');
    }

    return jsonError(500, 'ERRO_CRIAR_REPOSICAO', 'Não foi possível criar a reposição.');
  }
}
