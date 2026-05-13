import type {
  CreateExperimentalClassInputDTO,
  ExperimentalClassDetailsResultDTO,
  UpdateExperimentalClassInputDTO,
} from '@/features/aulas/dtos';
import {
  assertNoCalendarConflicts,
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

async function getExperimentalOrThrow(contaId: string, id: string) {
  const record = await prisma.aulaExperimental.findFirst({
    where: { id, contaId },
    include: {
      aluno: { select: { id: true, nome: true } },
      calendarEvent: {
        include: {
          turma: { select: { id: true, nome: true } },
          sala: { select: { id: true, nome: true } },
          professores: {
            include: {
              professor: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!record) {
    throw new AulasError('AULA_EXPERIMENTAL_NAO_ENCONTRADA', 'Aula experimental não encontrada.');
  }

  return record;
}

function mapExperimentalDetails(record: Awaited<ReturnType<typeof getExperimentalOrThrow>>) {
  return {
    id: record.id,
    calendarEventId: record.calendarEventId,
    status: record.status,
    observacao: record.observacao ?? null,
    aluno: { id: record.aluno.id, label: record.aluno.nome },
    turma: record.calendarEvent.turma
      ? { id: record.calendarEvent.turma.id, label: record.calendarEvent.turma.nome }
      : null,
    sala: record.calendarEvent.sala
      ? { id: record.calendarEvent.sala.id, label: record.calendarEvent.sala.nome }
      : null,
    professores: record.calendarEvent.professores.map((item) => ({
      id: item.professor.id,
      label: item.professor.nome,
    })),
    startAt: record.calendarEvent.startAt.toISOString(),
    endAt: record.calendarEvent.endAt.toISOString(),
    title: record.calendarEvent.titulo,
  };
}

export async function getExperimentalClassDetails(
  contaId: string,
  id: string,
): Promise<ExperimentalClassDetailsResultDTO> {
  return {
    success: true,
    data: mapExperimentalDetails(await getExperimentalOrThrow(contaId, id)),
  };
}

export async function createExperimentalClass(
  contaId: string,
  userId: string,
  input: CreateExperimentalClassInputDTO,
): Promise<ExperimentalClassDetailsResultDTO> {
  const [aluno, turmaDefaults] = await Promise.all([
    prisma.aluno.findFirst({
      where: {
        id: input.alunoId,
        contaId,
        status: 'ATIVO',
      },
      select: { id: true, nome: true },
    }),
    resolveTurmaDefaults(contaId, input.turmaId),
  ]);

  if (!aluno) {
    throw new AulasError('ALUNO_NAO_ELEGIVEL', 'Selecione um aluno ativo para a aula experimental.');
  }

  if (!turmaDefaults) {
    throw new AulasError('TURMA_NAO_ENCONTRADA', 'Turma não encontrada para a aula experimental.');
  }

  const professorIds = input.professorIds.length
    ? input.professorIds
    : turmaDefaults.professores.map((item) => item.professorId);
  const salaId = input.salaId ?? turmaDefaults.salaId ?? null;
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);

  await assertNoCalendarConflicts({
    contaId,
    startAt,
    endAt,
    salaId,
    professorIds,
    turmaId: input.turmaId,
    allowOwnTurmaRecurringOverlap: true,
    prismaClient: prisma,
  });

  const title = `Aula experimental • ${aluno.nome}`;

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        contaId,
        tipo: 'AULA_EXPERIMENTAL',
        status: 'AGENDADO',
        source: 'AULA_EXPERIMENTAL',
        manuallyAdjusted: true,
        titulo: title,
        descricao: input.observacao ?? null,
        startAt,
        endAt,
        turmaId: input.turmaId,
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

    const experimental = await tx.aulaExperimental.create({
      data: {
        contaId,
        calendarEventId: event.id,
        alunoId: aluno.id,
        status: 'AGENDADA',
        observacao: input.observacao ?? null,
        uiRequestId: input.uiRequestId,
        createdByUserId: userId,
      },
      select: { id: true },
    });

    await createAulasOperationLog({
      contaId,
      action: 'EXPERIMENTAL_CREATED',
      entityType: 'AULA_EXPERIMENTAL',
      entityId: experimental.id,
      message: `Aula experimental criada para ${aluno.nome}.`,
      details: {
        alunoId: aluno.id,
        calendarEventId: event.id,
        turmaId: input.turmaId,
        salaId,
        professorIds,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      },
      prismaClient: tx,
    });

    return experimental.id;
  });

  return getExperimentalClassDetails(contaId, created);
}

export async function updateExperimentalClass(
  contaId: string,
  id: string,
  input: UpdateExperimentalClassInputDTO,
): Promise<ExperimentalClassDetailsResultDTO> {
  const current = await getExperimentalOrThrow(contaId, id);
  const nextAlunoId = input.alunoId ?? current.alunoId;
  const nextTurmaId = input.turmaId ?? current.calendarEvent.turmaId;

  if (!nextTurmaId) {
    throw new AulasError('TURMA_NAO_ENCONTRADA', 'A aula experimental precisa permanecer vinculada a uma turma.');
  }

  const [aluno, turmaDefaults] = await Promise.all([
    prisma.aluno.findFirst({
      where: { id: nextAlunoId, contaId, status: 'ATIVO' },
      select: { id: true, nome: true },
    }),
    resolveTurmaDefaults(contaId, nextTurmaId),
  ]);

  if (!aluno) {
    throw new AulasError('ALUNO_NAO_ELEGIVEL', 'Selecione um aluno ativo para a aula experimental.');
  }

  if (!turmaDefaults) {
    throw new AulasError('TURMA_NAO_ENCONTRADA', 'Turma não encontrada para a aula experimental.');
  }

  const currentProfessorIds = current.calendarEvent.professores.map((item) => item.professor.id);
  const professorIds = input.professorIds ?? (currentProfessorIds.length
    ? currentProfessorIds
    : turmaDefaults.professores.map((item) => item.professorId));
  const salaId = input.salaId !== undefined ? input.salaId : (current.calendarEvent.salaId ?? turmaDefaults.salaId ?? null);
  const startAt = input.startAt ? new Date(input.startAt) : current.calendarEvent.startAt;
  const endAt = input.endAt ? new Date(input.endAt) : current.calendarEvent.endAt;

  await assertNoCalendarConflicts({
    contaId,
    startAt,
    endAt,
    salaId,
    professorIds,
    turmaId: nextTurmaId,
    allowOwnTurmaRecurringOverlap: true,
    ignoreEventId: current.calendarEventId,
    prismaClient: prisma,
  });

  const wasRescheduled =
    startAt.getTime() !== current.calendarEvent.startAt.getTime() ||
    endAt.getTime() !== current.calendarEvent.endAt.getTime() ||
    nextTurmaId !== current.calendarEvent.turmaId ||
    salaId !== current.calendarEvent.salaId ||
    currentProfessorIds.length !== professorIds.length ||
    professorIds.some((item) => !currentProfessorIds.includes(item));

  const nextStatus =
    input.status ??
    (wasRescheduled && current.status === 'AGENDADA' ? 'REAGENDADA' : current.status);

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: current.calendarEventId },
      data: {
        tipo: 'AULA_EXPERIMENTAL',
        titulo: `Aula experimental • ${aluno.nome}`,
        descricao: input.observacao !== undefined ? input.observacao ?? null : current.observacao,
        startAt,
        endAt,
        turmaId: nextTurmaId,
        salaId,
        status:
          nextStatus === 'CANCELADA'
            ? 'CANCELADO'
            : nextStatus === 'REALIZADA'
              ? 'REALIZADO'
              : 'AGENDADO',
        cancelledAt: nextStatus === 'CANCELADA' ? new Date() : null,
        professores: {
          deleteMany: {},
          create: professorIds.map((professorId) => ({
            conta: {
              connect: { id: contaId },
            },
            professor: {
              connect: { id: professorId },
            },
          })),
        },
      },
    });

    await tx.aulaExperimental.update({
      where: { id },
      data: {
        alunoId: aluno.id,
        observacao: input.observacao !== undefined ? input.observacao ?? null : current.observacao,
        status: nextStatus,
      },
    });

    await createAulasOperationLog({
      contaId,
      action: wasRescheduled ? 'EXPERIMENTAL_RESCHEDULED' : 'EXPERIMENTAL_UPDATED',
      entityType: 'AULA_EXPERIMENTAL',
      entityId: id,
      message: wasRescheduled
        ? `Aula experimental de ${aluno.nome} reagendada.`
        : `Aula experimental de ${aluno.nome} atualizada.`,
      details: {
        alunoId: aluno.id,
        calendarEventId: current.calendarEventId,
        turmaId: nextTurmaId,
        salaId,
        professorIds,
        status: nextStatus,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      },
      prismaClient: tx,
    });
  });

  return getExperimentalClassDetails(contaId, id);
}