'use client';

import { useEffect, useState } from 'react';

import type {
  AgendaViewModeDTO,
  CalendarEventTypeDTO,
  ListCalendarEventsQueryDTO,
} from '@/features/aulas/dtos';
import { listAgendaEvents } from '@/features/aulas/agenda/services/agenda-service';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  buildZonedAgendaRangeIso,
} from '@/lib/agenda-timezone';

export type AgendaFiltersState = {
  start: string;
  end: string;
  viewMode: AgendaViewModeDTO;
  turmaId?: string;
  professorId?: string;
  salaId?: string;
  type?: CalendarEventTypeDTO[];
};

const defaultWeekRange = buildZonedAgendaRangeIso(new Date(), 'week', DEFAULT_ACCOUNT_TIMEZONE);

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
    start: initial?.start ?? defaultWeekRange.start,
    end: initial?.end ?? defaultWeekRange.end,
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
