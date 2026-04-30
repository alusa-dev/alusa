import type { CalendarEventStatus, CalendarEventType, Prisma, PrismaClient } from '@prisma/client';
import { addBusinessDays, endOfDay, startOfDay } from 'date-fns';

import { countEligibleStudentsForEvent } from '@/src/server/aulas/calendar/calendar-core.service';
import { createAulasOperationLog } from '@/src/server/aulas/calendar/operation-log.service';
import { prisma } from '@/src/prisma';

export const AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS = 3;
export const AGENDA_EVENT_AUTO_CLOSE_POLICY = {
  toleranceBusinessDays: AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS,
  attendanceRequiredEventTypes: ['AULA', 'REPOSICAO'] as CalendarEventType[],
} as const;

const ATTENDANCE_REQUIRED_EVENT_TYPES = new Set<CalendarEventType>(
  AGENDA_EVENT_AUTO_CLOSE_POLICY.attendanceRequiredEventTypes,
);

type AutoCloseCandidate = Prisma.CalendarEventGetPayload<{
  select: {
    id: true;
    contaId: true;
    tipo: true;
    status: true;
    startAt: true;
    endAt: true;
    turmaId: true;
    attendanceRecords: {
      select: {
        id: true;
      };
    };
  };
}>;

export type AgendaEventAutoCloseDecisionReason =
  | 'STATUS_NOT_SCHEDULED'
  | 'GRACE_PERIOD_ACTIVE'
  | 'ATTENDANCE_PENDING'
  | 'ELIGIBLE';

export function getAgendaEventAutoCloseDeadline(endAt: Date) {
  return endOfDay(
    addBusinessDays(startOfDay(endAt), AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS),
  );
}

export function evaluateAgendaEventAutoClose(params: {
  status: CalendarEventStatus;
  type: CalendarEventType;
  endAt: Date;
  eligibleStudents: number;
  recordedAttendance: number;
  referenceDate?: Date;
}) {
  const referenceDate = params.referenceDate ?? new Date();
  const deadline = getAgendaEventAutoCloseDeadline(params.endAt);

  if (params.status !== 'AGENDADO') {
    return {
      eligible: false,
      reason: 'STATUS_NOT_SCHEDULED' as const,
      deadline,
    };
  }

  if (referenceDate.getTime() < deadline.getTime()) {
    return {
      eligible: false,
      reason: 'GRACE_PERIOD_ACTIVE' as const,
      deadline,
    };
  }

  if (
    ATTENDANCE_REQUIRED_EVENT_TYPES.has(params.type) &&
    params.eligibleStudents > 0 &&
    params.recordedAttendance === 0
  ) {
    return {
      eligible: false,
      reason: 'ATTENDANCE_PENDING' as const,
      deadline,
    };
  }

  return {
    eligible: true,
    reason: 'ELIGIBLE' as const,
    deadline,
  };
}

async function syncLinkedMakeupStatusesForAutoClosedEvent(
  contaId: string,
  eventId: string,
  prismaClient: PrismaClient,
) {
  await prismaClient.makeupClass.updateMany({
    where: {
      contaId,
      eventoDestinoId: eventId,
      status: 'AGENDADA',
    },
    data: {
      status: 'REALIZADA',
    },
  });
}

