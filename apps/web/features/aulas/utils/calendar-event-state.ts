import { isSameDay } from 'date-fns';

import type { CalendarEventStatusDTO } from '@/features/aulas/dtos';

export type CalendarEventStateInput = {
  status: CalendarEventStatusDTO;
  startAt: string;
  endAt: string;
};

export type CalendarEventTemporalState = 'future' | 'today' | 'in_progress' | 'ended';
export type CalendarEventTemporalTone = 'neutral' | 'info' | 'warning';
export type CalendarEventCardTone = 'default' | 'in_progress' | 'past' | 'completed' | 'cancelled';

export function getCalendarEventTemporalState(
  event: Pick<CalendarEventStateInput, 'startAt' | 'endAt'>,
  now = new Date(),
): CalendarEventTemporalState {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);

  if (now < start) {
    return isSameDay(now, start) ? 'today' : 'future';
  }

  if (now <= end) {
    return 'in_progress';
  }

  return 'ended';
}

export function isCalendarEventPendingClosure(
  event: CalendarEventStateInput,
  now = new Date(),
) {
  return event.status === 'AGENDADO' && getCalendarEventTemporalState(event, now) === 'ended';
}

export function getCalendarEventTemporalBadge(
  event: CalendarEventStateInput,
  now = new Date(),
): { label: string; tone: CalendarEventTemporalTone } | null {
  const temporalState = getCalendarEventTemporalState(event, now);

  if (event.status === 'AGENDADO' && temporalState === 'ended') {
    return { label: 'Fechamento pendente', tone: 'warning' };
  }

  if (event.status !== 'AGENDADO') {
    return null;
  }

  if (temporalState === 'in_progress') {
    return { label: 'Em andamento', tone: 'info' };
  }

  if (temporalState === 'today') {
    return { label: 'Hoje', tone: 'neutral' };
  }

  return null;
}

export function getCalendarEventCardTone(
  event: CalendarEventStateInput,
  now = new Date(),
): CalendarEventCardTone {
  if (event.status === 'CANCELADO') {
    return 'cancelled';
  }

  if (event.status === 'REALIZADO') {
    return 'completed';
  }

  const temporalState = getCalendarEventTemporalState(event, now);

  if (temporalState === 'ended') {
    return 'past';
  }

  if (temporalState === 'in_progress') {
    return 'in_progress';
  }

  return 'default';
}
