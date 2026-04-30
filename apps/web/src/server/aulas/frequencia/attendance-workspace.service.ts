import { endOfDay, startOfDay } from 'date-fns';

import type {
  AttendanceTurmaWorkspaceResultDTO,
  AttendanceWorkspaceLaunchStateDTO,
  AttendanceWorkspaceOccurrenceDTO,
  AttendanceWorkspaceResultDTO,
  AulasLookupItemDTO,
  CalendarEventListItemDTO,
  ListAttendanceWorkspaceQueryDTO,
} from '@/features/aulas/dtos';
import { isAttendanceEventOnSelectedDay } from '@/features/aulas/utils/attendance-launch';
import { autoCloseAgendaEventsInRange } from '@/src/server/aulas/agenda/agenda-event-auto-close.service';
import { AulasError } from '@/src/server/aulas/aulas-error';
import { listCalendarEventsRaw, mapCalendarEventListItem } from '@/src/server/aulas/calendar/calendar-core.service';
import type { AulasAccessScope } from '@/src/server/aulas/session';
import { prisma } from '@/src/prisma';

function buildLookupItem(id: string, label: string): AulasLookupItemDTO {
  return { id, label };
}

function resolveSelectedDate(date?: string) {
  return startOfDay(date ? new Date(date) : new Date());
}

function getAttendanceLaunchState(event: Pick<CalendarEventListItemDTO, 'status' | 'startAt' | 'endAt'>): AttendanceWorkspaceLaunchStateDTO {
  const now = new Date();
  const startAt = new Date(event.startAt);
  const endAt = new Date(event.endAt);

  if (event.status === 'CANCELADO') return 'CANCELADA';
  if (event.status === 'REALIZADO') return 'REALIZADA';
  if (startAt.getTime() > now.getTime()) {
    return isAttendanceEventOnSelectedDay({ startAt: event.startAt, referenceDate: now })
      ? 'PENDENTE'
      : 'FUTURA';
  }
  if (startAt.getTime() <= now.getTime() && endAt.getTime() >= now.getTime()) return 'EM_ANDAMENTO';

  return 'PENDENTE';
}

function getLaunchStatePriority(state: AttendanceWorkspaceLaunchStateDTO) {
  switch (state) {
    case 'EM_ANDAMENTO':
      return 0;
    case 'PENDENTE':
      return 1;
    case 'FUTURA':
      return 2;
    case 'REALIZADA':
      return 3;
    case 'CANCELADA':
      return 4;
    default:
      return 5;
  }
}

function mapWorkspaceOccurrence(event: CalendarEventListItemDTO): AttendanceWorkspaceOccurrenceDTO {
  return {
    eventId: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    status: event.status,
    launchState: getAttendanceLaunchState(event),
    sala: event.sala,
    professores: event.professores,
    attendanceSummary: event.attendanceSummary ?? {
      totalEligible: 0,
      recorded: 0,
      presente: 0,
      falta: 0,
      faltaJustificada: 0,
      atraso: 0,
      reposicao: 0,
    },
  };
}

