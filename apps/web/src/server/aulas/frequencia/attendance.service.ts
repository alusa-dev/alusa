import type { CalendarEventType, Prisma } from '@prisma/client';

import type {
  AttendanceHistoryTurmaResultDTO,
  AttendanceStatusDTO,
  AttendanceEventDetailsResultDTO,
  ListAttendanceQueryDTO,
  ListAttendanceResultDTO,
  SaveAttendanceInputDTO,
} from '@/features/aulas/dtos';
import {
  evaluateAttendanceLaunchPolicy,
  getAttendanceLaunchPolicyMessage,
} from '@/features/aulas/utils/attendance-launch';
import { AulasError } from '@/src/server/aulas/aulas-error';
import {
  buildAttendanceSummary,
  buildConflictMap,
  buildEligibleMatriculaWhere,
  getCalendarEventOrThrow,
  listCalendarEventsRaw,
  loadAulasResources,
  mapCalendarEventDetails,
} from '@/src/server/aulas/calendar/calendar-core.service';
import { autoCloseAgendaEventIfDue } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';
import { createAulasOperationLog } from '@/src/server/aulas/calendar/operation-log.service';
import { prisma } from '@/src/prisma';

function summarizeAttendanceStatuses(statuses: AttendanceStatusDTO[]) {
  return {
    recorded: statuses.length,
    presentes: statuses.filter((status) => status === 'PRESENTE').length,
    faltas: statuses.filter((status) => status === 'FALTA').length,
    justificadas: statuses.filter((status) => status === 'FALTA_JUSTIFICADA').length,
    atrasos: statuses.filter((status) => status === 'ATRASO').length,
    reposicoes: statuses.filter((status) => status === 'REPOSICAO').length,
  };
}

function buildAttendanceHistoryWhere(contaId: string, query: ListAttendanceQueryDTO, turmaId?: string) {
  return {
    contaId,
    turmaId: turmaId ?? query.turmaId ?? undefined,
    tipo: { in: ['AULA', 'REPOSICAO'] as CalendarEventType[] },
    startAt: query.endDate ? { lt: new Date(query.endDate) } : undefined,
    endAt: query.startDate ? { gt: new Date(query.startDate) } : undefined,
    attendanceRecords: {
      some: {},
    },
    professores: query.professorId
      ? {
          some: {
            professorId: query.professorId,
          },
        }
      : undefined,
  } satisfies Prisma.CalendarEventWhereInput;
}

