import { NextRequest, NextResponse } from 'next/server';

import { eligibleEventStudentsQueryDTOSchema } from '@/features/events/dtos';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';
import { listEligibleEventStudents } from '@/src/server/events/event-route-read.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.update');
    const searchParams = new URL(request.url).searchParams;
    const query = eligibleEventStudentsQueryDTOSchema.parse({
      anchorAlunoId: searchParams.get('anchorAlunoId') ?? undefined,
      responsavelId: searchParams.get('responsavelId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
    });
    const anchorAlunoId = query.anchorAlunoId;
    const responsavelId = query.responsavelId || undefined;
    const search = query.q || '';

    if (!anchorAlunoId) {
      return NextResponse.json({ error: { code: 'ALUNO_BASE_OBRIGATORIO', message: 'Selecione o primeiro aluno.' } }, { status: 422 });
    }

    const result = await listEligibleEventStudents({ eventId, contaId: ctx.contaId, anchorAlunoId, responsavelId, search });
    if (!result) {
      return NextResponse.json({ error: { code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno não encontrado.' } }, { status: 404 });
    }

    if ('invalidResponsavel' in result && result.invalidResponsavel) {
      return NextResponse.json({ error: { code: 'RESPONSAVEL_FINANCEIRO_INVALIDO', message: 'O responsável financeiro não está vinculado ao aluno.' } }, { status: 422 });
    }

    return NextResponse.json({
      data: {
        responsaveis: result.responsaveis,
        selectedResponsavelId: result.selectedResponsavelId,
        items: result.items,
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_ALUNOS_DO_RESPONSAVEL');
  }
}
