import type {
  CreateMakeupClassInputDTO,
  ListMakeupClassesQueryDTO,
  MakeupClassDetailsResultDTO,
  ListMakeupClassesResultDTO,
  UpdateMakeupClassInputDTO,
} from '@/features/aulas/dtos';
import {
  assertNoCalendarConflicts,
  getCalendarEventOrThrow,
  loadAlunoResources,
  loadAulasResources,
} from '@/src/server/aulas/calendar/calendar-core.service';
import { AulasError } from '@/src/server/aulas/aulas-error';
import { createAulasOperationLog } from '@/src/server/aulas/calendar/operation-log.service';
import { prisma } from '@/src/prisma';

async function resolveTurmaDefaults(contaId: string, turmaId: string) {
  return prisma.turma.findFirst({
    where: {
      id: turmaId,
      contaId,
    },
    include: {
      professores: {
        select: {
          professorId: true,
        },
      },
    },
  });
}

async function getMakeupOrThrow(contaId: string, id: string) {
  const makeup = await prisma.makeupClass.findFirst({
    where: { id, contaId },
    include: {
      aluno: { select: { id: true, nome: true } },
      turmaOrigem: { select: { id: true, nome: true } },
      turmaDestino: { select: { id: true, nome: true } },
      eventoOrigem: { select: { id: true, titulo: true, startAt: true } },
      eventoDestino: { select: { id: true, titulo: true, startAt: true } },
    },
  });

  if (!makeup) {
    throw new AulasError('REPOSICAO_NAO_ENCONTRADA', 'Reposição não encontrada.');
  }

  return makeup;
}

type MakeupClassWithRelations = Awaited<ReturnType<typeof getMakeupOrThrow>>;

function mapMakeupItem(makeup: MakeupClassWithRelations) {
  return {
    id: makeup.id,
    scope: makeup.scope,
    status: makeup.status,
    observacao: makeup.observacao ?? null,
    createdAt: makeup.createdAt.toISOString(),
    aluno: makeup.aluno ? { id: makeup.aluno.id, label: makeup.aluno.nome } : null,
    turmaOrigem: { id: makeup.turmaOrigem.id, label: makeup.turmaOrigem.nome },
    turmaDestino: { id: makeup.turmaDestino.id, label: makeup.turmaDestino.nome },
    eventoOrigem: {
      id: makeup.eventoOrigem.id,
      title: makeup.eventoOrigem.titulo,
      startAt: makeup.eventoOrigem.startAt.toISOString(),
    },
    eventoDestino: {
      id: makeup.eventoDestino.id,
      title: makeup.eventoDestino.titulo,
      startAt: makeup.eventoDestino.startAt.toISOString(),
    },
  };
}

async function syncDestinationEventFromMakeupStatus(
  contaId: string,
  destinoEventoId: string,
  status: 'AGENDADA' | 'REALIZADA' | 'CANCELADA',
) {
  if (status === 'REALIZADA') {
    await prisma.calendarEvent.updateMany({
      where: {
        id: destinoEventoId,
        contaId,
        status: { not: 'CANCELADO' },
      },
      data: {
        status: 'REALIZADO',
        cancelledAt: null,
      },
    });
    return;
  }

  if (status !== 'CANCELADA') return;

  const [event, activeLinks] = await Promise.all([
    prisma.calendarEvent.findFirst({
      where: { id: destinoEventoId, contaId },
      select: { id: true, source: true },
    }),
    prisma.makeupClass.count({
      where: {
        contaId,
        eventoDestinoId: destinoEventoId,
        status: { not: 'CANCELADA' },
      },
    }),
  ]);

  if (!event || event.source !== 'REPOSICAO' || activeLinks > 0) return;

  await prisma.calendarEvent.update({
    where: { id: destinoEventoId },
    data: {
      status: 'CANCELADO',
      cancelledAt: new Date(),
    },
  });
}

export async function getMakeupClassDetails(
  contaId: string,
  id: string,
): Promise<MakeupClassDetailsResultDTO> {
  return {
    success: true,
    data: mapMakeupItem(await getMakeupOrThrow(contaId, id)),
  };
}