async function processAutoCloseCandidate(
  event: AutoCloseCandidate,
  prismaClient: PrismaClient,
  referenceDate: Date,
) {
  const baseDecision = evaluateAgendaEventAutoClose({
    status: event.status,
    type: event.tipo,
    endAt: event.endAt,
    eligibleStudents: 0,
    recordedAttendance: event.attendanceRecords.length,
    referenceDate,
  });

  if (baseDecision.reason === 'STATUS_NOT_SCHEDULED' || baseDecision.reason === 'GRACE_PERIOD_ACTIVE') {
    return false;
  }

  let eligibleStudents = 0;

  if (ATTENDANCE_REQUIRED_EVENT_TYPES.has(event.tipo)) {
    eligibleStudents = await countEligibleStudentsForEvent(
      {
        id: event.id,
        contaId: event.contaId,
        turmaId: event.turmaId,
        startAt: event.startAt,
      },
      prismaClient,
    );
  }

  const decision = evaluateAgendaEventAutoClose({
    status: event.status,
    type: event.tipo,
    endAt: event.endAt,
    eligibleStudents,
    recordedAttendance: event.attendanceRecords.length,
    referenceDate,
  });

  if (!decision.eligible) {
    return false;
  }

  const updated = await prismaClient.calendarEvent.updateMany({
    where: {
      id: event.id,
      contaId: event.contaId,
      status: 'AGENDADO',
    },
    data: {
      status: 'REALIZADO',
      cancelledAt: null,
    },
  });

  if (!updated.count) {
    return false;
  }

  await syncLinkedMakeupStatusesForAutoClosedEvent(event.contaId, event.id, prismaClient);
  await createAulasOperationLog({
    contaId: event.contaId,
    action: 'EVENT_AUTO_CLOSED',
    entityType: 'CALENDAR_EVENT',
    entityId: event.id,
    message: 'Evento fechado automaticamente após 3 dias úteis.',
    details: {
      policy: {
        toleranceBusinessDays: AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS,
        attendanceRequired: ATTENDANCE_REQUIRED_EVENT_TYPES.has(event.tipo),
      },
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      autoCloseDeadline: decision.deadline.toISOString(),
      referenceDate: referenceDate.toISOString(),
      eligibleStudents,
      recordedAttendance: event.attendanceRecords.length,
    },
    prismaClient,
  });

  return true;
}

async function listAutoCloseCandidates(params: {
  contaId: string;
  start?: Date;
  end?: Date;
  eventId?: string;
  referenceDate: Date;
  prismaClient: PrismaClient;
}) {
  return params.prismaClient.calendarEvent.findMany({
    where: {
      contaId: params.contaId,
      id: params.eventId,
      status: 'AGENDADO',
      startAt: params.end ? { lt: params.end } : undefined,
      endAt: params.start
        ? {
            gt: params.start,
            lte: params.referenceDate,
          }
        : {
            lte: params.referenceDate,
          },
    },
    select: {
      id: true,
      contaId: true,
      tipo: true,
      status: true,
      startAt: true,
      endAt: true,
      turmaId: true,
      attendanceRecords: {
        select: {
          id: true,
        },
      },
    },
    orderBy: {
      endAt: 'asc',
    },
  });
}

export async function autoCloseAgendaEventsInRange(params: {
  contaId: string;
  start: Date;
  end: Date;
  referenceDate?: Date;
  prismaClient?: PrismaClient;
}) {
  const prismaClient = params.prismaClient ?? prisma;
  const referenceDate = params.referenceDate ?? new Date();
  const candidates = await listAutoCloseCandidates({
    contaId: params.contaId,
    start: params.start,
    end: params.end,
    referenceDate,
    prismaClient,
  });

  let closed = 0;

  for (const candidate of candidates) {
    if (await processAutoCloseCandidate(candidate, prismaClient, referenceDate)) {
      closed += 1;
    }
  }

  return { closed };
}

export async function autoCloseAgendaEventIfDue(params: {
  contaId: string;
  eventId: string;
  referenceDate?: Date;
  prismaClient?: PrismaClient;
}) {
  const prismaClient = params.prismaClient ?? prisma;
  const referenceDate = params.referenceDate ?? new Date();
  const [candidate] = await listAutoCloseCandidates({
    contaId: params.contaId,
    eventId: params.eventId,
    referenceDate,
    prismaClient,
  });

  if (!candidate) {
    return { closed: false };
  }

  return {
    closed: await processAutoCloseCandidate(candidate, prismaClient, referenceDate),
  };
}
