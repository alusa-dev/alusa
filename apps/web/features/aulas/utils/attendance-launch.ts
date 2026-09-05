import { TZDateMini } from '@date-fns/tz';
import { addDays } from 'date-fns';

import type { CalendarEventStatusDTO } from '@/features/aulas/dtos';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  endOfZonedDayClient,
  normalizeAccountTimeZoneClient,
  startOfZonedDayClient,
} from '@/lib/agenda-timezone';

export const ATTENDANCE_LAUNCH_WINDOW_DAYS = 7;

export type AttendanceLaunchDecisionReason =
  | 'EVENT_CANCELLED'
  | 'BEFORE_EVENT_DAY'
  | 'WINDOW_EXPIRED'
  | 'ELIGIBLE';

export function getAttendanceLaunchDeadline(
  startAt: string | Date,
  timeZone: string = DEFAULT_ACCOUNT_TIMEZONE,
) {
  const normalizedTimeZone = normalizeAccountTimeZoneClient(timeZone);
  const zonedStart = new TZDateMini(
    startOfZonedDayClient(new Date(startAt), normalizedTimeZone).getTime(),
    normalizedTimeZone,
  );
  const deadline = addDays(zonedStart, ATTENDANCE_LAUNCH_WINDOW_DAYS);

  return endOfZonedDayClient(new Date(deadline.getTime()), normalizedTimeZone);
}

export function evaluateAttendanceLaunchPolicy(params: {
  startAt: string | Date;
  status: CalendarEventStatusDTO | string;
  timeZone?: string;
  referenceDate?: Date;
}) {
  const referenceDate = params.referenceDate ?? new Date();
  const timeZone = normalizeAccountTimeZoneClient(params.timeZone);

  if (params.status === 'CANCELADO') {
    return {
      allowed: false,
      reason: 'EVENT_CANCELLED' as const,
      deadline: null,
    };
  }

  const eventDay = startOfZonedDayClient(new Date(params.startAt), timeZone);
  const referenceDay = startOfZonedDayClient(referenceDate, timeZone);
  const deadline = getAttendanceLaunchDeadline(params.startAt, timeZone);

  if (eventDay.getTime() > referenceDay.getTime()) {
    return {
      allowed: false,
      reason: 'BEFORE_EVENT_DAY' as const,
      deadline,
    };
  }

  if (referenceDate.getTime() > deadline.getTime()) {
    return {
      allowed: false,
      reason: 'WINDOW_EXPIRED' as const,
      deadline,
    };
  }

  return {
    allowed: true,
    reason: 'ELIGIBLE' as const,
    deadline,
  };
}

export function getAttendanceLaunchPolicyMessage(reason: AttendanceLaunchDecisionReason) {
  switch (reason) {
    case 'EVENT_CANCELLED':
      return 'Eventos cancelados não permitem lançamento de frequência.';
    case 'BEFORE_EVENT_DAY':
      return 'A frequência só pode ser lançada a partir do dia da aula.';
    case 'WINDOW_EXPIRED':
      return 'A janela operacional para lançar ou corrigir a frequência expirou.';
    default:
      return null;
  }
}

export function canLaunchAttendanceForEvent(params: {
  startAt: string | Date;
  status: CalendarEventStatusDTO | string;
  timeZone?: string;
  referenceDate?: Date;
}) {
  return evaluateAttendanceLaunchPolicy(params).allowed;
}

export function isAttendanceEventOnSelectedDay(params: {
  startAt: string | Date;
  referenceDate?: Date;
  timeZone?: string;
}) {
  const referenceDate = params.referenceDate ?? new Date();
  const timeZone = normalizeAccountTimeZoneClient(params.timeZone);
  const eventDay = startOfZonedDayClient(new Date(params.startAt), timeZone);
  const referenceDay = startOfZonedDayClient(referenceDate, timeZone);

  return eventDay.getTime() === referenceDay.getTime();
}
