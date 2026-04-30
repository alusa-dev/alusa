import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  adjustInventory,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../_helpers';

const requestSchema = z.object({
  requestId: z.string().trim().optional(),
  productId: z.string().trim().min(1),
  variantId: z.string().trim().optional().nullable(),
  mode: z.enum(['SET', 'DELTA']),
  quantity: z.number(),
  reasonCode: z.enum(['COUNT', 'LOSS', 'DAMAGE', 'CORRECTION']),
  note: z.string().trim().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const { contaId, operatorId } = await getStoreRequestContext();
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const data = await adjustInventory({
      contaId,
      actorUserId: operatorId,
      requestId: parsed.data.requestId?.trim() || crypto.randomUUID(),
      productId: parsed.data.productId,
      variantId: parsed.data.variantId,
      mode: parsed.data.mode,
      quantity: parsed.data.quantity,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note,
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

    return jsonError(500, 'ERRO_REGISTRAR_AJUSTE', (error as Error).message);
  }
}
