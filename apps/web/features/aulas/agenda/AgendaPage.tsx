'use client';

import dynamic from 'next/dynamic';
import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { TZDateMini } from '@date-fns/tz';
import { addDays, addMonths } from 'date-fns';

import { AGENDA_VIEW_OPTIONS } from '@/features/aulas/types';

import TableLayout from '@/components/layout/TableLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AgendaViewModeDTO, CalendarEventDetailsDTO } from '@/features/aulas/dtos';
import { useAgenda } from '@/features/aulas/agenda/hooks/use-agenda';
import { AgendaFilters } from '@/features/aulas/agenda/components/AgendaFilters';
import { listAgendaResources, type AgendaResourcesResult } from '@/features/aulas/agenda/services/agenda-resources-service';
import { CalendarScheduler } from '@/features/aulas/calendar/components/CalendarScheduler';
import { ChevronDown, Plus } from '@/components/icons/icons';
import type { AgendaFiltersState } from '@/features/aulas/agenda/hooks/use-agenda';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  buildZonedAgendaRangeIso,
  startOfZonedDayClient,
} from '@/lib/agenda-timezone';

const CalendarEventDialog = dynamic(
  () =>
    import('@/features/aulas/agenda/components/CalendarEventDialog').then((m) => ({
      default: m.CalendarEventDialog,
    })),
  { ssr: false },
);

const CalendarEventSheet = dynamic(
  () =>
    import('@/features/aulas/agenda/components/CalendarEventSheet').then((m) => ({
      default: m.CalendarEventSheet,
    })),
  { ssr: false },
);

const AttendanceSheet = dynamic(
  () =>
    import('@/features/aulas/frequencia/components/AttendanceSheet').then((m) => ({
      default: m.AttendanceSheet,
    })),
  { ssr: false },
);

const ExperimentalClassDialog = dynamic(
  () =>
    import('@/features/aulas/experimentais/components/ExperimentalClassDialog').then((m) => ({
      default: m.ExperimentalClassDialog,
    })),
  { ssr: false },
);

const MakeupClassDialog = dynamic(
  () =>
    import('@/features/aulas/reposicoes/components/MakeupClassDialog').then((m) => ({
      default: m.MakeupClassDialog,
    })),
  { ssr: false },
);

const EMPTY_RESOURCES: AgendaResourcesResult = {
  turmas: [],
  professores: [],
  salas: [],
};

type AgendaPageProps = {
  initialFilters?: Partial<AgendaFiltersState>;
};

