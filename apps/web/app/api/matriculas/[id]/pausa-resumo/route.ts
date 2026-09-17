import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  getPausaResumo,
  PausaBusinessError,
} from '@/src/server/matriculas/matricula-pausa.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const rawParams = await params;
    const result = await getPausaResumo(rawParams.id, auth.contaId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PausaBusinessError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.statusCode },
      );
    }

    console.error('[PAUSA_RESUMO] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