export async function listMakeupClasses(
  contaId: string,
  query: ListMakeupClassesQueryDTO,
): Promise<ListMakeupClassesResultDTO> {
  const [resources, alunos, items] = await Promise.all([
    loadAulasResources(contaId, prisma),
    loadAlunoResources(contaId, prisma),
    prisma.makeupClass.findMany({
      where: {
        contaId,
        alunoId: query.alunoId ?? undefined,
        status: query.status?.length ? { in: query.status as never[] } : undefined,
        OR: query.turmaId
          ? [{ turmaOrigemId: query.turmaId }, { turmaDestinoId: query.turmaId }]
          : undefined,
        eventoDestino:
          query.startDate || query.endDate
            ? {
                startAt: {
                  gte: query.startDate ? new Date(query.startDate) : undefined,
                  lte: query.endDate ? new Date(query.endDate) : undefined,
                },
              }
            : undefined,
      },
      include: {
        aluno: { select: { id: true, nome: true } },
        turmaOrigem: { select: { id: true, nome: true } },
        turmaDestino: { select: { id: true, nome: true } },
        eventoOrigem: { select: { id: true, titulo: true, startAt: true } },
        eventoDestino: { select: { id: true, titulo: true, startAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    success: true,
    data: {
      resources: {
        turmas: resources.turmas,
        alunos,
      },
      items: items.map((item) => mapMakeupItem(item)),
    },
  };
}

export async function createMakeupClass(
  contaId: string,
  userId: string,
  input: CreateMakeupClassInputDTO,
): Promise<MakeupClassDetailsResultDTO> {
  const origemEvento = await getCalendarEventOrThrow(input.eventoOrigemId, contaId, prisma);
  const turmaOrigem = await prisma.turma.findFirst({
    where: { id: input.turmaOrigemId, contaId },
    select: { id: true },
  });
  const turmaDestino = await resolveTurmaDefaults(contaId, input.turmaDestinoId);

  if (!turmaOrigem || !turmaDestino) {
    throw new AulasError('TURMA_ORIGEM_DESTINO_INVALIDA', 'Turma de origem ou destino não encontrada.');
  }

  if (origemEvento.turmaId && origemEvento.turmaId !== input.turmaOrigemId) {
    throw new AulasError('TURMA_ORIGEM_DESTINO_INVALIDA', 'O evento de origem não pertence à turma informada.');
  }

  if (input.scope === 'INDIVIDUAL' && !input.alunoId && !input.matriculaId) {
    throw new AulasError('REPOSICAO_INDIVIDUAL_SEM_ALUNO', 'Reposição individual exige aluno ou matrícula.');
  }

  let destinoEventoId = input.eventoDestinoId ?? null;

  if (!destinoEventoId) {
    if (!input.destinationEvent) {
      throw new AulasError('EVENTO_DESTINO_OBRIGATORIO', 'Informe o evento de destino ou os dados para criá-lo.');
    }

    const professorIds = input.destinationEvent.professorIds.length
      ? input.destinationEvent.professorIds
      : turmaDestino.professores.map((item) => item.professorId);
    const salaId = input.destinationEvent.salaId ?? turmaDestino.salaId ?? null;
    const startAt = new Date(input.destinationEvent.startAt);
    const endAt = new Date(input.destinationEvent.endAt);

    await assertNoCalendarConflicts({
      contaId,
      startAt,
      endAt,
      salaId,
      professorIds,
      prismaClient: prisma,
    });

    const createdEvent = await prisma.calendarEvent.create({
      data: {
        contaId,
        tipo: 'REPOSICAO',
        status: 'AGENDADO',
        source: 'REPOSICAO',
        manuallyAdjusted: true,
        titulo: input.destinationEvent.title ?? `Reposição • ${turmaDestino.nome}`,
        descricao: input.observacao ?? null,
        startAt,
        endAt,
        turmaId: turmaDestino.id,
        salaId,
        professores: professorIds.length
          ? {
              create: professorIds.map((professorId) => ({
                conta: {
                  connect: { id: contaId },
                },
                professor: {
                  connect: { id: professorId },
                },
              })),
            }
          : undefined,
      },
      select: { id: true },
    });

    destinoEventoId = createdEvent.id;
  } else {
    const destinoEvento = await getCalendarEventOrThrow(destinoEventoId, contaId, prisma);

    if (destinoEvento.turmaId && destinoEvento.turmaId !== input.turmaDestinoId) {
      throw new AulasError(
        'TURMA_ORIGEM_DESTINO_INVALIDA',
        'O evento de destino não pertence à turma de destino informada.',
      );
    }

    if (!['AULA', 'REPOSICAO'].includes(destinoEvento.tipo)) {
      throw new AulasError(
        'OPERACAO_NAO_PERMITIDA',
        'O evento de destino deve ser uma aula ou reposição ativa.',
      );
    }

    if (destinoEvento.status === 'CANCELADO') {
      throw new AulasError(
        'OPERACAO_NAO_PERMITIDA',
        'Eventos cancelados não podem ser usados como destino de reposição.',
      );
    }
  }

  let matriculaId = input.matriculaId ?? null;
  if (!matriculaId && input.alunoId) {
    const matricula = await prisma.matricula.findFirst({
      where: {
        alunoId: input.alunoId,
        OR: [{ turmaId: input.turmaOrigemId }, { matriculaTurmas: { some: { turmaId: input.turmaOrigemId } } }],
        status: { in: ['ATIVA', 'PAUSADA'] },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    matriculaId = matricula?.id ?? null;
  }

  const created = await prisma.makeupClass.create({
    data: {
      contaId,
      scope: input.scope,
      alunoId: input.alunoId ?? null,
      matriculaId,
      eventoOrigemId: origemEvento.id,
      eventoDestinoId: destinoEventoId,
      turmaOrigemId: input.turmaOrigemId,
      turmaDestinoId: input.turmaDestinoId,
      status: 'AGENDADA',
      observacao: input.observacao ?? null,
      createdByUserId: userId,
    },
    select: { id: true },
  });

  await createAulasOperationLog({
    contaId,
    action: 'MAKEUP_CREATED',
    entityType: 'MAKEUP_CLASS',
    entityId: created.id,
    message: 'Reposição criada com origem e destino vinculados.',
    details: {
      scope: input.scope,
      alunoId: input.alunoId ?? null,
      eventoOrigemId: origemEvento.id,
      eventoDestinoId: destinoEventoId,
      turmaOrigemId: input.turmaOrigemId,
      turmaDestinoId: input.turmaDestinoId,
    },
    prismaClient: prisma,
  });

  return getMakeupClassDetails(contaId, created.id);
}

export async function updateMakeupClass(
  contaId: string,
  id: string,
  input: UpdateMakeupClassInputDTO,
): Promise<MakeupClassDetailsResultDTO> {
  const current = await getMakeupOrThrow(contaId, id);
  const nextStatus = input.status ?? current.status;

  await prisma.makeupClass.update({
    where: { id },
    data: {
      status: nextStatus,
      observacao: input.observacao !== undefined ? input.observacao ?? null : current.observacao,
    },
  });

  await syncDestinationEventFromMakeupStatus(contaId, current.eventoDestino.id, nextStatus);
  await createAulasOperationLog({
    contaId,
    action: 'MAKEUP_UPDATED',
    entityType: 'MAKEUP_CLASS',
    entityId: id,
    message:
      nextStatus === 'REALIZADA'
        ? 'Reposição marcada como realizada.'
        : nextStatus === 'CANCELADA'
          ? 'Reposição cancelada.'
          : 'Reposição atualizada.',
    details: {
      status: nextStatus,
      eventoDestinoId: current.eventoDestino.id,
      eventoOrigemId: current.eventoOrigem.id,
    },
    prismaClient: prisma,
  });

  return getMakeupClassDetails(contaId, id);
}
