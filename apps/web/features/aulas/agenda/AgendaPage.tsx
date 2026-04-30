'use client';

import { useState } from 'react';
import {
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';

import { AGENDA_VIEW_OPTIONS } from '@/features/aulas/types';

import TableLayout from '@/components/layout/TableLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AgendaViewModeDTO, CalendarEventDetailsDTO, TimelineGroupByDTO } from '@/features/aulas/dtos';
import { useAgenda } from '@/features/aulas/agenda/hooks/use-agenda';
import { AgendaFilters } from '@/features/aulas/agenda/components/AgendaFilters';
import { CalendarEventDialog } from '@/features/aulas/agenda/components/CalendarEventDialog';
import { CalendarEventSheet } from '@/features/aulas/agenda/components/CalendarEventSheet';
import { AttendanceSheet } from '@/features/aulas/frequencia/components/AttendanceSheet';
import { CalendarScheduler } from '@/features/aulas/calendar/components/CalendarScheduler';
import { TimelineScheduler } from '@/features/aulas/calendar/components/TimelineScheduler';
import { Plus } from '@/components/icons/icons';
import type { AgendaFiltersState } from '@/features/aulas/agenda/hooks/use-agenda';

function buildRange(anchor: Date, viewMode: AgendaViewModeDTO) {
  if (viewMode === 'week') {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    return {
      start: start.toISOString(),
      end: endOfWeek(anchor, { weekStartsOn: 1 }).toISOString(),
    };
  }

  const start = startOfMonth(anchor);
  return {
    start: start.toISOString(),
    end: endOfMonth(anchor).toISOString(),
  };
}

function resolveTimelineAnchor(start?: string, end?: string) {
  if (!start || !end) {
    return startOfDay(new Date());
  }

  const rangeStart = startOfDay(new Date(start));
  const rangeEnd = endOfDay(new Date(end));
  const today = new Date();

  if (isWithinInterval(today, { start: rangeStart, end: rangeEnd })) {
    return startOfDay(today);
  }

  return rangeStart;
}

function buildTimelineRange(anchor: Date) {
  const start = startOfDay(anchor);
  return {
    start: start.toISOString(),
    end: endOfDay(start).toISOString(),
  };
}

type AgendaPageProps = {
  initialFilters?: Partial<AgendaFiltersState>;
};

export function AgendaPage({ initialFilters }: AgendaPageProps) {
  const calendarAgenda = useAgenda(initialFilters);
  const timelineInitialRange = buildTimelineRange(resolveTimelineAnchor(initialFilters?.start, initialFilters?.end));
  const timelineAgenda = useAgenda({
    ...initialFilters,
    ...timelineInitialRange,
    viewMode: 'week',
  });
  const [activeTab, setActiveTab] = useState<'calendar' | 'timeline'>('calendar');
  const [timelineGroupBy, setTimelineGroupBy] = useState<TimelineGroupByDTO>('professor');
  const [createOpen, setCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEventDetailsDTO | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);

  const activeAgenda = activeTab === 'calendar' ? calendarAgenda : timelineAgenda;
  const resources =
    activeAgenda.data?.data.resources ??
    calendarAgenda.data?.data.resources ??
    timelineAgenda.data?.data.resources ??
    { turmas: [], professores: [], salas: [] };
  const activeFilters = activeAgenda.filters;
  const calendarEvents = calendarAgenda.data?.data.events ?? [];
  const timelineEvents = timelineAgenda.data?.data.events ?? [];
  const activeLoading = activeAgenda.loading;
  const activeError = activeAgenda.error;

  function applySharedFilters(patch: Partial<AgendaFiltersState>) {
    calendarAgenda.setFilters((current) => ({ ...current, ...patch }));
    timelineAgenda.setFilters((current) => ({ ...current, ...patch }));
  }

  function handleNavigatePeriod(direction: 'prev' | 'next' | 'today') {
    if (activeTab === 'timeline') {
      const currentStart = new Date(timelineAgenda.filters.start);

      if (direction === 'today') {
        timelineAgenda.setFilters((current) => ({
          ...current,
          ...buildTimelineRange(new Date()),
        }));
        return;
      }

      const nextAnchor =
        direction === 'prev'
          ? new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() - 1)
          : new Date(currentStart.getFullYear(), currentStart.getMonth(), currentStart.getDate() + 1);
      timelineAgenda.setFilters((current) => ({
        ...current,
        ...buildTimelineRange(nextAnchor),
      }));
      return;
    }

    const currentStart = new Date(calendarAgenda.filters.start);

    if (direction === 'today') {
      const range = buildRange(new Date(), calendarAgenda.filters.viewMode);
      calendarAgenda.setFilters((current) => ({ ...current, ...range }));
      return;
    }

    if (calendarAgenda.filters.viewMode === 'week') {
      const nextAnchor = direction === 'prev' ? subWeeks(currentStart, 1) : addWeeks(currentStart, 1);
      calendarAgenda.setFilters((current) => ({ ...current, ...buildRange(nextAnchor, current.viewMode) }));
      return;
    }

    const nextAnchor = direction === 'prev' ? subMonths(currentStart, 1) : addMonths(currentStart, 1);
    calendarAgenda.setFilters((current) => ({ ...current, ...buildRange(nextAnchor, current.viewMode) }));
  }

  function handleViewModeChange(viewMode: AgendaViewModeDTO) {
    const nextAnchor = calendarAgenda.filters.start
      ? new Date(calendarAgenda.filters.start)
      : startOfDay(new Date());
    calendarAgenda.setFilters((current) => ({ ...current, viewMode, ...buildRange(nextAnchor, viewMode) }));
  }

  function handleEventSaved() {
    calendarAgenda.setFilters((current) => ({ ...current }));
    timelineAgenda.setFilters((current) => ({ ...current }));
  }

  return (
    <TableLayout
      title="Agenda"
      subtitle="Calendário centralizado da escola, com visão operacional por ocorrência."
      className="pr-4 xl:pr-6"
    >
      <div className="space-y-5">
        {activeError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {activeError}
          </div>
        ) : null}

        <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'calendar' | 'timeline')}>
            <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="rounded-xl bg-brand-accent text-white hover:bg-brand-accent/90"
                  onClick={() => setCreateOpen(true)}
                  data-testid="agenda-new-event"
                  disabled={activeLoading || (!calendarAgenda.data && !timelineAgenda.data)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Novo evento
                </Button>

                <TabsList className="h-9">
                  <TabsTrigger value="calendar" className="text-xs px-4">Calendário</TabsTrigger>
                  <TabsTrigger value="timeline" className="text-xs px-4">Timeline</TabsTrigger>
                </TabsList>

                {activeTab === 'calendar' ? (
                  <Tabs
                    value={calendarAgenda.filters.viewMode}
                    onValueChange={(value) => handleViewModeChange(value as AgendaViewModeDTO)}
                  >
                    <TabsList className="h-9">
                      {AGENDA_VIEW_OPTIONS.map((option) => (
                        <TabsTrigger key={option.value} value={option.value} className="text-xs px-4">
                          {option.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 xl:items-end">
                <AgendaFilters
                  embedded
                  showCurrentLabel={false}
                  filters={activeFilters}
                  resources={resources}
                  timelineGroupBy={activeTab === 'timeline' ? timelineGroupBy : undefined}
                  onTimelineGroupByChange={activeTab === 'timeline' ? setTimelineGroupBy : undefined}
                  onFiltersChange={applySharedFilters}
                  onNavigatePeriod={handleNavigatePeriod}
                />

              </div>
            </div>

            <TabsContent value="calendar" className="mt-0">
              {calendarAgenda.loading ? (
                <div className="px-6 py-12 text-sm text-slate-500">
                  Carregando calendário...
                </div>
              ) : (
                <CalendarScheduler
                  events={calendarEvents}
                  viewMode={calendarAgenda.filters.viewMode}
                  anchorDate={calendarAgenda.filters.start}
                  onEventSelect={setSelectedEventId}
                />
              )}
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              {timelineAgenda.loading ? (
                <div className="px-6 py-12 text-sm text-slate-500">
                  Carregando timeline...
                </div>
              ) : (
                <div className="p-4">
                  <TimelineScheduler
                    events={timelineEvents}
                    start={timelineAgenda.filters.start}
                    end={timelineAgenda.filters.end}
                    groupBy={timelineGroupBy}
                    onEventSelect={setSelectedEventId}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      <CalendarEventDialog
        open={createOpen}
        mode="create"
        resources={resources}
        onOpenChange={setCreateOpen}
        onSaved={handleEventSaved}
      />

      <CalendarEventDialog
        open={Boolean(editEvent)}
        mode="edit"
        resources={resources}
        initialEvent={editEvent}
        onOpenChange={(open) => {
          if (!open) setEditEvent(null);
        }}
        onSaved={() => {
          setEditEvent(null);
          handleEventSaved();
        }}
      />

      <CalendarEventSheet
        open={Boolean(selectedEventId)}
        eventId={selectedEventId}
        onOpenChange={(open) => {
          if (!open) setSelectedEventId(null);
        }}
        onRefresh={handleEventSaved}
        onRequestEdit={(event) => {
          setEditEvent(event);
          setSelectedEventId(null);
        }}
        onGoToAttendance={(eventId) => {
          setSelectedEventId(null);
          setAttendanceEventId(eventId);
        }}
      />

      <AttendanceSheet
        open={Boolean(attendanceEventId)}
        eventId={attendanceEventId}
        onOpenChange={(open) => {
          if (!open) setAttendanceEventId(null);
        }}
        onSaved={handleEventSaved}
      />
    </TableLayout>
  );
}