async function buildAttendanceDetails(
  contaId: string,
  eventId: string,
): Promise<AttendanceEventDetailsResultDTO> {
  await autoCloseAgendaEventIfDue({
    contaId,
    eventId,
    prismaClient: prisma,
  });

  const event = await getCalendarEventOrThrow(eventId, contaId, prisma);
  const nearbyEvents = await listCalendarEventsRaw({
    contaId,
    start: new Date(event.startAt.getTime() - 1000 * 60 * 60 * 24),
    end: new Date(event.endAt.getTime() + 1000 * 60 * 60 * 24),
    prismaClient: prisma,
  });
  const conflictMap = buildConflictMap(nearbyEvents);

  if (!event.turmaId) {
    return {
      success: true,
      data: {
        event: await mapCalendarEventDetails(event, prisma, conflictMap.get(event.id) ?? []),
        students: [],
        summary: buildAttendanceSummary(0, []),
      },
    };
  }

  const [matriculas, makeupStudents, existingRecords] = await Promise.all([
    prisma.matricula.findMany({
      where: buildEligibleMatriculaWhere(contaId, event.turmaId, event.startAt),
      include: {
        aluno: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: {
        aluno: {
          nome: 'asc',
        },
      },
    }),
    prisma.makeupClass.findMany({
      where: {
        contaId,
        eventoDestinoId: event.id,
        status: { not: 'CANCELADA' },
        alunoId: { not: null },
      },
      include: {
        aluno: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy: {
        aluno: {
          nome: 'asc',
        },
      },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        contaId,
        calendarEventId: event.id,
      },
      select: {
        alunoId: true,
        status: true,
        observacao: true,
      },
    }),
  ]);

  const recordMap = new Map(existingRecords.map((item) => [item.alunoId, item] as const));
  const statuses = existingRecords.map((item) => item.status);
  const mergedStudents = new Map<
    string,
    {
      alunoId: string;
      nome: string;
      matriculaId: string | null;
      source: 'TURMA' | 'REPOSICAO';
      makeupClassId?: string | null;
      status: typeof existingRecords[number]['status'] | null;
      observacao: string | null;
    }
  >();

  matriculas.forEach((matricula) => {
    mergedStudents.set(matricula.aluno.id, {
      alunoId: matricula.aluno.id,
      nome: matricula.aluno.nome,
      matriculaId: matricula.id,
      source: 'TURMA',
      makeupClassId: null,
      status: recordMap.get(matricula.aluno.id)?.status ?? null,
      observacao: recordMap.get(matricula.aluno.id)?.observacao ?? null,
    });
  });

  makeupStudents.forEach((makeup) => {
    if (!makeup.alunoId || !makeup.aluno) return;

    if (!mergedStudents.has(makeup.alunoId)) {
      mergedStudents.set(makeup.alunoId, {
        alunoId: makeup.aluno.id,
        nome: makeup.aluno.nome,
        matriculaId: makeup.matriculaId ?? null,
        source: 'REPOSICAO',
        makeupClassId: makeup.id,
        status: recordMap.get(makeup.aluno.id)?.status ?? null,
        observacao: recordMap.get(makeup.aluno.id)?.observacao ?? null,
      });
    }
  });

  const students = Array.from(mergedStudents.values()).sort((first, second) =>
    first.nome.localeCompare(second.nome, 'pt-BR'),
  );

  return {
    success: true,
    data: {
      event: await mapCalendarEventDetails(event, prisma, conflictMap.get(event.id) ?? []),
      students,
      summary: buildAttendanceSummary(students.length, statuses),
    },
  };
}

export async function getAttendanceEventDetails(contaId: string, eventId: string) {
  return buildAttendanceDetails(contaId, eventId);
}

export async function saveAttendanceForEvent(
  contaId: string,
  eventId: string,
  userId: string,
  input: SaveAttendanceInputDTO,
) {
  const details = await buildAttendanceDetails(contaId, eventId);
  const launchPolicy = evaluateAttendanceLaunchPolicy({
    startAt: details.data.event.startAt,
    status: details.data.event.status,
  });

  if (!launchPolicy.allowed) {
    if (launchPolicy.reason === 'WINDOW_EXPIRED') {
      throw new AulasError(
        'FREQUENCIA_FORA_DA_JANELA',
        getAttendanceLaunchPolicyMessage(launchPolicy.reason) ??
          'A janela operacional para lançar ou corrigir a frequência expirou.',
        {
          eventId,
          deadline: launchPolicy.deadline?.toISOString() ?? null,
        },
      );
    }

    throw new AulasError(
      details.data.event.status === 'CANCELADO' ? 'OPERACAO_NAO_PERMITIDA' : 'FREQUENCIA_DIA_INVALIDO',
      getAttendanceLaunchPolicyMessage(launchPolicy.reason) ??
        'A frequência só pode ser lançada a partir do dia da aula.',
      {
        eventId,
        deadline: launchPolicy.deadline?.toISOString() ?? null,
      },
    );
  }

  const eligibleStudentsByAlunoId = new Map(
    details.data.students.map((student) => [student.alunoId, student] as const),
  );

  for (const item of input.items) {
    const eligibleStudent = eligibleStudentsByAlunoId.get(item.alunoId);

    if (!eligibleStudent) {
      throw new AulasError('ALUNO_NAO_ELEGIVEL', 'A chamada contém aluno não elegível para esta ocorrência.');
    }

    if (item.matriculaId && item.matriculaId !== (eligibleStudent.matriculaId ?? null)) {
      throw new AulasError(
        'ALUNO_NAO_ELEGIVEL',
        'A chamada contém matrícula incompatível com o aluno elegível da ocorrência.',
        {
          alunoId: item.alunoId,
          expectedMatriculaId: eligibleStudent.matriculaId ?? null,
          receivedMatriculaId: item.matriculaId,
        },
      );
    }
  }

  await prisma.$transaction(
    input.items.map((item) => {
      const eligibleStudent = eligibleStudentsByAlunoId.get(item.alunoId)!;

      return prisma.attendanceRecord.upsert({
        where: {
          uq_attendance_event_aluno: {
            calendarEventId: eventId,
            alunoId: item.alunoId,
          },
        },
        update: {
          matriculaId: eligibleStudent.matriculaId ?? null,
          status: item.status,
          observacao: item.observacao ?? null,
          recordedAt: new Date(),
          recordedByUserId: userId,
        },
        create: {
          contaId,
          calendarEventId: eventId,
          alunoId: item.alunoId,
          matriculaId: eligibleStudent.matriculaId ?? null,
          status: item.status,
          observacao: item.observacao ?? null,
          recordedAt: new Date(),
          recordedByUserId: userId,
        },
      });
    }),
  );

  await prisma.calendarEvent.updateMany({
    where: {
      id: eventId,
      contaId,
      status: { not: 'CANCELADO' },
    },
    data: {
      status: 'REALIZADO',
      cancelledAt: null,
    },
  });
  await prisma.makeupClass.updateMany({
    where: {
      contaId,
      eventoDestinoId: eventId,
      status: 'AGENDADA',
    },
    data: {
      status: 'REALIZADA',
    },
  });
  await createAulasOperationLog({
    contaId,
    action: 'ATTENDANCE_SAVED',
    entityType: 'CALENDAR_EVENT',
    entityId: eventId,
    message: 'Chamada salva e evento marcado como realizado.',
    details: {
      items: input.items.length,
      recordedByUserId: userId,
    },
    prismaClient: prisma,
  });

  return buildAttendanceDetails(contaId, eventId);
}

export async function listAttendanceHistory(
  contaId: string,
  query: ListAttendanceQueryDTO,
): Promise<ListAttendanceResultDTO> {
  const [resources, events] = await Promise.all([
    loadAulasResources(contaId, prisma),
    prisma.calendarEvent.findMany({
      where: buildAttendanceHistoryWhere(contaId, query),
      include: {
        turma: { select: { id: true, nome: true } },
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
        attendanceRecords: {
          select: {
            status: true,
          },
        },
      },
      orderBy: [{ startAt: 'desc' }, { titulo: 'asc' }],
    } satisfies Prisma.CalendarEventFindManyArgs),
  ]);

  const grouped = new Map<
    string,
    {
      turma: { id: string; label: string };
      lastLaunchedAt: string;
      occurrenceCount: number;
      statuses: AttendanceStatusDTO[];
      professores: Map<string, { id: string; label: string }>;
    }
  >();

  for (const event of events) {
    if (!event.turma) continue;

    const statuses = event.attendanceRecords.map((item) => item.status as AttendanceStatusDTO);
    const current = grouped.get(event.turma.id) ?? {
      turma: { id: event.turma.id, label: event.turma.nome },
      lastLaunchedAt: event.startAt.toISOString(),
      occurrenceCount: 0,
      statuses: [],
      professores: new Map<string, { id: string; label: string }>(),
    };

    current.occurrenceCount += 1;
    current.statuses.push(...statuses);
    if (new Date(event.startAt).getTime() > new Date(current.lastLaunchedAt).getTime()) {
      current.lastLaunchedAt = event.startAt.toISOString();
    }

    event.professores.forEach((entry) => {
      current.professores.set(entry.professor.id, {
        id: entry.professor.id,
        label: entry.professor.nome,
      });
    });

    grouped.set(event.turma.id, current);
  }

  const allStatuses = events.flatMap((event) =>
    event.attendanceRecords.map((item) => item.status as AttendanceStatusDTO),
  );
  const items = Array.from(grouped.values())
    .map((item) => ({
      turma: item.turma,
      professores: Array.from(item.professores.values()).sort((first, second) =>
        first.label.localeCompare(second.label, 'pt-BR'),
      ),
      occurrenceCount: item.occurrenceCount,
      lastLaunchedAt: item.lastLaunchedAt,
      summary: summarizeAttendanceStatuses(item.statuses),
    }))
    .sort((first, second) => {
      const byDate =
        new Date(second.lastLaunchedAt).getTime() - new Date(first.lastLaunchedAt).getTime();

      if (byDate !== 0) return byDate;

      return (first.turma?.label ?? '').localeCompare(second.turma?.label ?? '', 'pt-BR');
    });

  return {
    success: true,
    data: {
      resources: {
        turmas: resources.turmas,
        professores: resources.professores,
      },
      summary: {
        totalTurmas: items.length,
        totalOcorrencias: events.filter((event) => Boolean(event.turma)).length,
        ...summarizeAttendanceStatuses(allStatuses),
      },
      items,
    },
  };
}

export async function listAttendanceHistoryByTurma(
  contaId: string,
  turmaId: string,
  query: ListAttendanceQueryDTO,
): Promise<AttendanceHistoryTurmaResultDTO> {
  const [turma, events] = await Promise.all([
    prisma.turma.findFirst({
      where: {
        id: turmaId,
        contaId,
      },
      select: {
        id: true,
        nome: true,
      },
    }),
    prisma.calendarEvent.findMany({
      where: buildAttendanceHistoryWhere(contaId, query, turmaId),
      include: {
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
        attendanceRecords: {
          select: {
            status: true,
          },
        },
      },
      orderBy: [{ startAt: 'desc' }, { titulo: 'asc' }],
    } satisfies Prisma.CalendarEventFindManyArgs),
  ]);

  if (!turma) {
    throw new Error('Turma não encontrada.');
  }

  const allStatuses = events.flatMap((event) =>
    event.attendanceRecords.map((item) => item.status as AttendanceStatusDTO),
  );

  return {
    success: true,
    data: {
      turma: {
        id: turma.id,
        label: turma.nome,
      },
      summary: {
        totalOcorrencias: events.length,
        ...summarizeAttendanceStatuses(allStatuses),
      },
      items: events.map((event) => ({
        eventId: event.id,
        eventTitle: event.titulo,
        eventType: event.tipo,
        date: event.startAt.toISOString(),
        professores: event.professores.map((entry) => ({
          id: entry.professor.id,
          nome: entry.professor.nome,
        })),
        summary: summarizeAttendanceStatuses(
          event.attendanceRecords.map((item) => item.status as AttendanceStatusDTO),
        ),
      })),
    },
  };
}
