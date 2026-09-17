import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { z } from 'zod';
import {
  PausaBusinessError,
} from '@/src/server/matriculas/matricula-pausa.service';
import { pauseMatriculaFromHttp } from '@/src/server/matriculas/matricula-http-commands.service';
import { notifyMatriculaAction } from '@alusa/lib/notifications/matricula-notifications';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

export const dynamic = 'force-dynamic';

const pausarInputSchema = z.object({
  motivoPausa: z.string().trim().min(1, 'Motivo é obrigatório'),
  dataInicioPausa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  dataRetornoPrevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  manterVaga: z.boolean(),
  cobrarDurantePausa: z.boolean(),
  observacao: z.string().trim().optional(),
}).superRefine((value, ctx) => {
  if (value.dataRetornoPrevista && value.dataRetornoPrevista <= value.dataInicioPausa) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dataRetornoPrevista'],
      message: 'A data de retorno deve ser posterior ao início da pausa.',
    });
  }
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
    const parsed = pausarInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Dados inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await pauseMatriculaFromHttp({
      matriculaId: rawParams.id,
      contaId: auth.contaId,
      actorId: auth.userId,
      ...parsed.data,
    });

    void notifyMatriculaAction({
      matriculaId: rawParams.id,
      contaId: auth.contaId,
      action: 'PAUSADA',
      motivo: parsed.data.motivoPausa,
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

    console.error('[PAUSAR_MATRICULA] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
