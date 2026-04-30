import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getStoreSaleById,
  registerStoreSaleReturn,
  StoreSaleError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../../_helpers';

const requestSchema = z.object({
  reason: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        saleItemId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
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
    await registerStoreSaleReturn({
      contaId,
      saleId: id,
      operatorId,
      reason: parsed.data.reason,
      items: parsed.data.items,
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

    return jsonError(500, 'ERRO_REGISTRAR_DEVOLUCAO', (error as Error).message);
  }
}
