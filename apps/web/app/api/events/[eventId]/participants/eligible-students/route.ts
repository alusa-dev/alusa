import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@alusa/database';

import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId } = await params;
    const ctx = await getEventsContext('events.update');
    const searchParams = new URL(request.url).searchParams;
    const anchorAlunoId = searchParams.get('anchorAlunoId')?.trim();
    const responsavelId = searchParams.get('responsavelId')?.trim() || undefined;
    const query = searchParams.get('q')?.trim() || '';

    if (!anchorAlunoId) {
      return NextResponse.json({ error: { code: 'ALUNO_BASE_OBRIGATORIO', message: 'Selecione o primeiro aluno.' } }, { status: 422 });
    }

    const anchor = await prisma.aluno.findFirst({
      where: { id: anchorAlunoId, contaId: ctx.contaId },
      select: {
        id: true,
        responsaveis: {
          where: { contaId: ctx.contaId, responsavel: { financeiro: true } },
          select: { responsavel: { select: { id: true, nome: true } } },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!anchor) {
      return NextResponse.json({ error: { code: 'ALUNO_NAO_ENCONTRADO', message: 'Aluno não encontrado.' } }, { status: 404 });
    }

    const responsaveis = anchor.responsaveis.map(({ responsavel }) => responsavel);
    const selectedResponsavelId = responsavelId ?? (responsaveis.length === 1 ? responsaveis[0]?.id : undefined);

    if (selectedResponsavelId && !responsaveis.some((responsavel) => responsavel.id === selectedResponsavelId)) {
      return NextResponse.json({ error: { code: 'RESPONSAVEL_FINANCEIRO_INVALIDO', message: 'O responsável financeiro não está vinculado ao aluno.' } }, { status: 422 });
    }

    if (!selectedResponsavelId) {
      return NextResponse.json({ data: { responsaveis, items: [] } });
    }

    const items = await prisma.aluno.findMany({
      where: {
        contaId: ctx.contaId,
        status: 'ATIVO',
        id: { not: anchorAlunoId },
        ...(query ? { nome: { contains: query, mode: 'insensitive' } } : {}),
        responsaveis: {
          some: { contaId: ctx.contaId, responsavelId: selectedResponsavelId },
        },
        eventParticipants: { none: { contaId: ctx.contaId, eventId } },
      },
      select: { id: true, nome: true, email: true },
      orderBy: { nome: 'asc' },
      take: 20,
    });

    return NextResponse.json({
      data: {
        responsaveis,
        selectedResponsavelId,
        items,
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_LISTAR_ALUNOS_DO_RESPONSAVEL');
  }
}
