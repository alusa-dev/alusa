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

type FinanceRealtimeSubscriber = {
  id: number;
  enabled: boolean;
  cobrancaId?: string;
  pollIntervalMs: number;
  deliveredEventKeys: Set<string>;
  onEvent?: (event: FinanceRealtimeClientEvent) => void;
  onEvents?: (events: FinanceRealtimeClientEvent[]) => void;
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

let sharedSince = Date.now();
let sharedInFlight: Promise<FinanceRealtimeClientEvent[]> | null = null;
let sharedLastFetchAt = 0;
let sharedLastEvents: FinanceRealtimeClientEvent[] = [];
let sharedErrorStreak = 0;
let sharedIntervalId: number | null = null;
let sharedVisibilityBound = false;
let sharedSubscriberId = 0;
const sharedSubscribers = new Map<number, FinanceRealtimeSubscriber>();

let sharedFetchCount = 0;
let sharedSessionFetchCount = 0;
let sharedSessionStartedAt = 0;

function resetRealtimeSessionMetrics() {
  sharedSessionFetchCount = 0;
  sharedSessionStartedAt = Date.now();
}

function recordRealtimeFetch() {
  sharedFetchCount += 1;
  sharedSessionFetchCount += 1;
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PERF_LOGS === '1') {
    console.info('[finance-realtime]', {
      fetchCount: sharedFetchCount,
      sessionFetchCount: sharedSessionFetchCount,
      since: sharedSince,
      subscribers: sharedSubscribers.size,
      sessionMs: sharedSessionStartedAt ? Date.now() - sharedSessionStartedAt : 0,
    });
  }
}

function getActivePollIntervalMs() {
  let minInterval = 30_000;
  for (const subscriber of sharedSubscribers.values()) {
    if (!subscriber.enabled) continue;
    minInterval = Math.min(minInterval, subscriber.pollIntervalMs);
  }
  return minInterval;
}

function getDedupeWindowMs(pollIntervalMs: number) {
  return Math.max(1_000, Math.min(Math.floor(pollIntervalMs * 0.8), 5_000));
}

function buildEventDeliveryKey(event: FinanceRealtimeClientEvent) {
  return [
    event.type,
    event.entityId,
    event.ts,
    event.status ?? '',
    event.liquidacaoStatus ?? '',
    event.asaasStatus ?? '',
  ].join(':');
}

function markSubscriberEvents(subscriber: FinanceRealtimeSubscriber, events: FinanceRealtimeClientEvent[]) {
  const fresh: FinanceRealtimeClientEvent[] = [];

  for (const event of events) {
    const key = buildEventDeliveryKey(event);
    if (subscriber.deliveredEventKeys.has(key)) continue;
    subscriber.deliveredEventKeys.add(key);
    fresh.push(event);
  }

  if (subscriber.deliveredEventKeys.size > 200) {
    const overflow = subscriber.deliveredEventKeys.size - 200;
    let removed = 0;
    for (const key of subscriber.deliveredEventKeys) {
      subscriber.deliveredEventKeys.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  return fresh;
}

async function fetchFinanceRealtimeEvents(dedupeWindowMs: number) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return [];
  }

  const now = Date.now();
  if (sharedInFlight) return sharedInFlight;
  if (now - sharedLastFetchAt < dedupeWindowMs) return sharedLastEvents;

  sharedInFlight = Promise.resolve(fetch(
    `/api/finance/realtime/events?since=${sharedSince}`,
    { cache: 'no-store', headers: { Accept: 'application/json' } },
  ))
    .then(async (response) => {
      if (!response.ok) return [];

      const payload = (await response.json()) as {
        success?: boolean;
        events?: FinanceRealtimeClientEvent[];
      };

      const events = payload.events ?? [];
      if (events.length > 0) {
        const latestTs = Math.max(...events.map((event) => event.ts));
        sharedSince = Math.max(sharedSince, latestTs + 1);
      }

      sharedLastFetchAt = Date.now();
      sharedLastEvents = events;
      sharedErrorStreak = 0;
      recordRealtimeFetch();
      return events;
    })
    .catch(() => {
      sharedErrorStreak += 1;
      if (sharedErrorStreak > 3) {
        sharedLastFetchAt = Date.now() + Math.min(sharedErrorStreak * 1_000, 15_000);
      }
      return [];
    })
    .finally(() => {
      sharedInFlight = null;
    });

  return sharedInFlight;
}

