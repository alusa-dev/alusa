import { endOfDay, startOfDay } from 'date-fns';

import type {
  CalendarEventDetailsResultDTO,
  CreateCalendarEventInputDTO,
  ListCalendarEventsQueryDTO,
  ListAgendaOperationLogsResultDTO,
  RebuildAgendaWindowInputDTO,
  RebuildAgendaWindowResultDTO,
  UpdateCalendarEventInputDTO,
} from '@/features/aulas/dtos';
import {
  buildAgendaListPayload,
  buildConflictMap,
  assertNoCalendarConflicts,
  getCalendarEventOrThrow,
  listCalendarEventsRaw,
  loadAulasResources,
  mapCalendarEventDetails,
  materializeCalendarWindow,
  normalizeAgendaRange,
} from '@/src/server/aulas/calendar/calendar-core.service';
import {
  autoCloseAgendaEventIfDue,
  autoCloseAgendaEventsInRange,
} from '@/src/server/aulas/agenda/agenda-event-auto-close.service';
import { createAulasOperationLog, listAulasOperationLogs } from '@/src/server/aulas/calendar/operation-log.service';
import { prisma } from '@/src/prisma';

async function resolveTurmaDefaults(contaId: string, turmaId?: string | null) {
  if (!turmaId) {
    return null;
  }

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

async function buildEventDetailsResult(
  eventId: string,
  contaId: string,
): Promise<CalendarEventDetailsResultDTO> {
  await autoCloseAgendaEventIfDue({
    contaId,
    eventId,
    prismaClient: prisma,
  });

  const event = await getCalendarEventOrThrow(eventId, contaId, prisma);
  const nearbyEvents = await listCalendarEventsRaw({
    contaId,
    start: startOfDay(event.startAt),
    end: endOfDay(event.endAt),
    prismaClient: prisma,
  });
  const conflictMap = buildConflictMap(nearbyEvents);

  return {
    success: true,
    data: await mapCalendarEventDetails(event, prisma, conflictMap.get(event.id) ?? []),
  };
}

async function syncLinkedMakeupStatusesForEvent(
  contaId: string,
  eventId: string,
  status: 'AGENDADO' | 'CANCELADO' | 'REALIZADO',
) {
  if (status === 'AGENDADO') return;

  await prisma.makeupClass.updateMany({
    where: {
      contaId,
      eventoDestinoId: eventId,
      status: status === 'REALIZADO' ? 'AGENDADA' : { not: 'CANCELADA' },
    },
    data: {
      status: status === 'REALIZADO' ? 'REALIZADA' : 'CANCELADA',
    },
  });
}

export async function listAgendaEvents(contaId: string, query: ListCalendarEventsQueryDTO) {
  const range = normalizeAgendaRange(query.start, query.end);
  await autoCloseAgendaEventsInRange({
    contaId,
    start: range.start,
    end: range.end,
    prismaClient: prisma,
  });

  return {
    success: true as const,
    data: await buildAgendaListPayload({
      contaId,
      start: range.start,
      end: range.end,
      turmaId: query.turmaId,
      professorId: query.professorId,
      salaId: query.salaId,
      type: query.type,
      status: query.status,
      prismaClient: prisma,
    }),
  };
}

export async function getAgendaEventDetails(contaId: string, eventId: string) {
  return buildEventDetailsResult(eventId, contaId);
}

export async function createAgendaEvent(contaId: string, input: CreateCalendarEventInputDTO) {
  const turmaDefaults = await resolveTurmaDefaults(contaId, input.turmaId);
  const professorIds = input.professorIds.length
    ? input.professorIds
    : (turmaDefaults?.professores.map((item) => item.professorId) ?? []);
  const salaId = input.salaId ?? turmaDefaults?.salaId ?? null;

  await assertNoCalendarConflicts({
    contaId,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    salaId,
    professorIds,
    prismaClient: prisma,
  });

  const created = await prisma.calendarEvent.create({
    data: {
      contaId,
      tipo: input.type,
      status: 'AGENDADO',
      source: 'MANUAL',
      manuallyAdjusted: true,
      titulo: input.title,
      descricao: input.description ?? null,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      turmaId: input.turmaId ?? null,
      salaId,
      professores: professorIds.length
        ? {
            create: professorIds.map((professorId) => ({
              professor: {
                connect: { id: professorId },
              },
            })),
          }
        : undefined,
    },
    select: { id: true },
  });

  await createAulasOperationLog({
    contaId,
    action: 'EVENT_CREATED',
    entityType: 'CALENDAR_EVENT',
    entityId: created.id,
    message: `Evento "${input.title}" criado manualmente.`,
    details: {
      type: input.type,
      startAt: input.startAt,
      endAt: input.endAt,
      turmaId: input.turmaId ?? null,
      salaId,
      professorIds,
    },
    prismaClient: prisma,
  });

  return buildEventDetailsResult(created.id, contaId);
}

export async function updateAgendaEvent(
  contaId: string,
  eventId: string,
  input: UpdateCalendarEventInputDTO,
) {
  const current = await getCalendarEventOrThrow(eventId, contaId, prisma);
  const turmaDefaults = await resolveTurmaDefaults(contaId, input.turmaId ?? current.turmaId);
  const professorIds =
    input.professorIds ??
    (current.professores.length
      ? current.professores.map((item) => item.professor.id)
      : (turmaDefaults?.professores.map((item) => item.professorId) ?? []));
  const startAt = input.startAt ? new Date(input.startAt) : current.startAt;
  const endAt = input.endAt ? new Date(input.endAt) : current.endAt;
  const salaId = input.salaId !== undefined ? input.salaId : (current.salaId ?? turmaDefaults?.salaId ?? null);
  const nextStatus = input.status ?? current.status;

  await assertNoCalendarConflicts({
    contaId,
    startAt,
    endAt,
    salaId,
    professorIds,
    ignoreEventId: eventId,
    prismaClient: prisma,
  });

  await prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      tipo: input.type ?? current.tipo,
      status: nextStatus,
      titulo: input.title ?? current.titulo,
      descricao: input.description !== undefined ? input.description ?? null : current.descricao,
      startAt,
      endAt,
      turmaId: input.turmaId !== undefined ? input.turmaId ?? null : current.turmaId,
      salaId,
      manuallyAdjusted: true,
      cancelledAt: nextStatus === 'CANCELADO' ? current.cancelledAt ?? new Date() : null,
      professores: {
        deleteMany: {},
        create: professorIds.map((professorId) => ({
          professor: {
            connect: { id: professorId },
          },
        })),
      },
    },
  });

  await syncLinkedMakeupStatusesForEvent(contaId, eventId, nextStatus);
  await createAulasOperationLog({
    contaId,
    action: 'EVENT_UPDATED',
    entityType: 'CALENDAR_EVENT',
    entityId: eventId,
    message:
      nextStatus === 'REALIZADO'
        ? 'Evento marcado como realizado.'
        : nextStatus === 'CANCELADO'
          ? 'Evento cancelado.'
          : 'Evento atualizado.',
    details: {
      status: nextStatus,
      type: input.type ?? current.tipo,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      turmaId: input.turmaId !== undefined ? input.turmaId ?? null : current.turmaId,
      salaId,
      professorIds,
    },
    prismaClient: prisma,
  });

  return buildEventDetailsResult(eventId, contaId);
}

export async function listAgendaResources(contaId: string) {
  return loadAulasResources(contaId, prisma);
}

export async function rebuildAgendaWindow(
  contaId: string,
  input: RebuildAgendaWindowInputDTO,
): Promise<RebuildAgendaWindowResultDTO> {
  const range = normalizeAgendaRange(input.start, input.end);
  const summary = await materializeCalendarWindow({
    contaId,
    start: range.start,
    end: range.end,
    logOperation: true,
    logReason: input.reason,
    prismaClient: prisma,
  });
  const logs = await listAulasOperationLogs(contaId, 10, prisma);

  return {
    success: true,
    data: {
      summary,
      logs: logs.data.items,
    },
  };
}

export async function listAgendaLogs(contaId: string, limit = 20): Promise<ListAgendaOperationLogsResultDTO> {
  return listAulasOperationLogs(contaId, limit, prisma);
}
