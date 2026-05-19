'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useFinanceLiveRefresh,
  type UseFinanceLiveRefreshOptions,
} from '@/features/financeiro/hooks/useFinanceLiveRefresh';

export type FinanceListLoadContext = {
  signal: AbortSignal;
  silent: boolean;
};

export type UseFinanceListLoadOptions = {
  /** Quando muda, zera estado inicial (ex.: troca de id em página de detalhe). */
  resetKey?: string;
  /** Refetch ao mudar filtros/página — mantém dados anteriores e usa isRefreshing. */
  deps?: readonly unknown[];
  liveRefresh?: UseFinanceLiveRefreshOptions['realtime'];
  liveRefreshEnabled?: boolean;
  /** Filtra eventos realtime por cobrança (páginas de detalhe). */
  cobrancaId?: string;
  intervalMs?: number;
  minIntervalMs?: number;
};

/**
 * Carrega listas/detalhes financeiros com fetch local (useState).
 * - Skeleton só na primeira carga
 * - Refetch por filtro/página não volta ao skeleton
 * - Abort de requests concorrentes
 */
export function useFinanceListLoad(
  fetcher: (ctx: FinanceListLoadContext) => Promise<void>,
  options: UseFinanceListLoadOptions = {},
) {
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedOnceRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (silent?: boolean) => {
    const isSilent = silent ?? hasLoadedOnceRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!isSilent) {
      setIsRefreshing(true);
    }
    if (!isSilent || !hasLoadedOnceRef.current) {
      setError(null);
    }

    try {
      await fetcherRef.current({ signal: controller.signal, silent: isSilent });
      if (controller.signal.aborted) return;
      hasLoadedOnceRef.current = true;
      setHasLoadedOnce(true);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      if (!hasLoadedOnceRef.current) {
        setError(message);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setIsRefreshing(false);
      }
    }
  }, []);

  const resetKey = options.resetKey;
  const deps = options.deps;

  useEffect(() => {
    if (resetKey !== undefined) {
      hasLoadedOnceRef.current = false;
      setHasLoadedOnce(false);
      setError(null);
    }
  }, [resetKey]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load estável; deps externas disparam refetch
  }, [load, resetKey, ...(deps ?? [])]);

  useFinanceLiveRefresh(() => load(true), {
    enabled:
      (options.liveRefreshEnabled ?? true) && hasLoadedOnce && !isRefreshing,
    cobrancaId: options.cobrancaId,
    intervalMs: options.intervalMs ?? 60_000,
    minIntervalMs: options.minIntervalMs ?? 15_000,
    realtime: options.liveRefresh ?? false,
  });

  return {
    hasLoadedOnce,
    isRefreshing,
    isInitialLoading: !hasLoadedOnce && !error,
    error,
    load,
    refresh: () => load(true),
  };
}