export function AgendaPage({ initialFilters }: AgendaPageProps) {
  const calendarAgenda = useAgenda(initialFilters);
  const [createOpen, setCreateOpen] = useState(false);
  const [experimentalCreateOpen, setExperimentalCreateOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<CalendarEventDetailsDTO | null>(null);
  const [editExperimentalEvent, setEditExperimentalEvent] = useState<CalendarEventDetailsDTO | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [resources, setResources] = useState<AgendaResourcesResult>(EMPTY_RESOURCES);
  const [makeupResources, setMakeupResources] = useState<{
    turmas: AgendaResourcesResult['turmas'];
    alunos: Array<{ id: string; label: string }>;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [loadingMakeupResources, setLoadingMakeupResources] = useState(false);

  const filters = calendarAgenda.filters;
  const calendarEvents = useDeferredValue(calendarAgenda.data?.data.events ?? []);
  const calendarLoading = calendarAgenda.loading;
  const calendarError = calendarAgenda.error;

  const accountTimeZone = calendarAgenda.data?.data.timeZone ?? DEFAULT_ACCOUNT_TIMEZONE;

  useEffect(() => {
    const today = new Date();
    const tz = DEFAULT_ACCOUNT_TIMEZONE;

    calendarAgenda.setFilters((current) => ({
      ...current,
      ...buildZonedAgendaRangeIso(today, current.viewMode, tz),
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setResourcesError(null);
        const nextResources = await listAgendaResources();

        if (!cancelled) {
          setResources(nextResources);
        }
      } catch (err) {
        if (!cancelled) {
          setResourcesError((err as Error).message);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyFilters(patch: Partial<AgendaFiltersState>) {
    startTransition(() => {
      calendarAgenda.setFilters((current) => ({ ...current, ...patch }));
    });
  }

  function handleNavigatePeriod(direction: 'prev' | 'next' | 'today') {
    const currentStart = new Date(calendarAgenda.filters.start);

    if (direction === 'today') {
      const range = buildZonedAgendaRangeIso(new Date(), calendarAgenda.filters.viewMode, accountTimeZone);
      startTransition(() => {
        calendarAgenda.setFilters((current) => ({ ...current, ...range }));
      });
      return;
    }

    if (calendarAgenda.filters.viewMode === 'week') {
      const z = new TZDateMini(currentStart.getTime(), accountTimeZone);
      const shifted = addDays(z, direction === 'prev' ? -7 : 7);
      const nextAnchor = new Date(shifted.getTime());
      startTransition(() => {
        calendarAgenda.setFilters((current) => ({
          ...current,
          ...buildZonedAgendaRangeIso(nextAnchor, current.viewMode, accountTimeZone),
        }));
      });
      return;
    }

    const z = new TZDateMini(currentStart.getTime(), accountTimeZone);
    const shifted = addMonths(z, direction === 'prev' ? -1 : 1);
    const nextAnchor = new Date(shifted.getTime());
    startTransition(() => {
      calendarAgenda.setFilters((current) => ({
        ...current,
        ...buildZonedAgendaRangeIso(nextAnchor, current.viewMode, accountTimeZone),
      }));
    });
  }

  function handleViewModeChange(viewMode: AgendaViewModeDTO) {
    const nextAnchor = calendarAgenda.filters.start
      ? new Date(calendarAgenda.filters.start)
      : startOfZonedDayClient(new Date(), accountTimeZone);
    startTransition(() => {
      calendarAgenda.setFilters((current) => ({
        ...current,
        viewMode,
        ...buildZonedAgendaRangeIso(nextAnchor, viewMode, accountTimeZone),
      }));
    });
  }

  function handleEventSaved() {
    startTransition(() => {
      calendarAgenda.refresh();
    });
  }

  async function handleOpenMakeupDialog() {
    try {
      setActionError(null);

      if (!makeupResources) {
        setLoadingMakeupResources(true);
        const nextResources = await listAgendaResources({ includeAlunos: true });
        setMakeupResources({
          turmas: nextResources.turmas,
          alunos: nextResources.alunos ?? [],
        });
      }

      setMakeupOpen(true);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setLoadingMakeupResources(false);
    }
  }

  return (
    <TableLayout
      title="Agenda"
      subtitle="Calendário centralizado da escola, com visão operacional por ocorrência."
      className="pr-4 xl:pr-6"
    >
      <div className="space-y-5">
        {calendarError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {calendarError}
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        {resourcesError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {resourcesError}
          </div>
        ) : null}

        <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="inline-flex overflow-hidden rounded-xl shadow-sm">
                <Button
                  className="rounded-none rounded-l-xl bg-brand-accent text-white hover:bg-brand-accent/90"
                  onClick={() => setCreateOpen(true)}
                  data-testid="agenda-new-event"
                  disabled={calendarLoading || !calendarAgenda.data}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Novo evento
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Abrir ações de criação da agenda"
                      className="rounded-none rounded-r-xl border-l border-white/20 bg-brand-accent px-3 text-white hover:bg-brand-accent/90"
                      data-testid="agenda-create-menu-trigger"
                      disabled={
                        calendarLoading ||
                        !calendarAgenda.data ||
                        loadingMakeupResources
                      }
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuItem
                      onSelect={() => {
                        setExperimentalCreateOpen(true);
                      }}
                    >
                      Aula experimental
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleOpenMakeupDialog()}>
                      {loadingMakeupResources ? 'Carregando reposição...' : 'Reposição'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

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
            </div>

            <div className="flex flex-col gap-3 xl:items-end">
              <AgendaFilters
                embedded
                showCurrentLabel={false}
                filters={filters}
                resources={resources}
                timeZone={accountTimeZone}
                onFiltersChange={applyFilters}
                onNavigatePeriod={handleNavigatePeriod}
              />

            </div>
          </div>

          <div className="mt-0">
            {calendarLoading ? (
              <div className="px-6 py-12 text-sm text-slate-500">
                Carregando calendário...
              </div>
            ) : (
              <CalendarScheduler
                events={calendarEvents}
                viewMode={calendarAgenda.filters.viewMode}
                anchorDate={calendarAgenda.filters.start}
                timeZone={accountTimeZone}
                onEventSelect={setSelectedEventId}
              />
            )}
          </div>
        </Card>
      </div>

      <CalendarEventDialog
        open={createOpen}
        mode="create"
        resources={resources}
        accountTimeZone={accountTimeZone}
        onOpenChange={setCreateOpen}
        onSaved={handleEventSaved}
      />

      <CalendarEventDialog
        open={Boolean(editEvent)}
        mode="edit"
        resources={resources}
        accountTimeZone={accountTimeZone}
        initialEvent={editEvent}
        onOpenChange={(open) => {
          if (!open) setEditEvent(null);
        }}
        onSaved={() => {
          setEditEvent(null);
          handleEventSaved();
        }}
      />

      <ExperimentalClassDialog
        open={experimentalCreateOpen}
        mode="create"
        resources={resources}
        accountTimeZone={accountTimeZone}
        onOpenChange={setExperimentalCreateOpen}
        onSaved={handleEventSaved}
      />

      <ExperimentalClassDialog
        open={Boolean(editExperimentalEvent)}
        mode="edit"
        resources={resources}
        accountTimeZone={accountTimeZone}
        initialEvent={editExperimentalEvent}
        onOpenChange={(open) => {
          if (!open) setEditExperimentalEvent(null);
        }}
        onSaved={() => {
          setEditExperimentalEvent(null);
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
          if (event.type === 'AULA_EXPERIMENTAL') {
            setEditExperimentalEvent(event);
          } else {
            setEditEvent(event);
          }
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

      <MakeupClassDialog
        open={makeupOpen}
        resources={makeupResources ?? { turmas: [], alunos: [] }}
        accountTimeZone={accountTimeZone}
        onOpenChange={setMakeupOpen}
        onSaved={handleEventSaved}
      />
    </TableLayout>
  );
}
