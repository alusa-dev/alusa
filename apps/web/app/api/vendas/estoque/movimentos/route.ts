import { NextResponse } from 'next/server';
import { z } from 'zod';
import { InventoryMovementType } from '@prisma/client';

import {
  listInventoryMovements,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../_helpers';

const querySchema = z.object({
  productId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  movementType: z.nativeEnum(InventoryMovementType).optional(),
  search: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  actorUserId: z.string().trim().optional(),
  originType: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const { contaId } = await getStoreRequestContext();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

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

    return jsonError(500, 'ERRO_LISTAR_MOVIMENTOS', (error as Error).message);
  }
}
