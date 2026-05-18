import { Prisma } from '@prisma/client';
import type { AttendanceStatus, PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';

import type {
  AulasDashboardItemDTO,
  AulasLookupItemDTO,
  AulasTurmaLookupItemDTO,
  CalendarEventAttendanceSummaryDTO,
  CalendarEventConflictDTO,
  CalendarEventDetailsDTO,
  CalendarEventListItemDTO,
} from '@/features/aulas/dtos';
import { AulasError } from '@/src/server/aulas/aulas-error';
import {
  combineWallClockOnZonedCalendarDay,
  DEFAULT_ACCOUNT_TIMEZONE,
  eachZonedCalendarDayInRange,
  endOfZonedDay,
  normalizeAccountTimeZone,
  resolveAccountTimeZone,
  startOfZonedDay,
  startOfZonedWeek,
} from '@/src/server/aulas/calendar/account-timezone';
import { createAulasOperationLog } from '@/src/server/aulas/calendar/operation-log.service';
import { prisma } from '@/src/prisma';

const MATERIALIZATION_PAST_DAYS = 14;
const MATERIALIZATION_FUTURE_DAYS = 90;
const materializationInFlight = new Map<string, Promise<void>>();
const DAY_CODES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
const DAY_ALIASES: Record<(typeof DAY_CODES)[number], string[]> = {
  DOM: ['DOM', 'DOMINGO'],
  SEG: ['SEG', 'SEGUNDA'],
  TER: ['TER', 'TERCA', 'TERÇA'],
  QUA: ['QUA', 'QUARTA'],
  QUI: ['QUI', 'QUINTA'],
  SEX: ['SEX', 'SEXTA'],
  SAB: ['SAB', 'SÁB', 'SABADO', 'SÁBADO'],
};

type CalendarEventListWithRelations = Prisma.CalendarEventGetPayload<{
  include: {
    turma: { select: { id: true; nome: true } };
    sala: { select: { id: true; nome: true } };
    professores: { include: { professor: { select: { id: true; nome: true } } } };
    attendanceRecords: { select: { status: true } };
    makeupClassesOrigem: { select: { id: true; status: true; scope: true; eventoDestinoId: true } };
    makeupClassesDestino: { select: { id: true; status: true; scope: true; eventoOrigemId: true } };
  };
}>;

type CalendarEventWithRelations = Prisma.CalendarEventGetPayload<{
  include: {
    turma: { select: { id: true; nome: true } };
    sala: { select: { id: true; nome: true } };
    professores: { include: { professor: { select: { id: true; nome: true } } } };
    aulaExperimental: { select: { id: true; status: true; observacao: true; aluno: { select: { id: true; nome: true } } } };
    attendanceRecords: { select: { status: true } };
    makeupClassesOrigem: { select: { id: true; status: true; scope: true; eventoDestinoId: true } };
    makeupClassesDestino: { select: { id: true; status: true; scope: true; eventoOrigemId: true } };
  };
}>;

type TurmaScheduleRecord = Prisma.TurmaGetPayload<{
  include: {
    professores: {
      include: {
        professor: {
          select: {
            id: true;
            nome: true;
          };
        };
      };
    };
  };
}>;

export type AgendaResourceCollections = {
  turmas: AulasTurmaLookupItemDTO[];
  professores: AulasLookupItemDTO[];
  salas: AulasLookupItemDTO[];
  alunos?: AulasLookupItemDTO[];
};

export type AgendaListFilters = {
  start: Date;
  end: Date;
  turmaId?: string;
  professorId?: string;
  salaId?: string;
  type?: string[];
  status?: string[];
  /** Quando definido, evita nova leitura de Conta.timezone durante a materialização */
  accountTimeZone?: string;
};

/** Preenchido por `listCalendarEventsRaw` quando passado pelo caller (somente medição). */
export type AgendaListFetchStageTimings = {
  materialization: number;
  queryEvents: number;
};

export type MaterializeCalendarSummary = {
  start: string;
  end: string;
  created: number;
  updated: number;
  cancelled: number;
  deleted: number;
  skipped: number;
};

function buildLookupItem(id: string, label: string): AulasLookupItemDTO {
  return { id, label };
}

function buildTurmaLookupItem(input: {
  id: string;
  nome: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
  salaId: string | null;
  professorIds: string[];
}): AulasTurmaLookupItemDTO {
  return {
    id: input.id,
    label: input.nome,
    defaultSchedule: {
      daysOfWeek: input.diasSemana,
      startTime: input.horaInicio,
      endTime: input.horaFim,
      salaId: input.salaId,
      professorIds: input.professorIds,
    },
  };
}

function normalizeDayCode(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  for (const [code, aliases] of Object.entries(DAY_ALIASES) as Array<
    [(typeof DAY_CODES)[number], string[]]
  >) {
    if (
      aliases.some(
        (alias) =>
          alias
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase() === normalized,
      )
    ) {
      return code;
    }
  }

  return normalized;
}

function buildSourceRuleKey(turma: { id: string; horaInicio: string; horaFim: string }) {
  return `turma:${turma.id}:${turma.horaInicio}:${turma.horaFim}`;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function uniqueConflicts(conflicts: CalendarEventConflictDTO[]) {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.type}:${conflict.relatedEventId ?? 'none'}:${conflict.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildAttendanceSummary(
  totalEligible: number,
  statuses: AttendanceStatus[],
): CalendarEventAttendanceSummaryDTO {
  return {
    totalEligible,
    recorded: statuses.length,
    presente: statuses.filter((status) => status === 'PRESENTE').length,
    falta: statuses.filter((status) => status === 'FALTA').length,
    faltaJustificada: statuses.filter((status) => status === 'FALTA_JUSTIFICADA').length,
    atraso: statuses.filter((status) => status === 'ATRASO').length,
    reposicao: statuses.filter((status) => status === 'REPOSICAO').length,
  };
}

export function normalizeAgendaRange(
  start?: string | Date,
  end?: string | Date,
  timeZone: string = DEFAULT_ACCOUNT_TIMEZONE,
) {
  const tz = normalizeAccountTimeZone(timeZone);
  const now = new Date();
  const safeStart = start ? new Date(start) : startOfZonedWeek(now, tz, 1);
  const safeEnd = end ? new Date(end) : endOfZonedDay(addDays(safeStart, 6), tz);

  return {
    start: startOfZonedDay(safeStart, tz),
    end: endOfZonedDay(safeEnd, tz),
  };
}

export async function loadAulasResources(
  contaId: string,
  prismaClient: PrismaClient = prisma,
): Promise<AgendaResourceCollections> {
  const [turmas, professores, salas] = await Promise.all([
    prismaClient.turma.findMany({
      where: { contaId, status: 'ATIVO' },
      select: {
        id: true,
        nome: true,
        diasSemana: true,
        horaInicio: true,
        horaFim: true,
        salaId: true,
        professores: {
          select: {
            professorId: true,
          },
        },
      },
      orderBy: { nome: 'asc' },
    }),
    prismaClient.professor.findMany({
      where: { contaId, status: 'ATIVO' },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
    prismaClient.sala.findMany({
      where: { contaId, status: 'ATIVO' },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
  ]);

  return {
    turmas: turmas.map((item) =>
      buildTurmaLookupItem({
        id: item.id,
        nome: item.nome,
        diasSemana: item.diasSemana,
        horaInicio: item.horaInicio,
        horaFim: item.horaFim,
        salaId: item.salaId,
        professorIds: item.professores.map((professor) => professor.professorId),
      }),
    ),
    professores: professores.map((item) => buildLookupItem(item.id, item.nome)),
    salas: salas.map((item) => buildLookupItem(item.id, item.nome)),
  };
}

export async function loadAlunoResources(
  contaId: string,
  prismaClient: PrismaClient = prisma,
): Promise<AulasLookupItemDTO[]> {
  const alunos = await prismaClient.aluno.findMany({
    where: { contaId, status: 'ATIVO' },
    select: { id: true, nome: true },
    orderBy: { nome: 'asc' },
  });

  return alunos.map((item) => buildLookupItem(item.id, item.nome));
}

export function buildEligibleMatriculaWhere(
  contaId: string,
  turmaId: string,
  eventDate: Date,
): Prisma.MatriculaWhereInput {
  return {
    status: { in: ['ATIVA', 'PAUSADA'] },
    aluno: { contaId, status: 'ATIVO' },
    AND: [
      {
        OR: [{ turmaId }, { matriculaTurmas: { some: { turmaId } } }],
      },
      { dataInicio: { lte: eventDate } },
      {
        OR: [{ dataFim: null }, { dataFim: { gte: eventDate } }],
      },
      {
        OR: [
          { pausaAtiva: false },
          {
            pausaAtiva: true,
            OR: [
              { dataInicioPausa: null },
              { dataInicioPausa: { gt: eventDate } },
              { dataRetornoPrevista: { not: null, lte: eventDate } },
            ],
          },
        ],
      },
    ],
  };
}

export async function countEligibleStudentsForEvent(
  event: { id: string; contaId: string; turmaId: string | null; startAt: Date },
  prismaClient: PrismaClient | Prisma.TransactionClient = prisma,
) {
  const [matriculas, makeupStudents] = await Promise.all([
    event.turmaId
      ? prismaClient.matricula.findMany({
          where: buildEligibleMatriculaWhere(event.contaId, event.turmaId, event.startAt),
          select: { alunoId: true },
        })
      : Promise.resolve([]),
    prismaClient.makeupClass.findMany({
      where: {
        contaId: event.contaId,
        eventoDestinoId: event.id,
        status: { not: 'CANCELADA' },
        alunoId: { not: null },
      },
      select: { alunoId: true },
    }),
  ]);

  const uniqueAlunoIds = new Set<string>();
  matriculas.forEach((item) => uniqueAlunoIds.add(item.alunoId));
  makeupStudents.forEach((item) => {
    if (item.alunoId) uniqueAlunoIds.add(item.alunoId);
  });

  return uniqueAlunoIds.size;
}

export async function materializeCalendarWindow(params: {
  contaId: string;
  start: Date;
  end: Date;
  timeZone: string;
  logOperation?: boolean;
  logReason?: string;
  prismaClient?: PrismaClient;
}) {
  const prismaClient = params.prismaClient ?? prisma;
  const tz = normalizeAccountTimeZone(params.timeZone);
  const materializeStart = startOfZonedDay(addDays(params.start, -MATERIALIZATION_PAST_DAYS), tz);
  const materializeEnd = endOfZonedDay(addDays(params.end, MATERIALIZATION_FUTURE_DAYS), tz);
  const summary: MaterializeCalendarSummary = {
    start: materializeStart.toISOString(),
    end: materializeEnd.toISOString(),
    created: 0,
    updated: 0,
    cancelled: 0,
    deleted: 0,
    skipped: 0,
  };

  const turmas = await prismaClient.turma.findMany({
    where: {
      contaId: params.contaId,
      status: 'ATIVO',
    },
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
    },
    orderBy: { nome: 'asc' },
  });

  if (!turmas.length) {
    if (params.logOperation) {
      await createAulasOperationLog({
        contaId: params.contaId,
        action: 'CALENDAR_REBUILD',
        message: 'Sincronização concluída sem turmas ativas para materialização.',
        details: {
          reason: params.logReason ?? null,
          summary,
          timeZone: tz,
        },
        prismaClient,
      });
    }

    return summary;
  }

  const occurrenceMap = new Map<
    string,
    {
      turma: TurmaScheduleRecord;
      startAt: Date;
      endAt: Date;
      sourceRuleKey: string;
    }
  >();

  for (const turma of turmas) {
    const sourceRuleKey = buildSourceRuleKey(turma);
    const turmaDayCodes = new Set(turma.diasSemana.map(normalizeDayCode));
    const days = eachZonedCalendarDayInRange(materializeStart, materializeEnd, tz);

    for (const day of days) {
      if (!turmaDayCodes.has(DAY_CODES[day.jsDay])) continue;

      const startAt = combineWallClockOnZonedCalendarDay(
        day.year,
        day.monthIndex,
        day.day,
        turma.horaInicio,
        tz,
      );
      const endAt = combineWallClockOnZonedCalendarDay(day.year, day.monthIndex, day.day, turma.horaFim, tz);
      const key = `${sourceRuleKey}:${startAt.toISOString()}`;

      occurrenceMap.set(key, {
        turma,
        startAt,
        endAt,
        sourceRuleKey,
      });
    }
  }

  if (!occurrenceMap.size) {
    if (params.logOperation) {
      await createAulasOperationLog({
        contaId: params.contaId,
        action: 'CALENDAR_REBUILD',
        message: 'Sincronização concluída sem ocorrências recorrentes na janela selecionada.',
        details: {
          reason: params.logReason ?? null,
          summary,
          timeZone: tz,
        },
        prismaClient,
      });
    }

    return summary;
  }

  const sourceRuleKeys = Array.from(
    new Set(Array.from(occurrenceMap.values()).map((item) => item.sourceRuleKey)),
  );

  const existingEvents = await prismaClient.calendarEvent.findMany({
    where: {
      contaId: params.contaId,
      source: 'TURMA_RECORRENTE',
      sourceRuleKey: { in: sourceRuleKeys },
      startAt: { gte: materializeStart, lte: materializeEnd },
    },
    include: {
      _count: {
        select: {
          attendanceRecords: true,
          makeupClassesOrigem: true,
          makeupClassesDestino: true,
        },
      },
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
  });

  const existingMap = new Map<string, (typeof existingEvents)[number]>(
    existingEvents.map((event) => [
      `${event.sourceRuleKey ?? 'null'}:${event.startAt.toISOString()}`,
      event,
    ]),
  );

  for (const [key, occurrence] of occurrenceMap) {
    const existing = existingMap.get(key);
    const professorIds = occurrence.turma.professores.map((item) => item.professorId);

    if (!existing) {
      try {
        await prismaClient.calendarEvent.create({
          data: {
            contaId: params.contaId,
            tipo: 'AULA',
            status: 'AGENDADO',
            source: 'TURMA_RECORRENTE',
            sourceRuleKey: occurrence.sourceRuleKey,
            titulo: occurrence.turma.nome,
            descricao: occurrence.turma.observacao ?? null,
            startAt: occurrence.startAt,
            endAt: occurrence.endAt,
            turmaId: occurrence.turma.id,
            salaId: occurrence.turma.salaId,
            professores: professorIds.length
              ? {
                  create: professorIds.map((professorId) => ({
                    conta: {
                      connect: { id: params.contaId },
                    },
                    professor: {
                      connect: { id: professorId },
                    },
                  })),
                }
              : undefined,
          },
        });
        summary.created += 1;
      } catch (error) {
        const isConcurrentDuplicate =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

        if (!isConcurrentDuplicate) {
          throw error;
        }

        summary.skipped += 1;
      }
      continue;
    }

    if (existing.manuallyAdjusted) {
      summary.skipped += 1;
      continue;
    }

    const hasOperationalLinks =
      existing._count.attendanceRecords > 0 ||
      existing._count.makeupClassesOrigem > 0 ||
      existing._count.makeupClassesDestino > 0;

    // Preserve historical/operational occurrences to avoid reopening finalized events.
    if (existing.status !== 'AGENDADO' || existing.cancelledAt !== null || hasOperationalLinks) {
      summary.skipped += 1;
      continue;
    }

    const currentProfessorIds = existing.professores
      .map((item) => item.professorId)
      .sort((first, second) => first.localeCompare(second));
    const nextProfessorIds = [...professorIds].sort((first, second) => first.localeCompare(second));
    const unchanged =
      existing.tipo === 'AULA' &&
      existing.status === 'AGENDADO' &&
      existing.titulo === occurrence.turma.nome &&
      (existing.descricao ?? null) === (occurrence.turma.observacao ?? null) &&
      existing.startAt.getTime() === occurrence.startAt.getTime() &&
      existing.endAt.getTime() === occurrence.endAt.getTime() &&
      existing.turmaId === occurrence.turma.id &&
      existing.salaId === occurrence.turma.salaId &&
      existing.cancelledAt === null &&
      JSON.stringify(currentProfessorIds) === JSON.stringify(nextProfessorIds);

    if (unchanged) {
      summary.skipped += 1;
      continue;
    }

    await prismaClient.calendarEvent.update({
      where: { id: existing.id },
      data: {
        tipo: 'AULA',
        status: 'AGENDADO',
        titulo: occurrence.turma.nome,
        descricao: occurrence.turma.observacao ?? null,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        turmaId: occurrence.turma.id,
        salaId: occurrence.turma.salaId,
        cancelledAt: null,
        professores: {
          deleteMany: {},
          create: professorIds.map((professorId) => ({
            conta: {
              connect: { id: params.contaId },
            },
            professor: {
              connect: { id: professorId },
            },
          })),
        },
      },
    });
    summary.updated += 1;
  }

  for (const existing of existingEvents) {
    const existingKey = `${existing.sourceRuleKey}:${existing.startAt.toISOString()}`;
    if (occurrenceMap.has(existingKey) || existing.manuallyAdjusted || existing.status === 'REALIZADO') {
      if (existing.manuallyAdjusted || existing.status === 'REALIZADO') {
        summary.skipped += 1;
      }
      continue;
    }

    const hasOperationalLinks =
      existing._count.attendanceRecords > 0 ||
      existing._count.makeupClassesOrigem > 0 ||
      existing._count.makeupClassesDestino > 0;

    if (hasOperationalLinks) {
      if (existing.status !== 'CANCELADO') {
        await prismaClient.calendarEvent.update({
          where: { id: existing.id },
          data: {
            status: 'CANCELADO',
            cancelledAt: existing.cancelledAt ?? new Date(),
          },
        });
        summary.cancelled += 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    await prismaClient.calendarEvent.delete({
      where: { id: existing.id },
    });
    summary.deleted += 1;
  }

  if (params.logOperation) {
    await createAulasOperationLog({
      contaId: params.contaId,
      action: 'CALENDAR_REBUILD',
      message: 'Sincronização da agenda concluída.',
      details: {
        reason: params.logReason ?? null,
        summary,
        timeZone: tz,
      },
      prismaClient,
    });
  }

  return summary;
}

export async function assertNoCalendarConflicts(params: {
  contaId: string;
  startAt: Date;
  endAt: Date;
  salaId?: string | null;
  professorIds?: string[];
  turmaId?: string | null;
  allowOwnTurmaRecurringOverlap?: boolean;
  ignoreEventId?: string;
  prismaClient?: PrismaClient;
}) {
  const prismaClient = params.prismaClient ?? prisma;
  const conflicts: string[] = [];

  const isIgnorableOwnTurmaRecurringConflict = (event: {
    turmaId: string | null;
    source: string | null;
    tipo: string;
  }) => {
    if (!params.allowOwnTurmaRecurringOverlap || !params.turmaId) {
      return false;
    }

    return (
      event.turmaId === params.turmaId &&
      event.source === 'TURMA_RECORRENTE' &&
      event.tipo === 'AULA'
    );
  };

  if (params.salaId) {
    const roomConflicts = await prismaClient.calendarEvent.findMany({
      where: {
        contaId: params.contaId,
        id: params.ignoreEventId ? { not: params.ignoreEventId } : undefined,
        status: { not: 'CANCELADO' },
        salaId: params.salaId,
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
      },
      select: { id: true, titulo: true, turmaId: true, source: true, tipo: true },
    });

    const roomConflict = roomConflicts.find((event) => !isIgnorableOwnTurmaRecurringConflict(event));

    if (roomConflict) {
      conflicts.push(`A sala já está ocupada por "${roomConflict.titulo}".`);
    }
  }

  if (params.professorIds?.length) {
    const professorConflicts = await prismaClient.calendarEvent.findMany({
      where: {
        contaId: params.contaId,
        id: params.ignoreEventId ? { not: params.ignoreEventId } : undefined,
        status: { not: 'CANCELADO' },
        startAt: { lt: params.endAt },
        endAt: { gt: params.startAt },
        professores: {
          some: {
            professorId: { in: params.professorIds },
          },
        },
      },
      select: { id: true, titulo: true, turmaId: true, source: true, tipo: true },
    });

    const professorConflict = professorConflicts.find(
      (event) => !isIgnorableOwnTurmaRecurringConflict(event),
    );

    if (professorConflict) {
      conflicts.push(`Há conflito de professor com "${professorConflict.titulo}".`);
    }
  }

  if (conflicts.length) {
    await createAulasOperationLog({
      contaId: params.contaId,
      level: 'WARNING',
      action: 'CALENDAR_CONFLICT',
      entityType: 'CALENDAR_EVENT',
      entityId: params.ignoreEventId ?? null,
      message: conflicts.join(' '),
      details: {
        startAt: params.startAt.toISOString(),
        endAt: params.endAt.toISOString(),
        salaId: params.salaId ?? null,
        professorIds: params.professorIds ?? [],
      },
      prismaClient,
    });
    throw new AulasError('CONFLITO_SALA_PROFESSOR', conflicts.join(' '), {
      startAt: params.startAt.toISOString(),
      endAt: params.endAt.toISOString(),
      salaId: params.salaId ?? null,
      professorIds: params.professorIds ?? [],
    });
  }
}

export async function listCalendarEventsRaw(
  filters: AgendaListFilters & {
    contaId: string;
    prismaClient?: PrismaClient;
    fetchStageTimings?: AgendaListFetchStageTimings;
  },
) {
  const prismaClient = filters.prismaClient ?? prisma;
  const timeZone =
    filters.accountTimeZone !== undefined
      ? normalizeAccountTimeZone(filters.accountTimeZone)
      : await resolveAccountTimeZone(filters.contaId, prismaClient);

  const materializationKey = [filters.contaId, filters.start.toISOString(), filters.end.toISOString(), timeZone].join(
    ':',
  );

  const timingMatMark = filters.fetchStageTimings ? performance.now() : undefined;
  const inFlightMaterialization = materializationInFlight.get(materializationKey);

  if (inFlightMaterialization) {
    await inFlightMaterialization;
  } else {
    const materializationRequest = materializeCalendarWindow({
      contaId: filters.contaId,
      start: filters.start,
      end: filters.end,
      timeZone,
      prismaClient,
    }).then(() => undefined);

    materializationInFlight.set(materializationKey, materializationRequest);

    try {
      await materializationRequest;
    } finally {
      materializationInFlight.delete(materializationKey);
    }
  }

  if (filters.fetchStageTimings && timingMatMark !== undefined) {
    filters.fetchStageTimings.materialization += performance.now() - timingMatMark;
  }

  const timingQueryMark = filters.fetchStageTimings ? performance.now() : undefined;
  const events = await prismaClient.calendarEvent.findMany({
    where: {
      contaId: filters.contaId,
      startAt: { lt: filters.end },
      endAt: { gt: filters.start },
      turmaId: filters.turmaId ?? undefined,
      salaId: filters.salaId ?? undefined,
      tipo: filters.type?.length ? { in: filters.type as never[] } : undefined,
      status: filters.status?.length ? { in: filters.status as never[] } : undefined,
      professores: filters.professorId
        ? {
            some: {
              professorId: filters.professorId,
            },
          }
        : undefined,
    },
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
      attendanceRecords: { select: { status: true } },
      makeupClassesOrigem: {
        select: {
          id: true,
          status: true,
          scope: true,
          eventoDestinoId: true,
        },
      },
      makeupClassesDestino: {
        select: {
          id: true,
          status: true,
          scope: true,
          eventoOrigemId: true,
        },
      },
    },
    orderBy: [{ startAt: 'asc' }, { titulo: 'asc' }],
  });

  if (filters.fetchStageTimings && timingQueryMark !== undefined) {
    filters.fetchStageTimings.queryEvents += performance.now() - timingQueryMark;
  }

  return events;
}

export function buildConflictMap(events: CalendarEventListWithRelations[]) {
  const map = new Map<string, CalendarEventConflictDTO[]>();

  for (const event of events) {
    map.set(event.id, []);
  }

  for (let index = 0; index < events.length; index += 1) {
    for (let cursor = index + 1; cursor < events.length; cursor += 1) {
      const current = events[index];
      const next = events[cursor];

      if (!overlaps(current.startAt, current.endAt, next.startAt, next.endAt)) continue;

      if (current.salaId && next.salaId && current.salaId === next.salaId) {
        map.get(current.id)?.push({
          type: 'SALA',
          message: `Conflito de sala com "${next.titulo}".`,
          relatedEventId: next.id,
        });
        map.get(next.id)?.push({
          type: 'SALA',
          message: `Conflito de sala com "${current.titulo}".`,
          relatedEventId: current.id,
        });
      }

      const currentProfessorIds = new Set(current.professores.map((item) => item.professorId));
      const sharedProfessor = next.professores.find((item) => currentProfessorIds.has(item.professorId));

      if (sharedProfessor) {
        map.get(current.id)?.push({
          type: 'PROFESSOR',
          message: `Conflito de professor com "${next.titulo}".`,
          relatedEventId: next.id,
        });
        map.get(next.id)?.push({
          type: 'PROFESSOR',
          message: `Conflito de professor com "${current.titulo}".`,
          relatedEventId: current.id,
        });
      }
    }
  }

  for (const [eventId, conflicts] of map) {
    map.set(eventId, uniqueConflicts(conflicts));
  }

  return map;
}

export async function mapCalendarEventListItem(
  event: CalendarEventListWithRelations,
  prismaClient: PrismaClient = prisma,
  conflicts: CalendarEventConflictDTO[] = [],
  options?: { compactList?: boolean },
): Promise<CalendarEventListItemDTO> {
  const compact = options?.compactList === true;

  const attendanceSummary = compact
    ? null
    : buildAttendanceSummary(
        await countEligibleStudentsForEvent(
          { id: event.id, contaId: event.contaId, turmaId: event.turmaId, startAt: event.startAt },
          prismaClient,
        ),
        event.attendanceRecords.map((item) => item.status),
      );

  return {
    id: event.id,
    type: event.tipo,
    status: event.status,
    title: event.titulo,
    description: compact ? null : event.descricao ?? null,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    source: event.source ?? null,
    manuallyAdjusted: event.manuallyAdjusted,
    turma: event.turma ? buildLookupItem(event.turma.id, event.turma.nome) : null,
    sala: event.sala ? buildLookupItem(event.sala.id, event.sala.nome) : null,
    professores: event.professores.map((item) => ({
      id: item.professor.id,
      nome: item.professor.nome,
    })),
    attendanceSummary,
    conflicts,
  };
}

export async function mapCalendarEventDetails(
  event: CalendarEventWithRelations,
  prismaClient: PrismaClient = prisma,
  conflicts: CalendarEventConflictDTO[] = [],
): Promise<CalendarEventDetailsDTO> {
  const base = await mapCalendarEventListItem(event, prismaClient, conflicts);

  return {
    ...base,
    experimental: event.aulaExperimental
      ? {
          id: event.aulaExperimental.id,
          status: event.aulaExperimental.status,
          observacao: event.aulaExperimental.observacao ?? null,
          aluno: buildLookupItem(event.aulaExperimental.aluno.id, event.aulaExperimental.aluno.nome),
        }
      : null,
    makeupsAsOrigin: event.makeupClassesOrigem.map((item) => ({
      id: item.id,
      status: item.status,
      scope: item.scope,
      destinationEventId: item.eventoDestinoId,
    })),
    makeupsAsDestination: event.makeupClassesDestino.map((item) => ({
      id: item.id,
      status: item.status,
      scope: item.scope,
      originEventId: item.eventoOrigemId,
    })),
  };
}

export async function getCalendarEventOrThrow(
  eventId: string,
  contaId: string,
  prismaClient: PrismaClient = prisma,
) {
  const event = await prismaClient.calendarEvent.findFirst({
    where: {
      id: eventId,
      contaId,
    },
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
      aulaExperimental: {
        select: {
          id: true,
          status: true,
          observacao: true,
          aluno: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      },
      attendanceRecords: { select: { status: true } },
      makeupClassesOrigem: {
        select: {
          id: true,
          status: true,
          scope: true,
          eventoDestinoId: true,
        },
      },
      makeupClassesDestino: {
        select: {
          id: true,
          status: true,
          scope: true,
          eventoOrigemId: true,
        },
      },
    },
  });

  if (!event) {
    throw new AulasError('EVENTO_NAO_ENCONTRADO', 'Evento não encontrado.');
  }

  return event;
}

export async function buildAgendaListPayload(
  filters: AgendaListFilters & {
    contaId: string;
    timeZone: string;
    prismaClient?: PrismaClient;
    includeResources?: boolean;
    /** Somente medição `Server-Timing` – preenchido quando fornecido. */
    timingsSink?: Record<string, number>;
  },
) {
  const prismaClient = filters.prismaClient ?? prisma;
  const timeZone = normalizeAccountTimeZone(filters.timeZone);

  const fetchStages: AgendaListFetchStageTimings = {
    materialization: 0,
    queryEvents: 0,
  };

  const events = await listCalendarEventsRaw({
    contaId: filters.contaId,
    start: filters.start,
    end: filters.end,
    turmaId: filters.turmaId,
    professorId: filters.professorId,
    salaId: filters.salaId,
    type: filters.type,
    status: filters.status,
    accountTimeZone: timeZone,
    prismaClient,
    fetchStageTimings: filters.timingsSink ? fetchStages : undefined,
  });

  if (filters.timingsSink) {
    filters.timingsSink.materialization = fetchStages.materialization;
    filters.timingsSink.queryEvents = fetchStages.queryEvents;
  }

  const tConflicts = filters.timingsSink ? performance.now() : undefined;
  const conflictMap = buildConflictMap(events);
  if (filters.timingsSink && tConflicts !== undefined) {
    filters.timingsSink.conflicts = performance.now() - tConflicts;
  }

  const tMapper = filters.timingsSink ? performance.now() : undefined;
  const mappedEvents = await Promise.all(
    events.map((event) =>
      mapCalendarEventListItem(event, prismaClient, conflictMap.get(event.id) ?? [], { compactList: true }),
    ),
  );
  if (filters.timingsSink && tMapper !== undefined) {
    filters.timingsSink.mapper = performance.now() - tMapper;
  }

  const resources =
    filters.includeResources === false
      ? undefined
      : await (async () => {
          const tr = filters.timingsSink ? performance.now() : undefined;
          const payload = await loadAulasResources(filters.contaId, prismaClient);

          if (filters.timingsSink && tr !== undefined) {
            filters.timingsSink.resources = performance.now() - tr;
          }

          return payload;
        })();

  return {
    range: {
      start: filters.start.toISOString(),
      end: filters.end.toISOString(),
    },
    timeZone,
    ...(resources ? { resources } : {}),
    events: mappedEvents,
  };
}

export async function buildAgendaDashboardPayload(
  contaId: string,
  prismaClient: PrismaClient = prisma,
): Promise<{ items: AulasDashboardItemDTO[] }> {
  const timeZone = await resolveAccountTimeZone(contaId, prismaClient);
  const start = startOfZonedDay(new Date(), timeZone);
  const end = endOfZonedDay(new Date(), timeZone);

  const events = await listCalendarEventsRaw({
    contaId,
    start,
    end,
    accountTimeZone: timeZone,
    prismaClient,
  });

  const items = events.slice(0, 5).map((event) => ({
    id: event.id,
    title: event.titulo,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    turma: event.turma ? buildLookupItem(event.turma.id, event.turma.nome) : null,
    sala: event.sala ? buildLookupItem(event.sala.id, event.sala.nome) : null,
  }));

  return { items };
}
