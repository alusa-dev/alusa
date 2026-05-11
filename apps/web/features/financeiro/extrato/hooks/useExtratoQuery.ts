'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtratoResponse } from '../dtos';
import type { ExtratoFiltersState } from './useExtratoFilters';
import { fetchExtrato } from '../services/get-extrato';
import { useFinanceLiveRefresh } from '../../hooks/useFinanceLiveRefresh';

const REFRESH_INTERVAL = 30_000;

export function useExtratoQuery(filters: ExtratoFiltersState) {
  const [data, setData] = useState<ExtratoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const load = useCallback(
    async (silent = false) => {
      const requestKey = JSON.stringify(filters);
      const inFlight = inFlightRef.current;
      if (inFlight?.key === requestKey) {
        return inFlight.promise;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const trackedPromise = (async () => {
        if (!silent) setLoading(true);

        try {
          const result = await fetchExtrato({
            startDate: filters.startDate || undefined,
            endDate: filters.endDate || undefined,
            type: filters.type.length > 0 ? filters.type : undefined,
            status: filters.status.length > 0 ? filters.status : undefined,
            search: filters.search || undefined,
            page: filters.page,
            pageSize: filters.pageSize,
            sort: filters.sort,
            direction: filters.direction,
          }, {
            signal: controller.signal,
          });

          if (!controller.signal.aborted) {
            setData(result);
            setError(null);
          }
        } catch (err) {
          if (!controller.signal.aborted && !silent) {
            setError((err as Error).message);
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
        }
      })();

      inFlightRef.current = { key: requestKey, promise: trackedPromise };
      trackedPromise.finally(() => {
        if (inFlightRef.current?.promise === trackedPromise) {
          inFlightRef.current = null;
        }
        if (!controller.signal.aborted && !silent) {
          setLoading(false);
        }
      });
      return trackedPromise;
    },
    [filters],
  );

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  useFinanceLiveRefresh(
    () => load(true),
    { intervalMs: REFRESH_INTERVAL, minIntervalMs: 8_000 },
  );

  return { data, loading, error, refetch: load };
}
