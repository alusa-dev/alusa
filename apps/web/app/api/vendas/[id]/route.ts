import { NextResponse } from 'next/server';

import { getStoreSaleById, StoreSaleError } from '@alusa/finance';

import { safeGetServerSession } from '@/lib/safe-server-session';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await safeGetServerSession();
    const user = session?.user as { contaId?: string | null } | undefined;
    const contaId = user?.contaId?.trim() || null;

    if (!contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
    }

    const { id } = await context.params;
    const sale = await getStoreSaleById({ contaId, saleId: id });

    if (!sale) {
      return jsonError(404, 'VENDA_NAO_ENCONTRADA', 'Venda não encontrada.');
    }

    return NextResponse.json({ data: sale });
  } catch (error) {
    if (error instanceof StoreSaleError) {
      return jsonError(error.status, error.code, error.message);
    }

    return jsonError(500, 'ERRO_OBTER_VENDA', (error as Error).message);
  }
}