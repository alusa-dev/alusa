'use client';

import { useEffect, useState } from 'react';

import type {
  AgendaViewModeDTO,
  CalendarEventTypeDTO,
  ListCalendarEventsQueryDTO,
} from '@/features/aulas/dtos';
import { listAgendaEvents } from '@/features/aulas/agenda/services/agenda-service';

export type AgendaFiltersState = {
  start: string;
  end: string;
  viewMode: AgendaViewModeDTO;
  turmaId?: string;
  professorId?: string;
  salaId?: string;
  type?: CalendarEventTypeDTO[];
};

const now = new Date();
const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const defaultEnd = new Date(defaultStart);
defaultEnd.setDate(defaultEnd.getDate() + 6);

function normalizeAgendaViewMode(viewMode?: AgendaViewModeDTO) {
  if (viewMode === 'month-compact') {
    return 'month-detailed' as const;
  }

  return viewMode ?? 'week';
}

type UseAgendaOptions = {
  enabled?: boolean;
};

export function useAgenda(initial?: Partial<AgendaFiltersState>, options?: UseAgendaOptions) {
  const [filters, setFilters] = useState<AgendaFiltersState>({
    start: initial?.start ?? defaultStart.toISOString(),
    end: initial?.end ?? defaultEnd.toISOString(),
    viewMode: normalizeAgendaViewMode(initial?.viewMode),
    turmaId: initial?.turmaId,
    professorId: initial?.professorId,
    salaId: initial?.salaId,
    type: initial?.type,
  });
  const [data, setData] = useState<Awaited<ReturnType<typeof listAgendaEvents>> | null>(null);
  const [loading, setLoading] = useState(options?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const enabled = options?.enabled ?? true;
  const requestKey = JSON.stringify(filters);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const query: Partial<ListCalendarEventsQueryDTO> = {
          start: filters.start,
          end: filters.end,
          turmaId: filters.turmaId,
          professorId: filters.professorId,
          salaId: filters.salaId,
          type: filters.type,
          viewMode: filters.viewMode,
          includeResources: false,
        };

        const result = await listAgendaEvents(query);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [enabled, requestKey]);

  return {
    filters,
    setFilters,
    data,
    loading,
    error,
  };
}