function notifySubscribers(events: FinanceRealtimeClientEvent[]) {
  if (events.length === 0) return;

  for (const subscriber of sharedSubscribers.values()) {
    if (!subscriber.enabled) continue;

    const relevant = subscriber.cobrancaId
      ? events.filter((event) => event.entityId === subscriber.cobrancaId)
      : events;

    const fresh = markSubscriberEvents(subscriber, relevant);
    if (fresh.length === 0) continue;

    if (subscriber.onEvents) {
      subscriber.onEvents(fresh);
      continue;
    }

    for (const event of fresh) {
      subscriber.onEvent?.(event);
    }
  }
}

async function runSharedPoll() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') return;
  if (sharedSubscribers.size === 0) return;

  const pollIntervalMs = getActivePollIntervalMs();
  const events = await fetchFinanceRealtimeEvents(getDedupeWindowMs(pollIntervalMs));
  notifySubscribers(events);
}

function handleSharedVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void runSharedPoll();
  }
}

function stopSharedScheduler() {
  if (typeof window === 'undefined') return;
  if (sharedIntervalId != null) {
    window.clearInterval(sharedIntervalId);
    sharedIntervalId = null;
  }
}

function startSharedScheduler() {
  if (typeof window === 'undefined') return;
  if (sharedSubscribers.size === 0) return;

  if (sharedSessionStartedAt === 0) {
    resetRealtimeSessionMetrics();
  }

  if (!sharedVisibilityBound) {
    document.addEventListener('visibilitychange', handleSharedVisibilityChange);
    sharedVisibilityBound = true;
  }

  stopSharedScheduler();
  void runSharedPoll();
  sharedIntervalId = window.setInterval(() => {
    void runSharedPoll();
  }, getActivePollIntervalMs());
}

function restartSharedSchedulerIfNeeded() {
  if (typeof window === 'undefined') return;
  if (sharedSubscribers.size === 0) {
    stopSharedScheduler();
    if (sharedVisibilityBound) {
      document.removeEventListener('visibilitychange', handleSharedVisibilityChange);
      sharedVisibilityBound = false;
    }
    return;
  }
  startSharedScheduler();
}

function subscribe(subscriber: FinanceRealtimeSubscriber) {
  sharedSubscribers.set(subscriber.id, subscriber);
  restartSharedSchedulerIfNeeded();
}

function unsubscribe(id: number) {
  sharedSubscribers.delete(id);
  restartSharedSchedulerIfNeeded();
}

/**
 * Poll de eventos financeiros emitidos após webhooks do Asaas.
 * Complementa useLiveRefresh — reduz latência quando FINANCE_REALTIME_PUSH está ativo.
 */
export function useFinanceRealtime(options: UseFinanceRealtimeOptions = {}) {
  const {
    enabled = true,
    cobrancaId,
    pollIntervalMs = 15_000,
    onEvent,
    onEvents,
  } = options;

  const onEventRef = useRef(onEvent);
  const onEventsRef = useRef(onEvents);
  onEventRef.current = onEvent;
  onEventsRef.current = onEvents;

  const subscriberIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const subscriberId = ++sharedSubscriberId;
    subscriberIdRef.current = subscriberId;

    subscribe({
      id: subscriberId,
      enabled,
      cobrancaId,
      pollIntervalMs,
      deliveredEventKeys: new Set(),
      onEvent: (event) => onEventRef.current?.(event),
      onEvents: (events) => onEventsRef.current?.(events),
    });

    return () => {
      unsubscribe(subscriberId);
      subscriberIdRef.current = null;
    };
  }, [enabled, cobrancaId, pollIntervalMs]);

  useEffect(() => {
    const subscriberId = subscriberIdRef.current;
    if (subscriberId == null) return;

    const existing = sharedSubscribers.get(subscriberId);
    if (!existing) return;

    sharedSubscribers.set(subscriberId, {
      ...existing,
      enabled,
      cobrancaId,
      pollIntervalMs,
      deliveredEventKeys: existing.deliveredEventKeys,
      onEvent: (event) => onEventRef.current?.(event),
      onEvents: (events) => onEventsRef.current?.(events),
    });
    restartSharedSchedulerIfNeeded();
  }, [enabled, cobrancaId, pollIntervalMs]);
}
