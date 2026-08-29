'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
/** Luxon deve vir antes dos outros plugins para named IANA timeZone (docs FullCalendar). */
import luxonPlugin from '@fullcalendar/luxon3';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventContentArg, EventInput, EventMountArg } from '@fullcalendar/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { AgendaViewModeDTO, CalendarEventListItemDTO } from '@/features/aulas/dtos';
import { CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/aulas/types';
import {
  getCalendarEventCardTone,
  getCalendarEventTemporalBadge,
} from '@/features/aulas/utils/calendar-event-state';
import {
  formatAgendaDayLabel,
  formatAgendaTimeLabel,
  getZonedMinutesFromMidnight,
} from '@/lib/agenda-timezone';
import { cn } from '@/lib/utils';

type CalendarSchedulerProps = {
  events: CalendarEventListItemDTO[];
  viewMode: AgendaViewModeDTO;
  anchorDate: string;
  /** IANA zone da conta — mantém grades alinhadas ao servidor após correção de fuso */
  timeZone: string;
  onEventSelect: (_eventId: string) => void;
};

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
  AULA: 'border-0 bg-[color:var(--calendar-event-aula-bg)] text-[color:var(--calendar-event-aula-fg)]',
  AULA_EXPERIMENTAL: 'border-0 bg-[color:var(--calendar-event-experimental-bg)] text-[color:var(--calendar-event-experimental-fg)]',
  REPOSICAO: 'border-0 bg-[color:var(--calendar-event-makeup-bg)] text-[color:var(--calendar-event-makeup-fg)]',
  EVENTO_INTERNO: 'border-0 bg-[color:var(--calendar-event-internal-bg)] text-[color:var(--calendar-event-internal-fg)]',
  EVENTO_EXTERNO: 'border-0 bg-[color:var(--calendar-event-external-bg)] text-[color:var(--calendar-event-external-fg)]',
  WORKSHOP: 'border-0 bg-[color:var(--calendar-event-workshop-bg)] text-[color:var(--calendar-event-workshop-fg)]',
  FERIADO: 'border-0 bg-[color:var(--calendar-event-holiday-bg)] text-[color:var(--calendar-event-holiday-fg)]',
  PAUSA: 'border-0 bg-[color:var(--calendar-event-break-bg)] text-[color:var(--calendar-event-break-fg)]',
  CANCELAMENTO: 'border-0 bg-[color:var(--calendar-event-cancellation-bg)] text-[color:var(--calendar-event-cancellation-fg)]',
  SUBSTITUICAO: 'border-0 bg-[color:var(--calendar-event-substitution-bg)] text-[color:var(--calendar-event-substitution-fg)]',
};

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
      conflicts: event.conflicts.length,
      compactTitle: event.title,
    },
  };
}

function formatWeekEventTimeLabel(timeText: string) {
  const normalized = timeText.trim();
  if (!normalized) return '';

  return normalized.split(' - ')[0] ?? normalized;
}

/** Acima do eventShortHeight/minHeight (22px): espaço para título + meta sem compressão excessiva */
const WEEK_EVENT_META_VISIBLE_MIN_HEIGHT_PX = 40;

