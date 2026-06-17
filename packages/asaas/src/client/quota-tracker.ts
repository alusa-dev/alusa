/**
 * Quota Tracker para API do Asaas.
 *
 * O Asaas permite 25.000 requests por conta a cada 12 horas.
 * Este tracker mantém contagem distribuída via Upstash Redis quando disponível
 * e usa memória como fallback local.
 */

import { globalAsaasHooks } from './asaas-hooks';

const DEFAULT_QUOTA_LIMIT = 25_000;
const WINDOW_MS = 12 * 60 * 60 * 1000; // 12 horas
const REDIS_KEY_PREFIX = process.env.ASAAS_QUOTA_REDIS_KEY_PREFIX ?? 'alusa:asaas:quota';

export interface QuotaEntry {
  count: number;
  windowStartedAt: number;
  windowEndsAt: number;
}

export interface QuotaStatus {
  count: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  windowEndsAt: number;
  windowEndsIn: string;
  warning: boolean;
  exceeded: boolean;
}

export class QuotaTracker {
  private readonly entries = new Map<string, QuotaEntry>();
  readonly limit: number;

  constructor(limit = DEFAULT_QUOTA_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  private getOrCreate(accountKey: string): QuotaEntry {
    let entry = this.entries.get(accountKey);
    const now = Date.now();

    if (!entry || now >= entry.windowEndsAt) {
      entry = {
        count: 0,
        windowStartedAt: now,
        windowEndsAt: now + WINDOW_MS,
      };
      this.entries.set(accountKey, entry);
    }

    return entry;
  }

  increment(accountKey: string): QuotaStatus {
    const entry = this.getOrCreate(accountKey);
    entry.count += 1;

    const status = this.buildStatus(entry);
    this.emitWarnings(accountKey, status, entry.count);

    return status;
  }

  async incrementAsync(accountKey: string): Promise<QuotaStatus> {
    const redisConfig = getRedisConfig();
    if (!redisConfig) {
      return this.increment(accountKey);
    }

    const now = Date.now();
    const windowStartedAt = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const windowEndsAt = windowStartedAt + WINDOW_MS;
    const key = `${REDIS_KEY_PREFIX}:${sanitizeKeyPart(accountKey)}:${windowStartedAt}`;

    try {
      const count = await redisCommand<number>(redisConfig, ['INCR', key]);
      if (count === 1) {
        await redisCommand(redisConfig, ['EXPIRE', key, String(Math.ceil(WINDOW_MS / 1000) + 300)]);
      }

      const status = this.buildStatus({
        count,
        windowStartedAt,
        windowEndsAt,
      });
      this.emitWarnings(accountKey, status, count);
      return status;
    } catch (error) {
      console.warn('[quota-tracker] Redis indisponível para quota; usando fallback em memória', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return this.increment(accountKey);
    }
  }

  private emitWarnings(accountKey: string, status: QuotaStatus, currentCount: number): void {
    const shouldEmitWarning = status.warning && !status.exceeded && currentCount % 100 === 0;

    if (shouldEmitWarning) {
      console.warn('[quota-tracker] Quota API próxima do limite', {
        accountKey: accountKey.slice(0, 12),
        count: status.count,
        limit: status.limit,
        remaining: status.remaining,
        percentUsed: status.percentUsed,
      });

      globalAsaasHooks.emitQuotaWarning({
        accountKey,
        used: status.count,
        limit: status.limit,
        percentUsed: status.percentUsed,
        exceeded: false,
      });
    }

    if (status.exceeded && currentCount === this.limit + 1) {
      console.error('[quota-tracker] Quota API excedida', {
        accountKey: accountKey.slice(0, 12),
        count: status.count,
        limit: status.limit,
      });

      globalAsaasHooks.emitQuotaWarning({
        accountKey,
        used: status.count,
        limit: status.limit,
        percentUsed: status.percentUsed,
        exceeded: true,
      });
    }
  }

  getStatus(accountKey: string): QuotaStatus {
    const entry = this.getOrCreate(accountKey);
    return this.buildStatus(entry);
  }

  private buildStatus(entry: QuotaEntry): QuotaStatus {
    const remaining = Math.max(0, this.limit - entry.count);
    const percentUsed = Math.round((entry.count / this.limit) * 100);
    const endsInMs = Math.max(0, entry.windowEndsAt - Date.now());
    const endsInMin = Math.ceil(endsInMs / 60_000);

    return {
      count: entry.count,
      limit: this.limit,
      remaining,
      percentUsed,
      windowEndsAt: entry.windowEndsAt,
      windowEndsIn: endsInMin > 60 ? `${Math.round(endsInMin / 60)}h` : `${endsInMin}min`,
      warning: percentUsed >= 80,
      exceeded: entry.count >= this.limit,
    };
  }

  /** Snapshot de todas as contas para diagnóstico */
  allSnapshots(): Record<string, QuotaStatus> {
    const result: Record<string, QuotaStatus> = {};
    for (const [key, entry] of this.entries) {
      result[key] = this.buildStatus(entry);
    }
    return result;
  }

  reset(accountKey: string): void {
    this.entries.delete(accountKey);
  }

  resetAll(): void {
    this.entries.clear();
  }
}

interface RedisRestConfig {
  url: string;
  token: string;
}

function getRedisConfig(): RedisRestConfig | null {
  if (process.env.ASAAS_QUOTA_REDIS_ENABLED === 'false') return null;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  return { url: url.replace(/\/+$/, ''), token };
}

async function redisCommand<T = unknown>(config: RedisRestConfig, command: string[]): Promise<T> {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error(`Redis REST ${response.status}`);
  }

  const body = await response.json() as { result?: T; error?: string };
  if (body.error) {
    throw new Error(body.error);
  }

  return body.result as T;
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

const envLimit = Number(process.env.ASAAS_QUOTA_LIMIT ?? DEFAULT_QUOTA_LIMIT);
export const globalQuotaTracker = new QuotaTracker(
  Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_QUOTA_LIMIT,
);
