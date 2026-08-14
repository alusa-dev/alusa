import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listEventContractsByStudent } from '@alusa/lib';
import { getEventsContext, handleEventsRouteError } from '../events/_helpers';

const querySchema = z.object({
  alunoId: z.string().trim().min(1),
  eventId: z.string().trim().min(1).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await getEventsContext('events.view');
    const parsed = querySchema.safeParse({
      alunoId: new URL(request.url).searchParams.get('alunoId') ?? undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: { message: 'Aluno inválido.' } }, { status: 400 });
    return NextResponse.json({ data: await listEventContractsByStudent(ctx.contaId, parsed.data.alunoId) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_CONTRATOS_EVENTO');
  }
}