function WeekTimeGridEventContent({ arg }: { arg: EventContentArg }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const teacher = arg.event.extendedProps.professor as string | null;
  const room = arg.event.extendedProps.sala as string | null;
  const turma = arg.event.extendedProps.turma as string | null;
  const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
  const status = arg.event.extendedProps.status as CalendarEventListItemDTO['status'];
  const eventState = {
    status,
    startAt: arg.event.extendedProps.startAt as string,
    endAt: arg.event.extendedProps.endAt as string,
  };
  const temporalBadge = getCalendarEventTemporalBadge(eventState);
  const meta = [teacher, room].filter(Boolean).join(' · ') || turma;
  const [showMetaLine, setShowMetaLine] = useState(false);

  useLayoutEffect(() => {
    if (!meta) {
      setShowMetaLine(false);
      return;
    }

    const el = rootRef.current;
    if (!el) return;

    const sync = () => {
      const h = el.getBoundingClientRect().height;
      setShowMetaLine(h >= WEEK_EVENT_META_VISIBLE_MIN_HEIGHT_PX);
    };

    if (typeof ResizeObserver === 'undefined') {
      sync();
      return;
    }

    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      setShowMetaLine(h >= WEEK_EVENT_META_VISIBLE_MIN_HEIGHT_PX);
    });

    ro.observe(el);
    sync();

    return () => ro.disconnect();
  }, [meta]);

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col gap-0.5 overflow-hidden text-[10px] font-medium leading-snug"
    >
      <div className="flex min-h-0 shrink-0 items-center gap-1.5 overflow-hidden">
        <span className="shrink-0 font-semibold opacity-80">{formatWeekEventTimeLabel(arg.timeText)}</span>
        <span className="min-w-0 truncate">{arg.event.title}</span>
        {conflicts > 0 ? (
          <span
            className="shrink-0 rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-4 text-white"
            title={`${conflicts} conflito(s) de agenda`}
            aria-label={`${conflicts} conflito(s) de agenda`}
          >
            !
          </span>
        ) : null}
      </div>
      {showMetaLine && meta ? (
        <div className="flex min-h-0 shrink-0 items-center gap-1 truncate text-[10px] opacity-80">
          <span className="truncate">{meta}</span>
          {temporalBadge ? <span className="shrink-0">· {temporalBadge.label}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function buildEventTooltip(arg: EventMountArg) {
  const teacher = arg.event.extendedProps.professor as string | null;
  const room = arg.event.extendedProps.sala as string | null;
  const turma = arg.event.extendedProps.turma as string | null;
  const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
  const lines = [arg.event.title, arg.timeText].filter(Boolean);

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

  return lines.join('\n');
}

function renderEventContent(isWeekView: boolean) {
  return function EventContent(arg: EventContentArg) {
    const type = arg.event.extendedProps.type as CalendarEventListItemDTO['type'];
    const teacher = arg.event.extendedProps.professor as string | null;
    const room = arg.event.extendedProps.sala as string | null;
    const turma = arg.event.extendedProps.turma as string | null;
    const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
    const eventState = {
      status: arg.event.extendedProps.status as CalendarEventListItemDTO['status'],
      startAt: arg.event.extendedProps.startAt as string,
      endAt: arg.event.extendedProps.endAt as string,
    };
    const temporalBadge = getCalendarEventTemporalBadge(eventState);
    const cardTone = getCalendarEventCardTone(eventState);

    return (
      <div
        data-testid="calendar-event-card"
        data-event-id={arg.event.id}
        data-event-title={arg.event.title}
        className={cn(
          'h-full rounded-lg border-0 px-2 py-1.5 text-[11px] leading-4',
          COLOR_BY_TYPE[type] ?? COLOR_BY_TYPE.AULA,
          cardTone === 'in_progress' && 'shadow-[inset_0_0_0_1px_rgba(92,47,145,0.28)]',
          cardTone === 'past' && 'border-0 bg-[color:var(--calendar-event-past-bg)] text-brand-muted opacity-95',
          cardTone === 'completed' && 'border-0 bg-[color:var(--calendar-event-completed-bg)] text-[color:var(--calendar-event-completed-fg)]',
          cardTone === 'cancelled' && 'border-0 bg-[color:var(--calendar-event-cancellation-bg)] text-brand-muted opacity-95',
        )}
        data-event-status={eventState.status}
        data-event-type={type}
        aria-label={`${arg.event.title}, ${arg.timeText}, ${EVENT_TYPE_LABELS[type]}, ${EVENT_STATUS_LABELS[eventState.status]}`}
      >
        {isWeekView ? (
          <WeekTimeGridEventContent arg={arg} />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1.5 truncate font-medium">
              <span className="truncate">{`${arg.timeText} ${arg.event.title}`.trim()}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] opacity-80">
              <span className="truncate">{[turma, teacher, room].filter(Boolean).join(' · ') || 'Sem recurso'}</span>
              {temporalBadge ? <span className="shrink-0">{temporalBadge.label}</span> : null}
              {eventState.status !== 'AGENDADO' ? (
                <span className="shrink-0">{EVENT_STATUS_LABELS[eventState.status]}</span>
              ) : null}
              {conflicts > 0 ? <span className="shrink-0 font-semibold text-amber-700">! {conflicts}</span> : null}
            </div>
          </>
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
  timeZone,
  onEventSelect,
}: {
  events: CalendarEventListItemDTO[];
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
      <div className="flex min-h-[360px] items-center justify-center px-6">
        <div className="max-w-xs text-center">
          <p className="text-sm font-semibold text-slate-700">Nenhum evento neste período</p>
          <p className="mt-1 text-xs text-slate-500">Ajuste os filtros ou crie um novo evento para começar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4" data-testid="agenda-mobile-list">
      {groups.map(([dayLabel, dayEvents], groupIndex) => (
        <section key={dayLabel} aria-labelledby={`agenda-day-${groupIndex}`}>
          <h3
            id={`agenda-day-${groupIndex}`}
            className="mb-2 border-b border-slate-100 pb-2 text-xs font-semibold capitalize tracking-wide text-slate-500"
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
                      'w-full rounded-xl border border-slate-200 border-l-4 bg-white px-3 py-3 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      tone === 'cancelled' && 'border-l-rose-400 bg-rose-50/40',
                      tone === 'completed' && 'border-l-emerald-400 bg-emerald-50/40',
                      tone === 'in_progress' && 'border-l-primary bg-violet-50/50',
                      tone === 'past' && 'border-l-slate-300 opacity-80',
                    )}
                    aria-label={`${event.title}, ${formatAgendaTimeLabel(event.startAt, timeZone)}, ${EVENT_TYPE_LABELS[event.type]}`}
                    onClick={() => onEventSelect(event.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-500">
                          {formatAgendaTimeLabel(event.startAt, timeZone)}–{formatAgendaTimeLabel(event.endAt, timeZone)}
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{event.title}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{resources || 'Sem recurso vinculado'}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                        {EVENT_TYPE_LABELS[event.type]}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium">
                      {temporalBadge ? <span className="text-primary">{temporalBadge.label}</span> : null}
                      {event.status !== 'AGENDADO' ? (
                        <span className="text-slate-500">{EVENT_STATUS_LABELS[event.status]}</span>
                      ) : null}
                      {event.conflicts.length > 0 ? (
                        <span className="text-amber-700">{event.conflicts.length} conflito(s)</span>
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
}: CalendarSchedulerProps) {
  const calendarRef = useRef<FullCalendar>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialView = viewMode === 'week' ? 'timeGridWeek' : 'dayGridMonth';
  const isWeekView = viewMode === 'week';
  const isDetailedMonth = !isWeekView;
  const isMobile = useIsMobileCalendar();
  const timeGridBounds = useMemo(() => getTimeGridBounds(events, timeZone), [events, timeZone]);

  const fullCalendarEvents = useMemo(() => events.map(toEventInput), [events]);

  const eventContentRenderer = useMemo(
    () => renderEventContent(isWeekView),
    [isWeekView],
  );

  /** timeGrid + height:auto: garantir medida estável dos slats após paint (sub-hora / :30). */
  const bumpTimeGridLayout = useCallback(() => {
    if (!isWeekView) return;
    const api = calendarRef.current?.getApi();
    if (!api) return;
    requestAnimationFrame(() => {
      api.updateSize();
      // Segundo tick: Tabs/parent flex às vezes só estabiliza dimensões depois do primeiro frame.
      requestAnimationFrame(() => {
        api.updateSize();
      });
    });
  }, [isWeekView]);

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

  const [hoverGuide, setHoverGuide] = useState<HoverGuideState | null>(null);

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

    function onPointerMove(ev: PointerEvent) {
      const host = wrapperRef.current;
      if (!host) return;

      const slotsEl = host.querySelector('.fc-timegrid-slots') as HTMLElement | null;
      const colsEl = host.querySelector('.fc-timegrid-cols') as HTMLElement | null;
      if (!slotsEl) {
        setHoverGuide(null);
        return;
      }

      const srSlots = slotsEl.getBoundingClientRect();
      const colsRect = colsEl?.getBoundingClientRect();

      const lineLeft =
        colsRect &&
        colsRect.height >= 40 &&
        colsRect.width >= 48 &&
        Number.isFinite(colsRect.right - colsRect.left)
          ? colsRect.left
          : srSlots.left;
      const lineRight =
        colsRect &&
        colsRect.height >= 40 &&
        colsRect.width >= 48 &&
        Number.isFinite(colsRect.right - colsRect.left)
          ? colsRect.right
          : srSlots.right;

      const axisEl = host.querySelector('.fc-timegrid-body .fc-timegrid-axis') as HTMLElement | null;
      const axisRect = axisEl?.getBoundingClientRect();
      const hitLeft = axisRect && axisRect.width > 10 ? axisRect.left : lineLeft;

      const x = ev.clientX;
      const y = ev.clientY;

      if (
        x < hitLeft ||
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

      const badgeLeftViewport = axisRect
        ? axisRect.right - Math.min(Math.max(32, axisRect.width * 0.55), 48)
        : Math.max(lineLeft - 52, 4);

      setHoverGuide({
        lineLeft,
        lineRight,
        lineCenterY,
        badgeLeftViewport,
        timeLabel,
      });
    }

    /** Captura garante atualização mesmo com o cursor sobre fc-event */
    root.addEventListener('pointermove', onPointerMove, true);
    root.addEventListener('pointerleave', hideGuide);
    root.addEventListener('pointercancel', hideGuide);

    return () => {
      root.removeEventListener('pointermove', onPointerMove, true);
      root.removeEventListener('pointerleave', hideGuide);
      root.removeEventListener('pointercancel', hideGuide);
    };
  }, [isMobile, isWeekView, timeGridBounds]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'calendar-scheduler-wrapper relative bg-white alusa-dark:bg-[color:var(--color-bg-card)]',
        isWeekView && 'calendar-scheduler-wrapper--week',
        isDetailedMonth && 'calendar-scheduler-wrapper--month-detailed',
        isMobile && 'calendar-scheduler-wrapper--mobile',
      )}
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
            aria-hidden
            className="fixed z-[61] box-border size-2 shrink-0 rounded-full bg-[color:var(--brand-accent)] shadow-[0_1px_3px_rgba(25,20,58,0.35)]"
            style={{
              left: hoverGuide.lineRight - 4,
              top: hoverGuide.lineCenterY,
              transform: 'translate(-50%, -50%)',
            }}
          />
          <div
            className="fixed z-[62] whitespace-nowrap rounded-full bg-[color:var(--brand-accent)] px-2.5 py-1 text-[11px] font-semibold leading-none text-white shadow-[0_2px_8px_rgba(25,20,58,0.28)]"
            style={{
              left: Math.max(hoverGuide.badgeLeftViewport, 4),
              top: hoverGuide.lineCenterY,
              transform: 'translate(0, -50%)',
            }}
          >
            {hoverGuide.timeLabel}
          </div>
        </div>
      ) : null}
      {isMobile ? (
        <MobileAgendaList events={events} timeZone={timeZone} onEventSelect={onEventSelect} />
      ) : calendarPaintReady ? (
        <FullCalendar
          ref={calendarRef}
          key={`${viewMode}:${anchorDate}:${timeZone}`}
          plugins={[luxonPlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView={initialView}
          initialDate={anchorDate}
          locale="pt-br"
          timeZone={timeZone}
          firstDay={0}
          headerToolbar={false}
          dayMaxEventRows={isWeekView ? 3 : 4}
          eventMaxStack={isWeekView ? 2 : undefined}
          allDaySlot={false}
          slotMinTime={formatTimeGridOption(timeGridBounds.startMinutes)}
          slotMaxTime={formatTimeGridOption(timeGridBounds.endMinutes)}
          slotDuration={isWeekView ? '00:30:00' : undefined}
          slotLabelInterval={isWeekView ? '01:00:00' : undefined}
          expandRows={isWeekView}
          slotEventOverlap={!isWeekView}
          eventMinHeight={isWeekView ? 22 : undefined}
          eventShortHeight={isWeekView ? 22 : undefined}
          height="auto"
          datesSet={isWeekView ? bumpTimeGridLayout : undefined}
          eventsSet={isWeekView ? bumpTimeGridLayout : undefined}
          viewDidMount={isWeekView ? bumpTimeGridLayout : undefined}
          weekends
          eventDisplay="block"
          fixedWeekCount={false}
          moreLinkClick="popover"
          events={fullCalendarEvents}
          eventContent={eventContentRenderer}
          eventDidMount={(arg) => {
            arg.el.title = buildEventTooltip(arg);
            arg.el.setAttribute('aria-label', buildEventTooltip(arg).replaceAll('\n', ', '));
          }}
          dayCellClassNames={() =>
            isDetailedMonth ? ['calendar-scheduler-day-detailed'] : []
          }
          eventClick={(info) => {
            info.jsEvent.preventDefault();
            onEventSelect(info.event.id);
          }}
        />
      ) : null}
      {!isMobile && events.length === 0 ? <CalendarEmptyState /> : null}
    </div>
  );
}