async function loadAttendanceWorkspaceData(
  scope: AulasAccessScope,
  query: ListAttendanceWorkspaceQueryDTO,
) {
  const selectedDate = resolveSelectedDate(query.date);
  const rangeStart = startOfDay(selectedDate);
  const rangeEnd = endOfDay(selectedDate);

  const professorScope = {
    active: scope.isProfessor,
    professorId: scope.professorId,
    label: scope.professorLabel,
    reason: null as 'PROFESSOR_NOT_LINKED' | null,
    message: null as string | null,
  };

  if (professorScope.active && !professorScope.professorId) {
    professorScope.reason = 'PROFESSOR_NOT_LINKED';
    professorScope.message =
      'Seu usuário não está vinculado a um professor ativo. Revise o cadastro antes de lançar frequência.';

    return {
      selectedDate,
      professorScope,
      turmas: [],
      occurrencesByTurmaId: new Map<string, AttendanceWorkspaceOccurrenceDTO[]>(),
    };
  }

  await autoCloseAgendaEventsInRange({
    contaId: scope.contaId,
    start: rangeStart,
    end: rangeEnd,
    prismaClient: prisma,
  });

  const turmas = await prisma.turma.findMany({
    where: {
      contaId: scope.contaId,
      status: 'ATIVO',
      nome: query.search
        ? {
            contains: query.search,
            mode: 'insensitive',
          }
        : undefined,
      professores: professorScope.professorId
        ? {
            some: {
              professorId: professorScope.professorId,
            },
          }
        : undefined,
    },
    include: {
      sala: {
        select: {
          id: true,
          nome: true,
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
    orderBy: {
      nome: 'asc',
    },
  });

  const turmaIds = turmas.map((turma) => turma.id);
  const rawEvents = turmaIds.length
    ? await listCalendarEventsRaw({
        contaId: scope.contaId,
        start: rangeStart,
        end: rangeEnd,
        professorId: professorScope.professorId ?? undefined,
        type: ['AULA', 'REPOSICAO'],
        prismaClient: prisma,
      })
    : [];
  const mappedEvents = await Promise.all(rawEvents.map((event) => mapCalendarEventListItem(event, prisma)));
  const occurrencesByTurmaId = new Map<string, AttendanceWorkspaceOccurrenceDTO[]>();

  for (const event of mappedEvents) {
    if (!event.turma?.id || !turmaIds.includes(event.turma.id)) continue;

    const occurrence = mapWorkspaceOccurrence(event);
    const current = occurrencesByTurmaId.get(event.turma.id) ?? [];
    current.push(occurrence);
    occurrencesByTurmaId.set(event.turma.id, current);
  }

  for (const [turmaId, occurrences] of occurrencesByTurmaId) {
    occurrences.sort((first, second) => {
      const byState =
        getLaunchStatePriority(first.launchState) - getLaunchStatePriority(second.launchState);

      if (byState !== 0) return byState;

      return new Date(first.startAt).getTime() - new Date(second.startAt).getTime();
    });
    occurrencesByTurmaId.set(turmaId, occurrences);
  }

  return {
    selectedDate,
    professorScope,
    turmas,
    occurrencesByTurmaId,
  };
}

export async function listAttendanceWorkspace(
  scope: AulasAccessScope,
  query: ListAttendanceWorkspaceQueryDTO,
): Promise<AttendanceWorkspaceResultDTO> {
  const { selectedDate, professorScope, turmas, occurrencesByTurmaId } =
    await loadAttendanceWorkspaceData(scope, query);

  const items = turmas
    .map((turma) => {
      const occurrences = occurrencesByTurmaId.get(turma.id) ?? [];
      const selectedOccurrence = occurrences[0] ?? null;

      return {
        turma: buildLookupItem(turma.id, turma.nome),
        sala: turma.sala ? buildLookupItem(turma.sala.id, turma.sala.nome) : null,
        professores: turma.professores.map((item) =>
          buildLookupItem(item.professor.id, item.professor.nome),
        ),
        launchState: selectedOccurrence?.launchState ?? 'SEM_AULA',
        occurrenceCount: occurrences.length,
        selectedOccurrence,
      };
    })
    .filter((item) => (professorScope.active ? item.occurrenceCount > 0 : true))
    .sort((first, second) => {
      const byState =
        getLaunchStatePriority(first.launchState) - getLaunchStatePriority(second.launchState);

      if (byState !== 0) return byState;

      return first.turma.label.localeCompare(second.turma.label, 'pt-BR');
    });

  return {
    success: true,
    data: {
      selectedDate: selectedDate.toISOString(),
      professorScope,
      summary: {
        totalTurmas: items.length,
        comAula: items.filter((item) => item.occurrenceCount > 0).length,
        pendentes: items.filter((item) => item.launchState === 'PENDENTE').length,
        emAndamento: items.filter((item) => item.launchState === 'EM_ANDAMENTO').length,
        realizadas: items.filter((item) => item.launchState === 'REALIZADA').length,
        semAula: items.filter((item) => item.launchState === 'SEM_AULA').length,
      },
      items,
    },
  };
}

export async function getAttendanceTurmaWorkspace(
  scope: AulasAccessScope,
  turmaId: string,
  query: ListAttendanceWorkspaceQueryDTO,
): Promise<AttendanceTurmaWorkspaceResultDTO> {
  const { selectedDate, turmas, occurrencesByTurmaId } = await loadAttendanceWorkspaceData(scope, query);
  const turma = turmas.find((item) => item.id === turmaId);

  if (!turma) {
    throw new AulasError('TURMA_NAO_ENCONTRADA', 'Turma não encontrada para esta operação.');
  }

  const occurrences = occurrencesByTurmaId.get(turmaId) ?? [];

  return {
    success: true,
    data: {
      selectedDate: selectedDate.toISOString(),
      turma: buildLookupItem(turma.id, turma.nome),
      sala: turma.sala ? buildLookupItem(turma.sala.id, turma.sala.nome) : null,
      professores: turma.professores.map((item) =>
        buildLookupItem(item.professor.id, item.professor.nome),
      ),
      occurrences,
      selectedOccurrenceId: occurrences[0]?.eventId ?? null,
    },
  };
}
