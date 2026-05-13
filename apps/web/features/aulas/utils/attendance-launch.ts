import { addDays, endOfDay, startOfDay } from 'date-fns';

import type { CalendarEventStatusDTO } from '@/features/aulas/dtos';
import { startOfZonedDayClient } from '@/lib/agenda-timezone';

export const ATTENDANCE_LAUNCH_WINDOW_DAYS = 7;

export type AttendanceLaunchDecisionReason =
  | 'EVENT_CANCELLED'
  | 'BEFORE_EVENT_DAY'
  | 'WINDOW_EXPIRED'
  | 'ELIGIBLE';

export function getAttendanceLaunchDeadline(startAt: string | Date) {
  return endOfDay(addDays(startOfDay(new Date(startAt)), ATTENDANCE_LAUNCH_WINDOW_DAYS));
}

export function evaluateAttendanceLaunchPolicy(params: {
  startAt: string | Date;
  status: CalendarEventStatusDTO | string;
  referenceDate?: Date;
}) {
  const referenceDate = params.referenceDate ?? new Date();

  if (params.status === 'CANCELADO') {
    return {
      allowed: false,
      reason: 'EVENT_CANCELLED' as const,
      deadline: null,
    };
  }

  const eventDay = startOfDay(new Date(params.startAt));
  const referenceDay = startOfDay(referenceDate);
  const deadline = getAttendanceLaunchDeadline(params.startAt);

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

  if (params.timeZone) {
    const eventDay = startOfZonedDayClient(new Date(params.startAt), params.timeZone).getTime();
    const referenceDay = startOfZonedDayClient(referenceDate, params.timeZone).getTime();
    return eventDay === referenceDay;
  }

  const eventDay = startOfDay(new Date(params.startAt));
  const referenceDay = startOfDay(referenceDate);

  return eventDay.getTime() === referenceDay.getTime();
}
