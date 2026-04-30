'use client';

import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { EventContentArg, EventInput } from '@fullcalendar/core';

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
  onEventSelect: (_eventId: string) => void;
};

const COLOR_BY_TYPE: Record<CalendarEventListItemDTO['type'], string> = {
  AULA: 'border-purple-200 bg-purple-50 text-brand-accent',
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

function renderEventContent(isCompactMonth: boolean) {
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
  onEventSelect,
}: CalendarSchedulerProps) {
  const initialView = viewMode === 'week' ? 'timeGridWeek' : 'dayGridMonth';
  const isCompactMonth = viewMode === 'month-compact';
  const isDetailedMonth = viewMode === 'month-detailed';

  return (
    <div
      className={cn(
        'calendar-scheduler-wrapper bg-white',
        isCompactMonth && 'calendar-scheduler-wrapper--month-compact',
        isDetailedMonth && 'calendar-scheduler-wrapper--month-detailed',
      )}
    >
      <FullCalendar
        key={`${viewMode}:${anchorDate}`}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={initialView}
        initialDate={anchorDate}
        locale="pt-br"
        headerToolbar={false}
        dayMaxEventRows={viewMode === 'month-detailed' ? 4 : viewMode === 'month-compact' ? 6 : 3}
        allDaySlot={false}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        height="auto"
        weekends
        eventDisplay="block"
        fixedWeekCount={false}
        events={events.map(toEventInput)}
        eventContent={renderEventContent(isCompactMonth)}
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
