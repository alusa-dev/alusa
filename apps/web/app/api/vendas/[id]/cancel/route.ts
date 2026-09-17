import { NextResponse } from 'next/server';
import { z } from 'zod';

import { cancelStoreSale, StoreSaleError } from '@alusa/finance';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';

const bodySchema = z.object({
  reason: z.string().trim().min(3),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
    }
    const { contaId, userId: operatorId } = auth;

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação.', parsed.error.flatten());
    }

    const { id } = await context.params;
    const sale = await cancelStoreSale({
      contaId,
      saleId: id,
      operatorId,
      reason: parsed.data.reason,
    });

    return NextResponse.json({ data: sale });
  } catch (error) {
    if (error instanceof StoreSaleError) {
      return jsonError(error.status, error.code, error.message);
    }

    return jsonError(500, 'ERRO_CANCELAR_VENDA', 'Não foi possível cancelar a venda.');
  }
}
