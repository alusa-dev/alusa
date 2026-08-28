import { NextResponse } from 'next/server';
import { z } from 'zod';

import { listStoreSaleOperationalIssues } from '@alusa/finance';

import { safeGetServerSession } from '@/lib/safe-server-session';

const querySchema = z.object({
  staleAfterMinutes: z.coerce.number().int().min(1).max(24 * 60).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await safeGetServerSession();
    const user = session?.user as { contaId?: string | null } | undefined;
    const contaId = user?.contaId?.trim() || null;

    if (!contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return jsonError(422, 'ERRO_VALIDACAO', 'Parâmetros inválidos.', parsed.error.flatten());
    }

    const data = await listStoreSaleOperationalIssues({ contaId, ...parsed.data });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[api/vendas/operacional][GET][error]', {
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      500,
      'ERRO_LISTAR_PENDENCIAS_VENDAS',
      'Não foi possível carregar as pendências operacionais.',
    );
  }
}
