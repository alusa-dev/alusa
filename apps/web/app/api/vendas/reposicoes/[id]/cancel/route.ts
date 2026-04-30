import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  cancelRestockOrder,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../../_helpers';

const requestSchema = z.object({
  reason: z.string().trim().optional().nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { contaId, operatorId } = await getStoreRequestContext();
    const body = await request.json().catch(() => ({}));
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const { id } = await context.params;
    const data = await cancelRestockOrder({
      contaId,
      actorUserId: operatorId,
      restockOrderId: id,
      reason: parsed.data.reason,
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

    return jsonError(500, 'ERRO_CANCELAR_REPOSICAO', (error as Error).message);
  }
}
