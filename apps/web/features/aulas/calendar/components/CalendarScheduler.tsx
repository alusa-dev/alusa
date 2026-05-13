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
import {
  getCalendarEventCardTone,
  getCalendarEventTemporalBadge,
} from '@/features/aulas/utils/calendar-event-state';
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
const TIME_GRID_DAY_START_MINUTES = 6 * 60;
const TIME_GRID_DAY_END_MINUTES = 22 * 60;

function clampRatio(n: number) {
  return Math.max(0, Math.min(1, n));
}

function roundedMinutesFromPointerY(relY: number, areaHeightPx: number) {
  if (areaHeightPx <= 0) return TIME_GRID_DAY_START_MINUTES;
  const total = TIME_GRID_DAY_END_MINUTES - TIME_GRID_DAY_START_MINUTES;
  const pct = clampRatio(relY / areaHeightPx);
  const approx = TIME_GRID_DAY_START_MINUTES + pct * total;
  return Math.round(
    Math.min(TIME_GRID_DAY_END_MINUTES, Math.max(TIME_GRID_DAY_START_MINUTES, approx)),
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

/** Tons violeta/indigo derivados dos tokens `--brand-accent`, `--brand-primary` (globals). Sem traço. */
const COLOR_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'border-0 bg-[#EEE6F4] text-[#19143A]',
  AULA_EXPERIMENTAL: 'border-0 bg-[#EDE8FB] text-[#5c2f91]',
  REPOSICAO: 'border-0 bg-[#E8E4F9] text-[#3e1f63]',
  EVENTO_INTERNO: 'border-0 bg-[#F4EEFC] text-[#4b217a]',
  EVENTO_EXTERNO: 'border-0 bg-[#EFE7FA] text-[#602b96]',
  WORKSHOP: 'border-0 bg-[#F3EBFA] text-[#7243aa]',
  FERIADO: 'border-0 bg-[#ECEBF3] text-[#554f6d]',
  PAUSA: 'border-0 bg-[#EDE6F9] text-[#5c5277]',
  CANCELAMENTO: 'border-0 bg-[#EFE8EE] text-[#6b5570]',
  SUBSTITUICAO: 'border-0 bg-[#E8EAFA] text-[#382f7a]',
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
  const meta = teacher ?? room ?? null;
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
      </div>
      {showMetaLine && meta ? <div className="min-h-0 shrink-0 truncate text-[10px] opacity-80">{meta}</div> : null}
    </div>
  );
}

function buildEventTooltip(arg: EventMountArg) {
  const teacher = arg.event.extendedProps.professor as string | null;
  const room = arg.event.extendedProps.sala as string | null;
  const conflicts = Number(arg.event.extendedProps.conflicts ?? 0);
  const lines = [arg.event.title, arg.timeText].filter(Boolean);

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

function renderEventContent(isCompactMonth: boolean, isWeekView: boolean) {
  return function EventContent(arg: EventContentArg) {
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

    return (
      <div
        data-testid="calendar-event-card"
        data-event-id={arg.event.id}
        data-event-title={arg.event.title}
        className={cn(
          isCompactMonth
            ? 'h-full rounded-full border-0 px-2.5 py-1 text-[10px] leading-4'
            : 'h-full rounded-lg border-0 px-2 py-1.5 text-[11px] leading-4',
          COLOR_BY_TYPE[type] ?? COLOR_BY_TYPE.AULA,
          cardTone === 'in_progress' && 'shadow-[inset_0_0_0_1px_rgba(92,47,145,0.28)]',
          cardTone === 'past' && 'border-0 bg-[#EDE9F7]/85 text-brand-muted opacity-95',
          cardTone === 'completed' && 'border-0 bg-[#E8EAF3] text-[#3f4c66]',
          cardTone === 'cancelled' && 'border-0 bg-[#EDE9EF] text-brand-muted opacity-95',
        )}
      >
        {isCompactMonth ? (
          <div className="truncate font-medium">{arg.event.title}</div>
        ) : isWeekView ? (
          <WeekTimeGridEventContent arg={arg} />
        ) : (
          <>
            <div className="truncate font-medium">{`${arg.timeText} ${arg.event.title}`.trim()}</div>
            <div className="mt-1 flex items-center gap-2 text-[10px] opacity-80">
              <span className="truncate">{teacher || room || 'Sem recurso'}</span>
              {temporalBadge && temporalBadge.tone !== 'warning' ? <span>{temporalBadge.label}</span> : null}
              {conflicts > 0 ? <span>{conflicts} conflito(s)</span> : null}
            </div>
          </>
        )}
      </div>
    );
  };
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
  const isCompactMonth = viewMode === 'month-compact';
  const isDetailedMonth = viewMode === 'month-detailed';

  const fullCalendarEvents = useMemo(() => events.map(toEventInput), [events]);

  const eventContentRenderer = useMemo(
    () => renderEventContent(isCompactMonth, isWeekView),
    [isCompactMonth, isWeekView],
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

  useEffect(() => {
    if (!isWeekView) {
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
      const minsRounded = roundedMinutesFromPointerY(relY, srSlots.height);
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
  }, [isWeekView]);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'calendar-scheduler-wrapper bg-white',
        isWeekView && 'calendar-scheduler-wrapper--week',
        isCompactMonth && 'calendar-scheduler-wrapper--month-compact',
        isDetailedMonth && 'calendar-scheduler-wrapper--month-detailed',
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
      <FullCalendar
        ref={calendarRef}
        key={`${viewMode}:${anchorDate}:${timeZone}`}
        plugins={[luxonPlugin, dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={initialView}
        initialDate={anchorDate}
        locale="pt-br"
        timeZone={timeZone}
        headerToolbar={false}
        dayMaxEventRows={viewMode === 'month-detailed' ? 4 : viewMode === 'month-compact' ? 6 : 3}
        eventMaxStack={isWeekView ? 2 : undefined}
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
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
        }}
        dayCellClassNames={() =>
          isCompactMonth
            ? ['calendar-scheduler-day-compact']
            : isDetailedMonth
              ? ['calendar-scheduler-day-detailed']
              : []
        }
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          onEventSelect(info.event.id);
        }}
      />
    </div>
  );
}
