'use client';

import dynamic from 'next/dynamic';
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';

import { AGENDA_VIEW_OPTIONS } from '@/features/lessons/types';

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
import type { AgendaViewModeDTO, CalendarEventDetailsDTO } from '@/features/lessons/dtos';
import { useAgenda } from '@/features/lessons/agenda/hooks/use-agenda';
import { AgendaFilters } from '@/features/lessons/agenda/components/AgendaFilters';
import { listAgendaResources, type AgendaResourcesResult } from '@/features/lessons/agenda/services/agenda-resources-service';

const CalendarScheduler = dynamic(
  () =>
    import('@/features/lessons/calendar/components/CalendarScheduler').then((m) => ({
      default: m.CalendarScheduler,
    })),
  { ssr: false, loading: () => <div className="min-h-[480px] animate-pulse rounded-xl bg-muted/40" /> },
);
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from '@/components/icons/icons';
import { mergeAgendaFilters, type AgendaFiltersState } from '@/features/lessons/agenda/hooks/use-agenda';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  buildZonedAgendaRangeIso,
  formatAgendaPeriodLabel,
  shiftZonedAgendaAnchor,
} from '@/lib/agenda-timezone';

const CalendarEventDialog = dynamic(
  () =>
    import('@/features/lessons/agenda/components/CalendarEventDialog').then((m) => ({
      default: m.CalendarEventDialog,
    })),
  { ssr: false },
);

const CalendarEventSheet = dynamic(
  () =>
    import('@/features/lessons/agenda/components/CalendarEventSheet').then((m) => ({
      default: m.CalendarEventSheet,
    })),
  { ssr: false },
);

const AttendanceSheet = dynamic(
  () =>
    import('@/features/lessons/attendance/components/AttendanceSheet').then((m) => ({
      default: m.AttendanceSheet,
    })),
  { ssr: false },
);

const ExperimentalClassDialog = dynamic(
  () =>
    import('@/features/lessons/experimental-classes/components/ExperimentalClassDialog').then((m) => ({
      default: m.ExperimentalClassDialog,
    })),
  { ssr: false },
);

const MakeupClassDialog = dynamic(
  () =>
    import('@/features/lessons/makeups/components/MakeupClassDialog').then((m) => ({
      default: m.MakeupClassDialog,
    })),
  { ssr: false },
);

const EMPTY_RESOURCES: AgendaResourcesResult = {
  turmas: [],
  professores: [],
  salas: [],
};

function CalendarLoadingState() {
  return (
    <div
      className="min-h-[520px] space-y-4 p-4 sm:p-6"
      aria-busy="true"
      aria-live="polite"
      data-testid="agenda-calendar-loading"
    >
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-100 bg-slate-100">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-11 bg-slate-50/80" />
          ))}
        </div>
        <div className="mt-3 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[42px_repeat(7,minmax(0,1fr))] gap-px">
              <div className="h-10 rounded bg-slate-100/70" />
              {Array.from({ length: 7 }).map((__, dayIndex) => (
                <div key={dayIndex} className="h-10 bg-slate-50/50" />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 sm:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2 rounded-xl border border-slate-100 p-3">
            <div className="h-4 w-1/3 rounded bg-slate-100" />
            <div className="h-5 w-3/4 rounded bg-slate-100/80" />
            <div className="h-4 w-1/2 rounded bg-slate-50" />
          </div>
        ))}
      </div>
      <p className="text-center text-sm text-slate-500">Carregando calendário...</p>
    </div>
  );
}

function CalendarErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-rose-50 p-3 text-rose-600">
        <span aria-hidden className="text-xl">!</span>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Não foi possível carregar a agenda</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">Tente novamente para atualizar os eventos deste período.</p>
      </div>
      <Button type="button" variant="outline" className="rounded-xl" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

type AgendaPageProps = {
  initialFilters?: Partial<AgendaFiltersState>;
};

