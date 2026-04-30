import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  receiveRestockOrder,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../../_helpers';

const requestSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quantityReceived: z.number().int().positive(),
        unitCost: z.number().min(0).optional().nullable(),
      }),
    )
    .min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { contaId, operatorId } = await getStoreRequestContext();
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const { id } = await context.params;
    const data = await receiveRestockOrder({
      contaId,
      actorUserId: operatorId,
      restockOrderId: id,
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

    return jsonError(500, 'ERRO_RECEBER_REPOSICAO', (error as Error).message);
  }
}
