'use client';

import { useCallback, useEffect, useState } from 'react';

import { TZDateMini } from '@date-fns/tz';
import { addDays, addMonths } from 'date-fns';

import type {
  AgendaViewModeDTO,
  CalendarEventTypeDTO,
  ListCalendarEventsQueryDTO,
} from '@/features/aulas/dtos';
import { listAgendaEvents } from '@/features/aulas/agenda/services/agenda-service';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  buildZonedAgendaRangeIso,
  normalizeAccountTimeZoneClient,
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

function prefetchAdjacentAgendaRanges(filters: AgendaFiltersState, timeZone: string): void {
  const tz = normalizeAccountTimeZoneClient(timeZone);

  const run = (direction: -1 | 1) => {
    try {
      const anchor = new Date(filters.start);
      const z = new TZDateMini(anchor.getTime(), tz);
      const shifted =
        filters.viewMode === 'week'
          ? addDays(z, direction === -1 ? -7 : 7)
          : addMonths(z, direction === -1 ? -1 : 1);
      const { start, end } = buildZonedAgendaRangeIso(new Date(shifted.getTime()), filters.viewMode, tz);

      void listAgendaEvents({
        start,
        end,
        turmaId: filters.turmaId,
        professorId: filters.professorId,
        salaId: filters.salaId,
        type: filters.type,
        viewMode: filters.viewMode,
        includeResources: false,
      }).catch(() => {});
    } catch {
      /* prefetch best-effort */
    }
  };

  run(-1);
  run(1);
}

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
  const [refreshNonce, setRefreshNonce] = useState(0);

  const enabled = options?.enabled ?? true;
  const requestKey = JSON.stringify(filters);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
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

        const result = await listAgendaEvents(query, { signal: controller.signal });
        if (cancelled) return;

        setData(result);
        prefetchAdjacentAgendaRanges(filters, result.data.timeZone);
      } catch (err) {
        if (cancelled) return;
        const isAbort =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (typeof err === 'object' &&
            err !== null &&
            (err as { name?: string }).name === 'AbortError');
        if (isAbort) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, requestKey, refreshNonce]);

  const refresh = useCallback(() => {
    setRefreshNonce((n) => n + 1);
  }, []);

  return {
    filters,
    setFilters,
    data,
    loading,
    error,
    refresh,
  };
}