export function AgendaPage({ initialFilters }: AgendaPageProps) {
  const calendarAgenda = useAgenda(initialFilters);
  const viewAnchorRef = useRef(
    initialFilters?.start ? new Date(initialFilters.start) : new Date(),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<{ startAt: string; endAt: string; allDay: boolean } | null>(null);
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
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [loadingMakeupResources, setLoadingMakeupResources] = useState(false);

  const filters = calendarAgenda.filters;
  const calendarEvents = calendarAgenda.data?.data.events ?? [];
  const calendarLoading = calendarAgenda.loading;
  const calendarError = calendarAgenda.error;

  const accountTimeZone = calendarAgenda.data?.data.timeZone ?? DEFAULT_ACCOUNT_TIMEZONE;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setResourcesError(null);
        setResourcesLoading(true);
        const nextResources = await listAgendaResources();

        if (!cancelled) {
          setResources(nextResources);
        }
      } catch (err) {
        if (!cancelled) {
          setResourcesError((err as Error).message);
        }
      } finally {
        if (!cancelled) setResourcesLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyFilters(patch: Partial<AgendaFiltersState>) {
    startTransition(() => {
      calendarAgenda.setFilters((current) => mergeAgendaFilters(current, patch));
    });
  }

  function handleNavigatePeriod(direction: 'prev' | 'next' | 'today') {
    if (direction === 'today') {
      const anchor = new Date();
      viewAnchorRef.current = anchor;
      const range = buildZonedAgendaRangeIso(anchor, calendarAgenda.filters.viewMode, accountTimeZone);
      startTransition(() => {
        calendarAgenda.setFilters((current) => ({ ...current, ...range }));
      });
      return;
    }

    const nextAnchor = shiftZonedAgendaAnchor(
      viewAnchorRef.current,
      calendarAgenda.filters.viewMode,
      direction,
      accountTimeZone,
    );
    viewAnchorRef.current = nextAnchor;
    startTransition(() => {
      calendarAgenda.setFilters((current) => ({
        ...current,
        ...buildZonedAgendaRangeIso(nextAnchor, current.viewMode, accountTimeZone),
      }));
    });
  }

  function handleViewModeChange(viewMode: AgendaViewModeDTO) {
    const nextAnchor = viewAnchorRef.current;
    startTransition(() => {
      calendarAgenda.setFilters((current) => ({
        ...current,
        viewMode,
        ...buildZonedAgendaRangeIso(nextAnchor, viewMode, accountTimeZone),
      }));
    });
  }

  function handleEventSaved() {
    setSelectedRange(null);
    startTransition(() => {
      calendarAgenda.refresh();
    });
  }

  const handleCalendarSelectRange = useCallback((startAt: string, endAt: string, allDay: boolean) => {
    setSelectedRange({ startAt, endAt, allDay });
  }, []);

  function handleCalendarDraftAction(action: 'event' | 'experimental' | 'makeup') {
    if (action === 'event') {
      setCreateOpen(true);
    } else if (action === 'experimental') {
      setExperimentalCreateOpen(true);
    } else {
      void handleOpenMakeupDialog();
    }
  }
  const handleCalendarRangeClear = useCallback(() => setSelectedRange(null), []);

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
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 alusa-dark:border-rose-500/30 alusa-dark:bg-rose-500/10 alusa-dark:text-rose-200">
            {calendarError}
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 alusa-dark:border-rose-500/30 alusa-dark:bg-rose-500/10 alusa-dark:text-rose-200">
            {actionError}
          </div>
        ) : null}

        {resourcesError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 alusa-dark:border-rose-500/30 alusa-dark:bg-rose-500/10 alusa-dark:text-rose-200">
            {resourcesError}
          </div>
        ) : null}

        <Card className="overflow-hidden rounded-lg border-slate-200 bg-white shadow-none md:rounded-xl alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-3 py-3 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:gap-4 md:px-6 md:py-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 xl:flex xl:items-center xl:justify-between">
              <div className="contents xl:flex xl:w-auto xl:min-w-0 xl:flex-nowrap xl:items-center xl:gap-2">
                <div className="col-span-2 row-start-1 inline-flex max-w-full shrink-0 overflow-hidden rounded-lg shadow-none xl:col-span-1">
                  <Button
                    className="h-10 min-w-0 flex-1 rounded-none rounded-l-lg bg-primary text-primary-foreground shadow-none hover:bg-primary/90 sm:flex-none"
                    onClick={() => setCreateOpen(true)}
                    data-testid="agenda-new-event"
                    disabled={calendarLoading || !calendarAgenda.data || resourcesLoading || Boolean(calendarError) || Boolean(resourcesError)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Novo evento
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label="Abrir ações de criação da agenda"
                        className="h-10 rounded-none rounded-r-lg border-l border-white/20 bg-primary px-3 text-primary-foreground shadow-none hover:bg-primary/90"
                        data-testid="agenda-create-menu-trigger"
                        disabled={
                          calendarLoading ||
                          !calendarAgenda.data ||
                          resourcesLoading ||
                          Boolean(calendarError) ||
                          Boolean(resourcesError) ||
                          loadingMakeupResources
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-1.5rem)]">
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
                  className="col-start-1 row-start-2 min-w-0 justify-self-start"
                >
                  <TabsList className="h-10 justify-start bg-slate-100/80 alusa-dark:bg-[color:var(--color-bg-elevated)]">
                    {AGENDA_VIEW_OPTIONS.map((option) => (
                      <TabsTrigger key={option.value} value={option.value} className="h-8 min-w-[3.5rem] rounded-lg px-3 py-0 text-sm alusa-dark:text-[color:var(--color-text-muted)] alusa-dark:data-[state=active]:bg-[color:var(--color-bg-card)] alusa-dark:data-[state=active]:text-[color:var(--color-text-primary)] sm:min-w-[4rem] sm:px-4">
                        {option.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              <div className="contents xl:ml-auto xl:flex xl:min-w-0 xl:flex-1 xl:flex-row xl:items-center xl:justify-end xl:gap-3">
                <div className="col-span-2 row-start-3 grid min-w-0 grid-cols-[auto_40px_minmax(0,1fr)_40px] items-center gap-2 xl:col-span-1 xl:flex xl:flex-none">
                  <Button variant="outline" className="h-10 min-w-[4.5rem] rounded-lg px-3" onClick={() => handleNavigatePeriod('today')}>Hoje</Button>
                  <Button variant="outline" size="icon" className="size-10 shrink-0 rounded-lg" aria-label="Período anterior" title="Período anterior" onClick={() => handleNavigatePeriod('prev')}><ChevronLeft className="size-4" /></Button>
                  <p className="min-w-0 px-1 text-center text-xs font-semibold capitalize text-slate-900 alusa-dark:text-[color:var(--color-text-primary)] xl:max-w-[min(24vw,360px)] xl:truncate sm:text-sm" data-testid="agenda-period-label">
                    {formatAgendaPeriodLabel(filters.start, filters.end, filters.viewMode, accountTimeZone)}
                  </p>
                  <Button variant="outline" size="icon" className="size-10 shrink-0 rounded-lg" aria-label="Próximo período" title="Próximo período" onClick={() => handleNavigatePeriod('next')}><ChevronRight className="size-4" /></Button>
                </div>
                <div className="col-start-2 row-start-2 flex min-w-0 items-center justify-end gap-2 xl:col-start-auto xl:row-auto xl:shrink-0">
                  <AgendaFilters
                    embedded
                    showCurrentLabel={false}
                    showNavigation={false}
                    resourcesLoading={resourcesLoading}
                    filters={filters}
                    resources={resources}
                    timeZone={accountTimeZone}
                    onFiltersChange={applyFilters}
                    onNavigatePeriod={handleNavigatePeriod}
                  />
                </div>
                {resourcesLoading ? (
                  <p className="col-span-2 row-start-4 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-muted)] xl:hidden" role="status" aria-live="polite">
                    Carregando opções de filtro…
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="relative mt-0">
            {calendarLoading ? <CalendarLoadingState /> : null}
            {!calendarLoading && calendarError ? (
              <CalendarErrorState onRetry={calendarAgenda.refresh} />
            ) : null}
            {!calendarLoading && !calendarError && calendarAgenda.data ? (
              <div aria-busy={false}>
                <CalendarScheduler
                  events={calendarEvents}
                  viewMode={calendarAgenda.filters.viewMode}
                  anchorDate={calendarAgenda.filters.start}
                  timeZone={accountTimeZone}
                  onEventSelect={setSelectedEventId}
                  draftSelection={selectedRange}
                  onSelectRange={handleCalendarSelectRange}
                  onClearRange={handleCalendarRangeClear}
                  onDraftCreateAction={handleCalendarDraftAction}
                />
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <CalendarEventDialog
        open={createOpen}
        mode="create"
        resources={resources}
        accountTimeZone={accountTimeZone}
        initialRange={selectedRange}
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
