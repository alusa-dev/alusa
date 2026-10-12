'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
/** Luxon deve vir antes dos outros plugins para named IANA timeZone (docs FullCalendar). */
import luxonPlugin from '@fullcalendar/luxon3';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { DateSelectArg, EventClickArg, EventContentArg, EventInput, EventMountArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import { TZDateMini } from '@date-fns/tz';
import { addDays } from 'date-fns';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { AddCircle, Plus } from '@/components/icons/icons';
import styles from '@/features/lessons/calendar/components/CalendarScheduler.module.css';
import type { AgendaViewModeDTO, CalendarEventListItemDTO } from '@/features/lessons/dtos';
import { CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/lessons/types';
import {
  getCalendarEventCardTone,
  getCalendarEventTemporalBadge,
} from '@/features/lessons/utils/calendar-event-state';
import {
  formatAgendaDayLabel,
  formatAgendaTimeLabel,
  getZonedMinutesFromMidnight,
  startOfZonedDayClient,
} from '@/lib/agenda-timezone';
import { cn } from '@/lib/utils';

type CalendarSchedulerProps = {
  events: CalendarEventListItemDTO[];
  viewMode: AgendaViewModeDTO;
  anchorDate: string;
  /** IANA zone da conta — mantém grades alinhadas ao servidor após correção de fuso */
  timeZone: string;
  onEventSelect: (_eventId: string) => void;
  draftSelection: { startAt: string; endAt: string; allDay: boolean } | null;
  onSelectRange: (_startAt: string, _endAt: string, _allDay: boolean) => void;
  onClearRange: () => void;
  onDraftCreateAction: (_action: 'event' | 'experimental' | 'makeup') => void;
};

const DRAFT_SELECTION_EVENT_ID = '__agenda_draft_selection__';

/** Alinha ao slotMinTime / slotMaxTime do timeGridWeek */
const DEFAULT_TIME_GRID_START_MINUTES = 6 * 60;
const DEFAULT_TIME_GRID_END_MINUTES = 22 * 60;
const MINUTES_PER_DAY = 24 * 60;

const EVENT_TYPE_LABELS = Object.fromEntries(
  CALENDAR_EVENT_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CalendarEventListItemDTO['type'], string>;

const EVENT_STATUS_LABELS: Record<CalendarEventListItemDTO['status'], string> = {
  AGENDADO: 'Agendado',
  CANCELADO: 'Cancelado',
  REALIZADO: 'Realizado',
};

function clampRatio(n: number) {
  return Math.max(0, Math.min(1, n));
}

function roundedMinutesFromPointerY(
  relY: number,
  areaHeightPx: number,
  startMinutes: number,
  endMinutes: number,
) {
  if (areaHeightPx <= 0) return startMinutes;
  const total = endMinutes - startMinutes;
  const pct = clampRatio(relY / areaHeightPx);
  const approx = startMinutes + pct * total;
  return Math.round(
    Math.min(endMinutes, Math.max(startMinutes, approx)),
  );
}

function formatHoverClockLabel(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = Math.floor(totalMinutes % 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

type HoverGuideState = {
  lineLeft: number;
  lineRight: number;
  lineCenterY: number;
  badgeLeftViewport: number;
  badgeSide: 'left' | 'right';
  /** Horário interpolado pela posição vertical nos slots */
  timeLabel: string;
};

type TimeGridBounds = {
  startMinutes: number;
  endMinutes: number;
};

function roundDownToHour(minutes: number) {
  return Math.max(0, Math.floor(minutes / 60) * 60);
}

function roundUpToHour(minutes: number) {
  return Math.min(MINUTES_PER_DAY, Math.ceil(minutes / 60) * 60);
}

function getTimeGridBounds(events: CalendarEventListItemDTO[], timeZone: string): TimeGridBounds {
  let startMinutes = DEFAULT_TIME_GRID_START_MINUTES;
  let endMinutes = DEFAULT_TIME_GRID_END_MINUTES;

  for (const event of events) {
    const start = getZonedMinutesFromMidnight(new Date(event.startAt), timeZone);
    const end = getZonedMinutesFromMidnight(new Date(event.endAt), timeZone);
    startMinutes = Math.min(startMinutes, roundDownToHour(start));
    endMinutes = Math.max(endMinutes, roundUpToHour(end <= start ? MINUTES_PER_DAY : end));
  }

  return {
    startMinutes,
    endMinutes: Math.max(startMinutes + 60, endMinutes),
  };
}

function formatTimeGridOption(minutes: number) {
  if (minutes >= MINUTES_PER_DAY) return '24:00:00';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function useIsMobileCalendar() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return isMobile;
}

/** Tons violeta/indigo derivados dos tokens `--brand-accent`, `--brand-primary` (globals). Sem traço. */
const COLOR_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'bg-sky-50 text-sky-950 alusa-dark:bg-sky-950/50 alusa-dark:text-sky-100',
  AULA_EXPERIMENTAL: 'bg-violet-50 text-violet-950 alusa-dark:bg-violet-950/50 alusa-dark:text-violet-100',
  REPOSICAO: 'bg-teal-50 text-teal-950 alusa-dark:bg-teal-950/50 alusa-dark:text-teal-100',
  EVENTO_INTERNO: 'bg-indigo-50 text-indigo-950 alusa-dark:bg-indigo-950/50 alusa-dark:text-indigo-100',
  EVENTO_EXTERNO: 'bg-orange-50 text-orange-950 alusa-dark:bg-orange-950/50 alusa-dark:text-orange-100',
  WORKSHOP: 'bg-cyan-50 text-cyan-950 alusa-dark:bg-cyan-950/50 alusa-dark:text-cyan-100',
  FERIADO: 'bg-amber-50 text-amber-950 alusa-dark:bg-amber-950/50 alusa-dark:text-amber-100',
  PAUSA: 'bg-slate-100 text-slate-800 alusa-dark:bg-slate-800 alusa-dark:text-slate-100',
  CANCELAMENTO: 'bg-rose-50 text-rose-950 alusa-dark:bg-rose-950/50 alusa-dark:text-rose-100',
  SUBSTITUICAO: 'bg-emerald-50 text-emerald-950 alusa-dark:bg-emerald-950/50 alusa-dark:text-emerald-100',
};

const BORDER_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'border-sky-200 alusa-dark:border-sky-800',
  AULA_EXPERIMENTAL: 'border-violet-200 alusa-dark:border-violet-800',
  REPOSICAO: 'border-teal-200 alusa-dark:border-teal-800',
  EVENTO_INTERNO: 'border-indigo-200 alusa-dark:border-indigo-800',
  EVENTO_EXTERNO: 'border-orange-200 alusa-dark:border-orange-800',
  WORKSHOP: 'border-cyan-200 alusa-dark:border-cyan-800',
  FERIADO: 'border-amber-200 alusa-dark:border-amber-800',
  PAUSA: 'border-slate-300 alusa-dark:border-slate-600',
  CANCELAMENTO: 'border-rose-200 alusa-dark:border-rose-800',
  SUBSTITUICAO: 'border-emerald-200 alusa-dark:border-emerald-800',
};

const CALENDAR_PLUGINS = [luxonPlugin, dayGridPlugin, timeGridPlugin, interactionPlugin];

function toEventInput(event: CalendarEventListItemDTO): EventInput {
  return {
    id: event.id,
    title: event.title,
    start: event.startAt,
    end: event.endAt,
    extendedProps: {
      type: event.type,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      sala: event.sala?.label ?? null,
      turma: event.turma?.label ?? null,
      professor: event.professores[0]?.nome ?? null,
      professores: event.professores.map((professor) => professor.nome),
      conflicts: event.conflicts.length,
      compactTitle: event.title,
    },
  };
}

const TIMEGRID_EVENT_MIN_HEIGHT_PX = 24;
const TIMEGRID_EVENT_COMPACT_MIN_HEIGHT_PX = 52;
const TIMEGRID_EVENT_DETAILS_MIN_HEIGHT_PX = 108;

function getTimeGridSlotHeightPx(events: CalendarEventListItemDTO[]) {
  const longestDurationMinutes = events.reduce((longest, event) => {
    const duration = (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000;
    return Math.max(longest, duration);
  }, 0);

  if (longestDurationMinutes >= 90) return 72;
  return 70;
}

function formatTeacherDisplayName(name: string) {
  const nameParts = name.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length <= 2) return nameParts.join(' ');
  return `${nameParts[0]} ${nameParts.at(-1)}`;
}

function TimeGridEventContent({ arg }: { arg: EventContentArg }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentLayout, setContentLayout] = useState<'minimal' | 'compact' | 'full'>('minimal');
  const teachers = (arg.event.extendedProps.professores as string[] | undefined) ?? [];
  const room = arg.event.extendedProps.sala as string | null;
  const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
  const status = arg.event.extendedProps.status as CalendarEventListItemDTO['status'];
  const eventState = {
    status,
    startAt: arg.event.extendedProps.startAt as string,
    endAt: arg.event.extendedProps.endAt as string,
  };
  const temporalBadge = getCalendarEventTemporalBadge(eventState);
  const teacherNames = teachers.map(formatTeacherDisplayName);
  const teacherLabel = teacherNames.join(', ');

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const syncDetailsVisibility = (height = element.getBoundingClientRect().height) => {
      if (height >= TIMEGRID_EVENT_DETAILS_MIN_HEIGHT_PX) {
        setContentLayout('full');
      } else if (height >= TIMEGRID_EVENT_COMPACT_MIN_HEIGHT_PX) {
        setContentLayout('compact');
      } else {
        setContentLayout('minimal');
      }
    };

    if (typeof ResizeObserver === 'undefined') {
      syncDetailsVisibility();
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) syncDetailsVisibility(entry.contentRect.height);
    });

    observer.observe(element);
    syncDetailsVisibility();

    return () => observer.disconnect();
  }, []);

  const fullTimeRange = arg.timeText.trim();
  const eventStatus = EVENT_STATUS_LABELS[status];
  const statusBadge = eventStatus ? (
    <span
      data-testid="calendar-event-status"
      className={cn(
        'shrink-0 text-[10px] font-semibold leading-3',
        status === 'AGENDADO' && 'text-slate-600',
        status === 'REALIZADO' && 'text-emerald-800',
        status === 'CANCELADO' && 'text-rose-800',
      )}
    >
      {eventStatus}
    </span>
  ) : null;

  return (
    <div
      ref={contentRef}
      className="flex h-full min-h-0 flex-col overflow-hidden text-xs font-medium leading-4"
    >
      {contentLayout !== 'minimal' && statusBadge ? <div className="mb-2 flex min-h-3 items-center">{statusBadge}</div> : null}
      <div className={cn('min-h-0 truncate font-semibold leading-4', contentLayout === 'minimal' && 'text-[10px]')} data-testid="calendar-event-title">
        {arg.event.title}
      </div>
      {contentLayout === 'full' && temporalBadge ? (
        <div data-testid="calendar-event-temporal-info" className="min-h-3 truncate text-[11px] leading-4 opacity-80">
          {temporalBadge.label}
        </div>
      ) : null}
      {contentLayout === 'full' && (teacherLabel || room || conflicts > 0) ? (
        <div data-testid="calendar-event-details-footer" className="flex min-w-0 shrink-0 flex-col items-start text-[11px] leading-4 opacity-85">
          {teacherLabel || conflicts > 0 ? (
            <div className="flex min-w-0 items-center gap-1">
              {teacherLabel ? <span className="min-w-0 truncate" title={teacherLabel}>{teacherLabel}</span> : null}
              {conflicts > 0 ? (
                <span
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-600 text-xs font-bold leading-4 text-white"
                  title={`${conflicts} conflito(s) de agenda`}
                  aria-label={`${conflicts} conflito(s) de agenda`}
                >
                  !
                </span>
              ) : null}
            </div>
          ) : null}
          {room ? <span className="min-w-0 truncate" title={room}>{room}</span> : null}
        </div>
      ) : null}
      {contentLayout !== 'minimal' ? (
        <div className={cn('mt-auto flex min-h-4 min-w-0 items-center leading-4', contentLayout === 'full' ? 'pt-2' : 'pt-0')}>
          <span data-testid="calendar-event-time" className="shrink-0 truncate font-medium opacity-80">{fullTimeRange}</span>
        </div>
      ) : null}
    </div>
  );
}

