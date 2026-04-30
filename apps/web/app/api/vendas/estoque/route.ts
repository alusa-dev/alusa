import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  listInventoryBalances,
  StoreInventoryError,
} from '@alusa/finance';

import { getStoreRequestContext, jsonError } from '../_helpers';

const querySchema = z.object({
  search: z.string().trim().optional(),
  productId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  lowOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export async function GET(request: Request) {
  try {
    const { contaId } = await getStoreRequestContext();
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Parâmetros inválidos.', parsed.error.flatten());
    }

    const data = await listInventoryBalances({
      contaId,
      search: parsed.data.search,
      productId: parsed.data.productId,
      variantId: parsed.data.variantId,
      lowOnly: parsed.data.lowOnly,
      includeInactive: parsed.data.includeInactive,
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

    return jsonError(500, 'ERRO_LISTAR_ESTOQUE', (error as Error).message);
  }
}
