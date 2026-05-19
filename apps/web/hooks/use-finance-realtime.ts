'use client';

import { useEffect, useRef } from 'react';

export type FinanceRealtimeClientEvent = {
  type: string;
  entityId: string;
  ts: number;
  status?: string;
  liquidacaoStatus?: string;
  asaasStatus?: string | null;
};

type UseFinanceRealtimeOptions = {
  enabled?: boolean;
  cobrancaId?: string;
  pollIntervalMs?: number;
  /** Chamado uma vez por evento (legado / detalhe). */
  onEvent?: (event: FinanceRealtimeClientEvent) => void;
  /** Chamado uma vez por poll com todos os eventos novos (preferir para invalidação em lote). */
  onEvents?: (events: FinanceRealtimeClientEvent[]) => void;
};

/**
 * Poll de eventos financeiros emitidos após webhooks do Asaas.
 * Complementa useLiveRefresh — reduz latência quando FINANCE_REALTIME_PUSH está ativo.
 */
export function useFinanceRealtime(options: UseFinanceRealtimeOptions = {}) {
  const {
    enabled = true,
    cobrancaId,
    pollIntervalMs = 3_000,
    onEvent,
    onEvents,
  } = options;

  const sinceRef = useRef(Date.now());
  const onEventRef = useRef(onEvent);
  const onEventsRef = useRef(onEvents);
  onEventRef.current = onEvent;
  onEventsRef.current = onEvents;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const poll = async () => {
      if (document.visibilityState === 'hidden') return;

      try {
        const response = await fetch(
          `/api/finance/realtime/events?since=${sinceRef.current}`,
          { cache: 'no-store', headers: { Accept: 'application/json' } },
        );

        if (!response.ok || cancelled) return;

        const payload = (await response.json()) as {
          success?: boolean;
          events?: FinanceRealtimeClientEvent[];
        };

        const events = payload.events ?? [];
        if (events.length === 0) return;

        const latestTs = Math.max(...events.map((event) => event.ts));
        sinceRef.current = Math.max(sinceRef.current, latestTs + 1);

        const relevant = cobrancaId
          ? events.filter((event) => event.entityId === cobrancaId)
          : events;

        if (relevant.length === 0) return;

        if (onEventsRef.current) {
          onEventsRef.current(relevant);
          return;
        }

        for (const event of relevant) {
          onEventRef.current?.(event);
        }
      } catch {
        // falha silenciosa — useLiveRefresh cobre
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), pollIntervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, cobrancaId, pollIntervalMs]);
}
