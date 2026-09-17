import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { z } from 'zod';
import {
  PausaBusinessError,
} from '@/src/server/matriculas/matricula-pausa.service';
import { reactivateMatriculaFromHttp } from '@/src/server/matriculas/matricula-http-commands.service';
import { notifyMatriculaAction } from '@alusa/lib/notifications/matricula-notifications';
import { isPlatformBillingCapacityError } from '@/src/server/platform-billing/capacity';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';

const reativarInputSchema = z.object({
  dataRetornoEfetiva: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data da próxima cobrança deve estar no formato YYYY-MM-DD'),
  observacao: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ENROLLMENT_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    const rawParams = await params;
    const body = await request.json();
    const parsed = reativarInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Dados inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await reactivateMatriculaFromHttp({
      matriculaId: rawParams.id,
      contaId: auth.contaId,
      actorId: auth.userId,
      ...parsed.data,
    });

    void notifyMatriculaAction({
      matriculaId: rawParams.id,
      contaId: auth.contaId,
      action: 'RETOMADA',
      motivo: parsed.data.observacao,
      actorUserId: auth.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PausaBusinessError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details ?? null },
        { status: error.statusCode },
      );
    }

    if (isPlatformBillingCapacityError(error)) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        { status: 422 },
      );
    }

    console.error('[REATIVAR_MATRICULA] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
