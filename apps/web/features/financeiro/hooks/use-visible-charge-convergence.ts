'use client';

import { useEffect, useMemo, useRef } from 'react';

const TERMINAL_STATUSES = new Set([
  'PAGO',
  'PAID',
  'CANCELADO',
  'CANCELED',
  'CANCELLED',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

const DEFAULT_THROTTLE_MS = 30_000;
const lastAttemptByChargeId = new Map<string, number>();
const DEFAULT_SYNC_ENDPOINT = (id: string) => `/api/cobrancas/${id}/sync-asaas`;

export type VisibleChargeConvergenceItem = {
  id: string;
  status?: string | null;
  asaasPaymentId?: string | null;
  isGroup?: boolean | null;
};

export type UseVisibleChargeConvergenceOptions = {
  enabled?: boolean;
  items: VisibleChargeConvergenceItem[];
  refresh: () => void | Promise<void>;
  maxItems?: number;
  throttleMs?: number;
  syncEndpoint?: (_id: string) => string;
};

function shouldSync(item: VisibleChargeConvergenceItem): boolean {
  if (!item.id || !item.asaasPaymentId || item.isGroup) return false;
  const status = item.status?.trim().toUpperCase();
  return !status || !TERMINAL_STATUSES.has(status);
}

/**
 * Fallback de convergência para listas financeiras.
 * Webhook/realtime continuam sendo a fonte primária; este hook sincroniza apenas
 * itens visíveis e não terminais quando o webhook não chegou ou o poll perdeu o evento.
 */
export function useVisibleChargeConvergence({
  enabled = true,
  items,
  refresh,
  maxItems = 6,
  throttleMs = DEFAULT_THROTTLE_MS,
  syncEndpoint = DEFAULT_SYNC_ENDPOINT,
}: UseVisibleChargeConvergenceOptions) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const candidates = useMemo(() => {
    const now = Date.now();
    return items
      .filter(shouldSync)
      .filter((item) => now - (lastAttemptByChargeId.get(item.id) ?? 0) >= throttleMs)
      .slice(0, maxItems);
  }, [items, maxItems, throttleMs]);

  useEffect(() => {
    if (!enabled || candidates.length === 0) return;

    let cancelled = false;

    const run = async () => {
      const now = Date.now();
      for (const item of candidates) {
        lastAttemptByChargeId.set(item.id, now);
      }

      const results = await Promise.allSettled(
        candidates.map((item) =>
          fetch(syncEndpoint(item.id), {
            method: 'POST',
            headers: { Accept: 'application/json' },
          }),
        ),
      );

      if (cancelled) return;
      const anySynced = results.some(
        (result) => result.status === 'fulfilled' && result.value.ok,
      );

      if (anySynced) {
        window.setTimeout(() => {
          if (!cancelled) void refreshRef.current();
        }, 350);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [enabled, candidates, syncEndpoint]);
}
