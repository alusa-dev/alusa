'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
/** Luxon deve vir antes dos outros plugins para named IANA timeZone (docs FullCalendar). */
import luxonPlugin from '@fullcalendar/luxon3';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventContentArg, EventInput, EventMountArg } from '@fullcalendar/core';
import { useCallback, useLayoutEffect, useRef } from 'react';

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

const COLOR_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'border-purple-200 bg-purple-50 text-brand-accent',
  AULA_EXPERIMENTAL: 'border-sky-200 bg-sky-50 text-sky-800',
  REPOSICAO: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  EVENTO_INTERNO: 'border-amber-200 bg-amber-50 text-amber-800',
  EVENTO_EXTERNO: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
  WORKSHOP: 'border-rose-200 bg-rose-50 text-rose-800',
  FERIADO: 'border-slate-200 bg-slate-50 text-slate-700',
  PAUSA: 'border-orange-200 bg-orange-50 text-orange-800',
  CANCELAMENTO: 'border-red-200 bg-red-50 text-red-800',
  SUBSTITUICAO: 'border-cyan-200 bg-cyan-50 text-cyan-800',
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
            ? 'h-full rounded-full border px-2.5 py-1 text-[10px] leading-4'
            : 'h-full rounded-lg border px-2 py-1.5 text-[11px] leading-4',
          COLOR_BY_TYPE[type] ?? COLOR_BY_TYPE.AULA,
          cardTone === 'in_progress' && 'ring-1 ring-inset ring-brand-accent/20',
          cardTone === 'past' && 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
          cardTone === 'completed' && 'border-emerald-300 bg-emerald-100/80 text-emerald-900',
          cardTone === 'cancelled' && 'border-slate-200 bg-slate-100 text-slate-500',
        )}
      >
        {isCompactMonth ? (
          <div className="truncate font-medium">{arg.event.title}</div>
        ) : isWeekView ? (
          <div className="flex items-center gap-1.5 overflow-hidden text-[10px] font-medium leading-4">
            <span className="shrink-0 font-semibold opacity-80">{formatWeekEventTimeLabel(arg.timeText)}</span>
            <span className="truncate">{arg.event.title}</span>
          </div>
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
  const initialView = viewMode === 'week' ? 'timeGridWeek' : 'dayGridMonth';
  const isWeekView = viewMode === 'week';
  const isCompactMonth = viewMode === 'month-compact';
  const isDetailedMonth = viewMode === 'month-detailed';

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

  return (
    <div
      className={cn(
        'calendar-scheduler-wrapper bg-white',
        isWeekView && 'calendar-scheduler-wrapper--week',
        isCompactMonth && 'calendar-scheduler-wrapper--month-compact',
        isDetailedMonth && 'calendar-scheduler-wrapper--month-detailed',
      )}
    >
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
        events={events.map(toEventInput)}
        eventContent={renderEventContent(isCompactMonth, isWeekView)}
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
