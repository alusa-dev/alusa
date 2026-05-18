import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/src/prisma';
import { z } from 'zod';
import {
  reativarMatricula,
  PausaBusinessError,
} from '@/src/server/matriculas/matricula-pausa.service';
import { notifyMatriculaAction } from '@alusa/lib';

export const dynamic = 'force-dynamic';

const reativarInputSchema = z.object({
  dataRetornoEfetiva: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD'),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data da próxima cobrança deve estar no formato YYYY-MM-DD'),
  observacao: z.string().trim().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    const user = (session as { user?: { id?: string; contaId?: string } })?.user;

    if (!user?.id || !user?.contaId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = reativarInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Dados inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await reativarMatricula({
      prisma,
      matriculaId: params.id,
      contaId: user.contaId,
      actorId: user.id,
      ...parsed.data,
    });

    void notifyMatriculaAction({
      matriculaId: params.id,
      contaId: user.contaId,
      action: 'RETOMADA',
      motivo: parsed.data.observacao,
      actorUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PausaBusinessError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details ?? null },
        { status: error.statusCode },
      );
    }

    console.error('[REATIVAR_MATRICULA] Erro inesperado:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Erro interno do servidor' },
      { status: 500 },
    );
  }
}