function buildEventTooltip(arg: EventMountArg) {
  if (arg.event.extendedProps.isDraftSelection === true) {
    return [arg.event.title, arg.timeText].filter(Boolean).join('\n');
  }

  const type = arg.event.extendedProps.type as CalendarEventListItemDTO['type'];
  const status = arg.event.extendedProps.status as CalendarEventListItemDTO['status'];
  const teacher = arg.event.extendedProps.professor as string | null;
  const room = arg.event.extendedProps.sala as string | null;
  const turma = arg.event.extendedProps.turma as string | null;
  const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
  const lines = [arg.event.title, arg.timeText, EVENT_TYPE_LABELS[type], EVENT_STATUS_LABELS[status]].filter(Boolean);

  if (turma) {
    lines.push(`Turma: ${turma}`);
  }

  if (teacher) {
    lines.push(`Professor: ${teacher}`);
  }

  if (room) {
    lines.push(`Sala: ${room}`);
  }

  if (conflicts > 0) {
    lines.push(`${conflicts} conflito(s)`);
  }

  return Array.from(new Set(lines)).join('\n');
}

function renderEventContent(isTimeGridView: boolean) {
  return function EventContent(arg: EventContentArg) {
    if (arg.isMirror) {
      return (
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md px-2 py-1 text-center text-xs font-medium leading-4 text-slate-700 alusa-dark:text-slate-200">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-accent)] text-white">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span className="max-w-full truncate">Adicionar evento</span>
        </div>
      );
    }

    if (arg.event.extendedProps.isDraftSelection === true) {
      // O FullCalendar divide eventos longos em segmentos diários. A ação pertence
      // ao começo da seleção, então não deve ser repetida nem centralizada nos
      // segmentos dos dias seguintes.
      if (!arg.isStart) return null;

      return (
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-start gap-1 overflow-hidden rounded-md px-2 pt-3 text-center text-xs font-medium leading-4 text-slate-700 alusa-dark:text-slate-200">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-accent)] text-white shadow-sm">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span className="max-w-full truncate">Adicionar evento</span>
        </div>
      );
    }

    const type = arg.event.extendedProps.type as CalendarEventListItemDTO['type'];
    const teacher = arg.event.extendedProps.professor as string | null;
    const room = arg.event.extendedProps.sala as string | null;
    const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
    const eventState = {
      status: arg.event.extendedProps.status as CalendarEventListItemDTO['status'],
      startAt: arg.event.extendedProps.startAt as string,
      endAt: arg.event.extendedProps.endAt as string,
    };
    const temporalBadge = getCalendarEventTemporalBadge(eventState);
    const cardTone = getCalendarEventCardTone(eventState);
    const teacherName = teacher ? formatTeacherDisplayName(teacher) : null;

    return (
      <div
        data-testid="calendar-event-card"
        data-event-id={arg.event.id}
        data-event-title={arg.event.title}
        className={cn(
          'group h-full min-h-6 cursor-pointer rounded-lg border text-xs leading-4 transition-shadow duration-150 hover:shadow-md',
          isTimeGridView ? 'px-3 py-2 min-h-0' : 'px-3 py-2 min-h-[124px]',
          COLOR_BY_TYPE[type] ?? COLOR_BY_TYPE.AULA,
          BORDER_BY_TYPE[type] ?? BORDER_BY_TYPE.AULA,
          cardTone === 'in_progress' && 'shadow-[inset_0_0_0_1px_rgba(92,47,145,0.28)]',
          cardTone === 'past' && 'opacity-80',
          cardTone === 'completed' && 'bg-emerald-50 text-emerald-950 alusa-dark:bg-emerald-950/50 alusa-dark:text-emerald-100',
          cardTone === 'completed' && 'border-emerald-200 alusa-dark:border-emerald-800',
          cardTone === 'cancelled' && 'bg-rose-50 text-rose-950 line-through alusa-dark:bg-rose-950/50 alusa-dark:text-rose-100',
          cardTone === 'cancelled' && 'border-rose-200 alusa-dark:border-rose-800',
          cardTone === 'in_progress' && 'ring-2 ring-primary/50',
        )}
        data-event-status={eventState.status}
        data-event-type={type}
        aria-label={`${arg.event.title}, ${arg.timeText}, ${EVENT_TYPE_LABELS[type]}, ${EVENT_STATUS_LABELS[eventState.status]}${conflicts ? `, ${conflicts} conflito(s)` : ''}`}
      >
        {isTimeGridView ? (
          <TimeGridEventContent arg={arg} />
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden text-xs leading-4">
            <div className="mb-2 flex min-h-3 items-center">
              <span className={cn(
                'text-[10px] font-semibold leading-3',
                eventState.status === 'REALIZADO' && 'text-emerald-800 alusa-dark:text-emerald-200',
                eventState.status === 'CANCELADO' && 'text-rose-800 alusa-dark:text-rose-200',
                eventState.status === 'AGENDADO' && 'text-slate-600 alusa-dark:text-slate-300',
              )}>{EVENT_STATUS_LABELS[eventState.status]}</span>
            </div>
            <div className="min-h-0 truncate font-semibold" data-testid="calendar-event-title">
              {arg.event.title}
            </div>
            {temporalBadge ? (
              <div data-testid="calendar-event-temporal-info" className="truncate text-[11px] leading-4 opacity-80">
                {temporalBadge.label}
              </div>
            ) : null}
            {teacherName ? <div className="truncate text-[11px] leading-4 opacity-85" title={teacherName}>{teacherName}</div> : null}
            {room ? <div className="truncate text-[11px] leading-4 opacity-85" title={room}>{room}</div> : null}
            {conflicts > 0 ? <div className="shrink-0 text-[11px] font-semibold text-amber-800 alusa-dark:text-amber-200">! {conflicts} conflito(s)</div> : null}
            <div className="mt-auto flex min-h-4 items-center pt-2 leading-4">
              <span data-testid="calendar-event-time" className="truncate font-medium opacity-80">{arg.timeText.trim()}</span>
            </div>
          </div>
        )}
      </div>
    );
  };
}

function CalendarEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-24 z-10 flex justify-center">
      <div className="rounded-xl border border-dashed border-slate-200 bg-white/95 px-5 py-4 text-center">
        <p className="text-sm font-semibold text-slate-700">Nenhum evento neste período</p>
        <p className="mt-1 text-xs text-slate-500">Ajuste os filtros ou crie um novo evento para começar.</p>
      </div>
    </div>
  );
}

function MobileAgendaList({
  events,
  viewMode,
  timeZone,
  onEventSelect,
}: {
  events: CalendarEventListItemDTO[];
  viewMode: AgendaViewModeDTO;
  timeZone: string;
  onEventSelect: (_eventId: string) => void;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<string, CalendarEventListItemDTO[]>();

    for (const event of events.slice().sort((a, b) => a.startAt.localeCompare(b.startAt))) {
      const dayKey = formatAgendaDayLabel(event.startAt, timeZone);
      const current = grouped.get(dayKey) ?? [];
      current.push(event);
      grouped.set(dayKey, current);
    }

    return Array.from(grouped.entries());
  }, [events, timeZone]);

  if (groups.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center px-6" data-testid="agenda-mobile-list" data-agenda-view={viewMode}>
        <div className="max-w-xs text-center">
          <p className="text-sm font-semibold text-slate-700">Nenhum evento neste período</p>
          <p className="mt-1 text-xs text-slate-500">Ajuste os filtros ou crie um novo evento para começar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4" data-testid="agenda-mobile-list" data-agenda-view={viewMode}>
      {groups.map(([dayLabel, dayEvents], groupIndex) => (
        <section key={dayLabel} aria-labelledby={`agenda-day-${groupIndex}`}>
          <h3
            id={`agenda-day-${groupIndex}`}
            className="mb-2 border-b border-slate-100 pb-2 text-sm font-semibold capitalize tracking-wide text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]"
          >
            {dayLabel}
          </h3>
          <div className="space-y-2">
            {dayEvents
              .slice()
              .sort((a, b) => a.startAt.localeCompare(b.startAt))
              .map((event) => {
                const tone = getCalendarEventCardTone({
                  status: event.status,
                  startAt: event.startAt,
                  endAt: event.endAt,
                });
                const resources = [
                  event.turma?.label,
                  event.professores[0]?.nome,
                  event.sala?.label,
                ].filter(Boolean).join(' · ');
                const temporalBadge = getCalendarEventTemporalBadge({
                  status: event.status,
                  startAt: event.startAt,
                  endAt: event.endAt,
                });

                return (
                  <button
                    key={event.id}
                    type="button"
                    className={cn(
                      'min-h-16 w-full rounded-xl border border-slate-200 border-l-4 bg-white px-3 py-3 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]',
                      tone === 'cancelled' && 'border-l-rose-400 bg-rose-50/40',
                      tone === 'completed' && 'border-l-emerald-400 bg-emerald-50/40',
                      tone === 'in_progress' && 'border-l-primary bg-violet-50/50',
                      tone === 'past' && 'border-l-slate-300 opacity-80',
                    )}
                    aria-label={`${event.title}, ${formatAgendaTimeLabel(event.startAt, timeZone)} a ${formatAgendaTimeLabel(event.endAt, timeZone)}, ${EVENT_TYPE_LABELS[event.type]}, ${EVENT_STATUS_LABELS[event.status]}${event.conflicts.length ? `, ${event.conflicts.length} conflito(s)` : ''}`}
                    onClick={() => onEventSelect(event.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                          {formatAgendaTimeLabel(event.startAt, timeZone)}–{formatAgendaTimeLabel(event.endAt, timeZone)}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{event.title}</p>
                        <p className="mt-1 truncate text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">{resources || 'Sem recurso vinculado'}</p>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-1 text-xs font-medium', COLOR_BY_TYPE[event.type])}>
                        {EVENT_TYPE_LABELS[event.type]}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium">
                      {temporalBadge ? <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{temporalBadge.label}</span> : null}
                      <span className={cn(
                        'text-xs font-semibold',
                        event.status === 'REALIZADO' && 'text-emerald-800 alusa-dark:text-emerald-200',
                        event.status === 'CANCELADO' && 'text-rose-800 alusa-dark:text-rose-200',
                        event.status === 'AGENDADO' && 'text-slate-600 alusa-dark:text-slate-300',
                      )}>{EVENT_STATUS_LABELS[event.status]}</span>
                      {event.conflicts.length > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900 alusa-dark:bg-amber-950/50 alusa-dark:text-amber-100">{event.conflicts.length} conflito(s)</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function CalendarScheduler({
  events,
  viewMode,
  anchorDate,
  timeZone,
  onEventSelect,
  draftSelection,
  onSelectRange,
  onClearRange,
  onDraftCreateAction,
}: CalendarSchedulerProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draftMenuRef = useRef<HTMLDivElement>(null);
  const eventKeyHandlers = useRef(new WeakMap<HTMLElement, (_event: KeyboardEvent) => void>());
  const hasActiveDateSelection = useRef(false);
  const isPointerSelecting = useRef(false);
  const [hoverGuide, setHoverGuide] = useState<HoverGuideState | null>(null);
  const [draftMenuPosition, setDraftMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const initialView = viewMode === 'day' ? 'timeGridDay' : viewMode === 'week' ? 'timeGridWeek' : 'dayGridMonth';
  const isTimeGridView = viewMode === 'day' || viewMode === 'week';
  const isWeekView = viewMode === 'week';
  const isDetailedMonth = !isTimeGridView;
  const isMobile = useIsMobileCalendar();
  const timeGridBounds = useMemo(() => getTimeGridBounds(events, timeZone), [events, timeZone]);
  const timeGridSlotHeightPx = useMemo(() => getTimeGridSlotHeightPx(events), [events]);

  const fullCalendarEvents = useMemo(() => {
    const eventInputs = events.map(toEventInput);
    if (!draftSelection) return eventInputs;

    eventInputs.push({
      id: DRAFT_SELECTION_EVENT_ID,
      title: 'Novo evento',
      start: draftSelection.startAt,
      end: draftSelection.endAt,
      allDay: draftSelection.allDay,
      classNames: ['calendar-event-draft-selection'],
      backgroundColor: '#f1f5f9',
      borderColor: '#cbd5e1',
      textColor: '#475569',
      extendedProps: { isDraftSelection: true },
    });

    return eventInputs;
  }, [draftSelection, events]);

  const eventContentRenderer = useMemo(
    () => renderEventContent(isTimeGridView),
    [isTimeGridView],
  );

  const handleEventClick = useCallback((info: EventClickArg) => {
    info.jsEvent.preventDefault();
    if (info.event.extendedProps.isDraftSelection === true) {
      const cardRect = info.el.getBoundingClientRect();
      const menuWidth = 208;
      const menuHeight = 148;
      const left = cardRect.right + menuWidth + 12 <= window.innerWidth
        ? cardRect.right + 8
        : Math.max(8, cardRect.left - menuWidth - 8);
      const top = Math.max(
        8,
        Math.min(window.innerHeight - menuHeight - 8, cardRect.top + cardRect.height / 2 - menuHeight / 2),
      );
      setDraftMenuPosition({ left, top });
      return;
    }
    setDraftMenuPosition(null);
    hasActiveDateSelection.current = false;
    onClearRange();
    onEventSelect(info.event.id);
  }, [onClearRange, onEventSelect]);

  useEffect(() => {
    if (!draftMenuPosition) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!draftMenuRef.current?.contains(event.target as Node)) {
        setDraftMenuPosition(null);
      }
    };
    const closeOnResize = () => setDraftMenuPosition(null);

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [draftMenuPosition]);

  const handleDateSelect = useCallback((selection: DateSelectArg) => {
    hasActiveDateSelection.current = true;
    setDraftMenuPosition(null);
    setHoverGuide(null);
    onSelectRange(selection.start.toISOString(), selection.end.toISOString(), selection.allDay);
  }, [onSelectRange]);

  const handleDateClick = useCallback((selection: DateClickArg) => {
    hasActiveDateSelection.current = true;
    setDraftMenuPosition(null);
    setHoverGuide(null);

    if (selection.allDay) {
      const start = startOfZonedDayClient(selection.date, timeZone);
      const end = addDays(new TZDateMini(start.getTime(), timeZone), 1);
      onSelectRange(start.toISOString(), new Date(end.getTime()).toISOString(), true);
      return;
    }

    if (!isTimeGridView) return;
    const end = new Date(selection.date.getTime() + 30 * 60_000);
    onSelectRange(selection.date.toISOString(), end.toISOString(), false);
  }, [isTimeGridView, onSelectRange, timeZone]);

  const handleDateUnselect = useCallback(() => {
    hasActiveDateSelection.current = false;
    setDraftMenuPosition(null);
    onClearRange();
  }, [onClearRange]);

  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!hasActiveDateSelection.current && !draftSelection)) return;
      calendarRef.current?.getApi().unselect();
      hasActiveDateSelection.current = false;
      setDraftMenuPosition(null);
      onClearRange();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draftSelection, isMobile, onClearRange]);

  const handleEventDidMount = useCallback((arg: EventMountArg) => {
    if (arg.event.extendedProps.isDraftSelection === true) {
      arg.el.title = 'Adicionar evento neste período';
      arg.el.setAttribute('aria-label', 'Adicionar evento neste período');
      arg.el.setAttribute('role', 'button');
      arg.el.tabIndex = 0;
      return;
    }

    const label = buildEventTooltip(arg);
    arg.el.title = label;
    arg.el.setAttribute('aria-label', label.replaceAll('\n', ', '));
    arg.el.setAttribute('role', 'button');
    arg.el.tabIndex = 0;
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onEventSelect(arg.event.id);
    };
    eventKeyHandlers.current.set(arg.el, keyHandler);
    arg.el.addEventListener('keydown', keyHandler);
  }, [onEventSelect]);

  const handleEventWillUnmount = useCallback((arg: EventMountArg) => {
    const keyHandler = eventKeyHandlers.current.get(arg.el);
    if (!keyHandler) return;
    arg.el.removeEventListener('keydown', keyHandler);
    eventKeyHandlers.current.delete(arg.el);
  }, []);

  const dayCellClassNames = useCallback(() => (
    isDetailedMonth ? ['calendar-scheduler-day-detailed'] : []
  ), [isDetailedMonth]);

  /** timeGrid + height:auto: garantir medida estável dos slats após paint (sub-hora / :30). */
  const bumpTimeGridLayout = useCallback(() => {
    if (!isTimeGridView) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    requestAnimationFrame(() => {
      api.updateSize();
      // Segundo tick: Tabs/parent flex às vezes só estabiliza dimensões depois do primeiro frame.
      requestAnimationFrame(() => {
        api.updateSize();
      });
    });
  }, [isTimeGridView]);

  useLayoutEffect(() => {
    bumpTimeGridLayout();
  }, [anchorDate, bumpTimeGridLayout, events, timeZone, viewMode]);

  useLayoutEffect(() => {
    if (!isWeekView) return;
    const el = wrapperRef.current;
    if (!el) return;

    if (typeof ResizeObserver === 'undefined') {
      bumpTimeGridLayout();
      return;
    }

    const ro = new ResizeObserver(() => {
      bumpTimeGridLayout();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [bumpTimeGridLayout, isWeekView]);

  const calendarPaintKey = `${viewMode}:${anchorDate}:${timeZone}`;
  const [calendarPaintReady, setCalendarPaintReady] = useState(false);

  useEffect(() => {
    setCalendarPaintReady(false);
    const frame = requestAnimationFrame(() => {
      setCalendarPaintReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [calendarPaintKey]);

  useEffect(() => {
    if (!isWeekView || isMobile) {
      setHoverGuide(null);
      return;
    }

    const root = wrapperRef.current;
    if (!root || typeof window === 'undefined') {
      return;
    }

    const hideGuide = () => setHoverGuide(null);

    function onPointerDown(ev: PointerEvent) {
      if (!(ev.target instanceof Element) || ev.target.closest('.fc-timegrid-event')) return;
      isPointerSelecting.current = true;
      setHoverGuide(null);
    }

    function onPointerUp() {
      isPointerSelecting.current = false;
    }

    function onPointerMove(ev: PointerEvent) {
      const host = wrapperRef.current;
      if (!host) return;

      if (hasActiveDateSelection.current || isPointerSelecting.current) {
        setHoverGuide(null);
        return;
      }

      const eventCard = ev.target instanceof Element
        ? ev.target.closest('.fc-timegrid-event')
        : null;
      if (!eventCard) {
        setHoverGuide(null);
        return;
      }

      const slotsEl = host.querySelector('.fc-timegrid-slots') as HTMLElement | null;
      if (!slotsEl) {
        setHoverGuide(null);
        return;
      }

      const srSlots = slotsEl.getBoundingClientRect();
      const eventRect = eventCard.getBoundingClientRect();
      const lineLeft = eventRect.left;
      const lineRight = eventRect.right;

      const x = ev.clientX;
      const y = ev.clientY;

      if (
        x < lineLeft ||
        x > lineRight ||
        y < srSlots.top ||
        y > srSlots.bottom ||
        srSlots.height < 1
      ) {
        setHoverGuide(null);
        return;
      }

      const lineCenterY = Math.min(srSlots.bottom - 2, Math.max(srSlots.top + 2, y));
      const relY = lineCenterY - srSlots.top;
      const minsRounded = roundedMinutesFromPointerY(
        relY,
        srSlots.height,
        timeGridBounds.startMinutes,
        timeGridBounds.endMinutes,
      );
      const timeLabel = formatHoverClockLabel(minsRounded);

      const badgeHasLeftSpace = lineLeft >= 62;
      const badgeLeftViewport = badgeHasLeftSpace ? lineLeft - 6 : lineRight + 6;

      setHoverGuide({
        lineLeft,
        lineRight,
        lineCenterY,
        badgeLeftViewport,
        badgeSide: badgeHasLeftSpace ? 'left' : 'right',
        timeLabel,
      });
    }

    /** Captura garante atualização mesmo com o cursor sobre fc-event */
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('pointermove', onPointerMove, true);
    root.addEventListener('pointerleave', hideGuide);
    root.addEventListener('pointercancel', hideGuide);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);

    return () => {
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('pointermove', onPointerMove, true);
      root.removeEventListener('pointerleave', hideGuide);
      root.removeEventListener('pointercancel', hideGuide);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [isMobile, isWeekView, timeGridBounds]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'calendar-scheduler-wrapper relative bg-white alusa-dark:bg-[color:var(--color-bg-card)]',
        isTimeGridView && styles.timeGridSizing,
        isWeekView && 'calendar-scheduler-wrapper--week',
        isDetailedMonth && 'calendar-scheduler-wrapper--month-detailed',
        draftSelection && 'calendar-scheduler-wrapper--has-draft-selection',
        isMobile && 'calendar-scheduler-wrapper--mobile',
      )}
      style={isTimeGridView ? ({ '--calendar-timegrid-slot-height': `${timeGridSlotHeightPx}px` } as CSSProperties) : undefined}
    >
      {hoverGuide && isWeekView ? (
        <div aria-hidden className="pointer-events-none calendar-timegrid-hover-layer">
          <div
            className="calendar-timegrid-hover-line fixed z-[60] h-[2px] rounded-full bg-[color:var(--brand-accent)] shadow-[0_0_10px_rgba(92,47,145,0.28)]"
            style={{
              left: hoverGuide.lineLeft,
              width: hoverGuide.lineRight - hoverGuide.lineLeft,
              top: hoverGuide.lineCenterY - 1,
            }}
        />
          <div
            aria-hidden
            className="fixed z-[61] box-border size-2 shrink-0 rounded-full bg-[color:var(--brand-accent)] shadow-[0_1px_3px_rgba(25,20,58,0.35)]"
            style={{
              left: hoverGuide.lineLeft + 4,
              top: hoverGuide.lineCenterY,
              transform: 'translate(-50%, -50%)',
            }}
          />
          <div
            className="fixed z-[62] whitespace-nowrap rounded-full bg-[color:var(--brand-accent)] px-2.5 py-1 text-[11px] font-semibold leading-none text-white shadow-[0_2px_8px_rgba(25,20,58,0.28)]"
            style={{
              left: Math.max(hoverGuide.badgeLeftViewport, 4),
              top: hoverGuide.lineCenterY,
              transform: hoverGuide.badgeSide === 'left'
                ? 'translate(-100%, -50%)'
                : 'translate(0, -50%)',
            }}
          >
            {hoverGuide.timeLabel}
          </div>
        </div>
      ) : null}
      {draftMenuPosition ? (
        <div
          ref={draftMenuRef}
          role="menu"
          aria-label="Opções para adicionar evento"
          className="fixed z-[100] w-52 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-xl alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:text-[color:var(--color-text-primary)]"
          style={draftMenuPosition}
        >
          {([
            ['event', 'Novo evento'],
            ['experimental', 'Aula experimental'],
            ['makeup', 'Reposição'],
          ] as const).map(([action, label], index) => (
            <div key={action} role="none">
              {index > 0 ? (
                <div
                  role="separator"
                  className="my-1 h-px bg-slate-200 alusa-dark:bg-[color:var(--color-border-default)]"
                />
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none alusa-dark:hover:bg-[color:var(--color-bg-elevated)] alusa-dark:focus-visible:bg-[color:var(--color-bg-elevated)]"
                onClick={() => {
                  setDraftMenuPosition(null);
                  onDraftCreateAction(action);
                }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <AddCircle className="size-5 shrink-0 text-[color:var(--brand-accent)]" aria-hidden="true" />
                  <span>{label}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {isMobile ? (
        <MobileAgendaList events={events} viewMode={viewMode} timeZone={timeZone} onEventSelect={onEventSelect} />
      ) : calendarPaintReady ? (
        <FullCalendar
          ref={calendarRef}
          key={`${viewMode}:${anchorDate}:${timeZone}`}
          plugins={CALENDAR_PLUGINS}
          initialView={initialView}
          initialDate={anchorDate}
          locale="pt-br"
          timeZone={timeZone}
          firstDay={0}
          headerToolbar={false}
          dayMaxEventRows={isWeekView ? 3 : 4}
          eventMaxStack={isTimeGridView ? 2 : undefined}
          selectable={!isMobile}
          selectMirror={false}
          unselectAuto={false}
          select={handleDateSelect}
          dateClick={handleDateClick}
          unselect={handleDateUnselect}
          allDaySlot={false}
          slotMinTime={formatTimeGridOption(timeGridBounds.startMinutes)}
          slotMaxTime={formatTimeGridOption(timeGridBounds.endMinutes)}
          slotDuration={isTimeGridView ? '00:30:00' : undefined}
          snapDuration={isTimeGridView ? '00:15:00' : undefined}
          slotLabelInterval={isTimeGridView ? '01:00:00' : undefined}
          expandRows={isWeekView}
          slotEventOverlap={false}
          eventMinHeight={isTimeGridView ? TIMEGRID_EVENT_MIN_HEIGHT_PX : undefined}
          eventShortHeight={isTimeGridView ? TIMEGRID_EVENT_MIN_HEIGHT_PX : undefined}
          height="auto"
          datesSet={isTimeGridView ? bumpTimeGridLayout : undefined}
          eventsSet={isTimeGridView ? bumpTimeGridLayout : undefined}
          viewDidMount={isTimeGridView ? bumpTimeGridLayout : undefined}
          weekends
          eventDisplay="block"
          fixedWeekCount={false}
          moreLinkClick="popover"
          moreLinkClassNames="!min-h-6 !h-6 !text-xs !px-2"
          events={fullCalendarEvents}
          eventContent={eventContentRenderer}
          eventDidMount={handleEventDidMount}
          eventWillUnmount={handleEventWillUnmount}
          dayCellClassNames={dayCellClassNames}
          eventClick={handleEventClick}
        />
      ) : null}
      {!isMobile && events.length === 0 ? <CalendarEmptyState /> : null}
    </div>
  );
}
