'use client';

import { useCallback, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  useFinanceRealtime,
  type FinanceRealtimeClientEvent,
} from '@/hooks/use-finance-realtime';
import { financeRealtimeQueryKeys } from '@/hooks/finance-realtime-query-keys';

export type FinanceRealtimeSyncScope = {
  dashboard?: boolean;
  cobrancaQueries?: boolean;
  financeiro?: boolean;
  portal?: boolean;
  onListRefresh?: () => void;
};

export type InvalidateFinanceQueriesOptions = FinanceRealtimeSyncScope & {
  cobrancaIds?: string[];
};

/**
 * Invalida caches React Query afetados por eventos de cobrança.
 */
export async function invalidateFinanceQueries(
  queryClient: QueryClient,
  options: InvalidateFinanceQueriesOptions = {},
): Promise<void> {
  const {
    dashboard = true,
    cobrancaQueries = true,
    financeiro = true,
    portal = true,
    cobrancaIds = [],
  } = options;

  const tasks: Promise<void>[] = [];

  if (dashboard) {
    tasks.push(queryClient.invalidateQueries({ queryKey: financeRealtimeQueryKeys.dashboard }));
  }

  if (cobrancaQueries) {
    tasks.push(queryClient.invalidateQueries({ queryKey: financeRealtimeQueryKeys.cobranca }));
  }

  if (financeiro) {
    tasks.push(queryClient.invalidateQueries({ queryKey: financeRealtimeQueryKeys.financeiro }));
  }

  if (portal) {
    tasks.push(queryClient.invalidateQueries({ queryKey: financeRealtimeQueryKeys.portal }));
  }

  for (const id of cobrancaIds) {
    if (!id) continue;
    tasks.push(
      queryClient.invalidateQueries({ queryKey: financeRealtimeQueryKeys.cobrancaDetail(id) }),
    );
  }

  await Promise.all(tasks);
}

type UseFinanceRealtimeSyncOptions = {
  enabled?: boolean;
  cobrancaId?: string;
  scope?: FinanceRealtimeSyncScope;
  pollIntervalMs?: number;
};

/**
 * Escuta webhooks financeiros e sincroniza UI via invalidação em lote + callback opcional.
 */
export function useFinanceRealtimeSync(options: UseFinanceRealtimeSyncOptions = {}) {
  const {
    enabled = true,
    cobrancaId,
    scope = {},
    pollIntervalMs = 3_000,
  } = options;

  const queryClient = useQueryClient();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const handleEvents = useCallback(
    async (events: FinanceRealtimeClientEvent[]) => {
      const cobrancaEvents = events.filter((event) => event.type === 'cobranca.updated');
      if (cobrancaEvents.length === 0) return;

      const entityIds = [...new Set(cobrancaEvents.map((event) => event.entityId).filter(Boolean))];
      const current = scopeRef.current;

      await invalidateFinanceQueries(queryClient, {
        dashboard: current.dashboard ?? true,
        cobrancaQueries: current.cobrancaQueries ?? true,
        financeiro: current.financeiro ?? true,
        portal: current.portal ?? true,
        cobrancaIds: entityIds,
      });

      current.onListRefresh?.();
    },
    [queryClient],
  );

  useFinanceRealtime({
    enabled,
    cobrancaId,
    pollIntervalMs,
    onEvents: handleEvents,
  });
}
