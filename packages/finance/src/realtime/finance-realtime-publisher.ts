import type { FinanceRealtimeEvent, FinanceRealtimeEventRecord } from './finance-realtime-types';
import { upstashRedisCommand } from './upstash-rest';

const MEMORY_TTL_MS = 5 * 60 * 1000;
const MAX_EVENTS_PER_TENANT = 100;

type MemoryStore = Map<string, FinanceRealtimeEventRecord[]>;

type RealtimeGlobals = typeof globalThis & {
  __alusaFinanceRealtimeMemory?: MemoryStore;
};

function financeRealtimeKey(contaId: string): string {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'local';
  return `alusa:${env}:finance:rt:${contaId}`;
}

function getMemoryStore(): MemoryStore {
  const globalRef = globalThis as RealtimeGlobals;
  globalRef.__alusaFinanceRealtimeMemory ??= new Map();
  return globalRef.__alusaFinanceRealtimeMemory;
}

function pushToMemory(contaId: string, event: FinanceRealtimeEventRecord): void {
  const store = getMemoryStore();
  const now = Date.now();
  const existing = store.get(contaId) ?? [];
  const pruned = existing.filter((item) => now - item.ts < MEMORY_TTL_MS);
  pruned.unshift(event);
  store.set(contaId, pruned.slice(0, MAX_EVENTS_PER_TENANT));
}

function isRealtimeEnabled(): boolean {
  return process.env.FINANCE_REALTIME_PUSH_ENABLED !== 'false';
}

/**
 * Publica evento de domínio financeiro para clientes conectados (SSE/poll).
 * Falha silenciosa — não deve quebrar processamento de webhook.
 */
export async function publishFinanceEvent(event: FinanceRealtimeEvent): Promise<void> {
  if (!isRealtimeEnabled()) return;

  const record: FinanceRealtimeEventRecord = {
    ...event,
    ts: event.revision || Date.now(),
  };

  pushToMemory(event.contaId, record);

  const key = financeRealtimeKey(event.contaId);
  const serialized = JSON.stringify(record);

  await upstashRedisCommand(['LPUSH', key, serialized]);
  await upstashRedisCommand(['LTRIM', key, 0, MAX_EVENTS_PER_TENANT - 1]);
  await upstashRedisCommand(['EXPIRE', key, 300]);
}

export async function listFinanceRealtimeEvents(params: {
  contaId: string;
  since?: number;
  limit?: number;
}): Promise<FinanceRealtimeEventRecord[]> {
  const since = params.since ?? 0;
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_EVENTS_PER_TENANT);

  const fromRedis = await upstashRedisCommand(['LRANGE', financeRealtimeKey(params.contaId), 0, limit - 1]);
  const redisEvents = parseEventList(fromRedis);

  const memoryEvents = getMemoryStore().get(params.contaId) ?? [];
  const merged = new Map<number, FinanceRealtimeEventRecord>();

  for (const event of [...redisEvents, ...memoryEvents]) {
    if (event.ts > since) {
      merged.set(event.ts, event);
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

function parseEventList(raw: unknown): FinanceRealtimeEventRecord[] {
  if (!Array.isArray(raw)) return [];

  const events: FinanceRealtimeEventRecord[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    try {
      const parsed = JSON.parse(item) as FinanceRealtimeEventRecord;
      if (parsed?.contaId && parsed?.type && parsed?.entityId && typeof parsed.ts === 'number') {
        events.push(parsed);
      }
    } catch {
      // ignore malformed
    }
  }
  return events;
}
