/**
 * Quota Tracker para API do Asaas.
 *
 * O Asaas permite 25.000 requests por conta a cada 12 horas.
 * Este tracker mantém contagem distribuída via Upstash Redis quando disponível
 * e usa memória como fallback local.
 */

import { globalAsaasHooks } from './asaas-hooks';
import { asaasRedisEval, getAsaasRedisConfig, sanitizeAsaasRedisKeyPart } from './redis-rest';

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
  allowed?: boolean;
  retryAfterMs?: number;
}

export class AsaasQuotaExceededError extends Error {
  readonly code = 'ASAAS_QUOTA_EXCEEDED' as const;
  readonly status = 429;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Quota da API Asaas atingida. Aguarde aproximadamente ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'AsaasQuotaExceededError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class QuotaTracker {
  private readonly entries = new Map<string, QuotaEntry>();
  private readonly exceededAlerts = new Set<string>();
  readonly limit: number;

  constructor(limit = DEFAULT_QUOTA_LIMIT) {
    this.limit = Math.max(1, limit);
  }

  private getOrCreate(accountKey: string): QuotaEntry {
    let entry = this.entries.get(accountKey);
    const now = Date.now();

    if (!entry || now >= entry.windowEndsAt) {
      this.exceededAlerts.delete(accountKey);
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

  /** Reserva uma chamada real. Ao atingir o limite, não incrementa nem permite outra chamada. */
  reserve(accountKey: string): QuotaStatus {
    const entry = this.getOrCreate(accountKey);
    if (entry.count >= this.limit) {
      return {
        ...this.buildStatus(entry),
        allowed: false,
        retryAfterMs: Math.max(0, entry.windowEndsAt - Date.now()),
      };
    }

    entry.count += 1;
    const status = { ...this.buildStatus(entry), allowed: true, retryAfterMs: 0 };
    this.emitWarnings(accountKey, status, entry.count);
    return status;
  }

  async incrementAsync(accountKey: string): Promise<QuotaStatus> {
    // Compatibilidade com consumidores antigos; a reserva rolling-window é a operação correta.
    return this.reserveAsync(accountKey);
  }

  async reserveAsync(accountKey: string): Promise<QuotaStatus> {
    const redisConfig = getAsaasRedisConfig();
    if (!redisConfig) return this.reserve(accountKey);

    const now = Date.now();
    const windowMs = WINDOW_MS;
    const baseKey = `${REDIS_KEY_PREFIX}:${sanitizeAsaasRedisKeyPart(accountKey)}`;
    const script = `
local count = redis.call('GET', KEYS[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[3])
if not count then
  redis.call('SET', KEYS[1], '1', 'PX', windowMs)
  redis.call('SET', KEYS[2], tostring(now), 'PX', windowMs)
  return {1, 1, now, windowMs}
end
local numericCount = tonumber(count)
local start = tonumber(redis.call('GET', KEYS[2]) or now)
if numericCount >= limit then
  return {0, numericCount, start, math.max(0, redis.call('PTTL', KEYS[1]))}
end
local nextCount = redis.call('INCR', KEYS[1])
return {1, nextCount, start, math.max(0, redis.call('PTTL', KEYS[1]))}
`;

    try {
      const result = await asaasRedisEval<Array<number | string>>(
        redisConfig,
        script,
        [`${baseKey}:count`, `${baseKey}:started-at`],
        [String(now), String(this.limit), String(windowMs)],
      );
      const allowed = Number(result?.[0]) === 1;
      const count = Number(result?.[1] ?? 0);
      const windowStartedAt = Number(result?.[2] ?? now);
      const ttlMs = Math.max(0, Number(result?.[3] ?? windowMs));
      const status = this.buildStatus({
        count,
        windowStartedAt,
        windowEndsAt: windowStartedAt + windowMs,
      });
      const enriched = {
        ...status,
        allowed,
        retryAfterMs: allowed ? 0 : ttlMs,
      };
      this.emitWarnings(accountKey, enriched, count);
      return enriched;
    } catch (error) {
      console.warn('[quota-tracker] Redis indisponível para reserva de quota; usando fallback em memória', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return this.reserve(accountKey);
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

    if (status.exceeded && !this.exceededAlerts.has(accountKey)) {
      this.exceededAlerts.add(accountKey);
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
      allowed: entry.count < this.limit,
      retryAfterMs: entry.count >= this.limit ? endsInMs : 0,
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
    this.exceededAlerts.delete(accountKey);
  }

  resetAll(): void {
    this.entries.clear();
    this.exceededAlerts.clear();
  }
}

const envLimit = Number(process.env.ASAAS_QUOTA_LIMIT ?? DEFAULT_QUOTA_LIMIT);
export const globalQuotaTracker = new QuotaTracker(
  Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_QUOTA_LIMIT,
);
