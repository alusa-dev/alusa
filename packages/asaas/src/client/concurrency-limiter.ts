/**
 * Semáforo de concorrência para limitar requests simultâneos à API do Asaas.
 *
 * O Asaas permite até 50 GETs concorrentes. Este limiter garante que
 * o sistema nunca exceda esse threshold, evitando 429 por concorrência.
 */

import { randomUUID } from 'node:crypto';
import { asaasRedisCommand, asaasRedisEval, getAsaasRedisConfig, sanitizeAsaasRedisKeyPart } from './redis-rest';

const OFFICIAL_MAX_CONCURRENT = 50;
const DEFAULT_LOCAL_MAX_CONCURRENT = 45;

export class ConcurrencyLimiter {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  readonly maxConcurrent: number;

  constructor(maxConcurrent = OFFICIAL_MAX_CONCURRENT) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  get currentRunning(): number {
    return this.running;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export class AsaasConcurrencyLimitError extends Error {
  readonly code = 'ASAAS_GET_CONCURRENCY_WAIT_TIMEOUT' as const;
  readonly status = 429;

  constructor(public readonly waitTimeoutMs: number) {
    super(`Limite de GETs concorrentes do Asaas indisponível após aguardar ${waitTimeoutMs}ms.`);
    this.name = 'AsaasConcurrencyLimitError';
  }
}

interface DistributedLease {
  key: string;
  token: string;
  ttlMs: number;
}

/**
 * Limita por conta Asaas, mantendo compatibilidade com o antigo run(fn).
 * O limite local fica abaixo do teto oficial; com Redis, um semáforo distribuído
 * impede que múltiplas instâncias ultrapassem 50 GETs para a mesma conta.
 */
export class AccountScopedConcurrencyLimiter {
  private readonly limiters = new Map<string, ConcurrencyLimiter>();
  readonly maxConcurrent: number;
  private readonly distributedMax: number;
  private readonly leaseTtlMs: number;
  private readonly waitTimeoutMs: number;

  constructor(maxConcurrent: number, distributedMax = OFFICIAL_MAX_CONCURRENT) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.distributedMax = Math.max(1, Math.min(OFFICIAL_MAX_CONCURRENT, distributedMax));
    this.leaseTtlMs = intFromEnv('ASAAS_GET_LEASE_TTL_MS', 60_000);
    this.waitTimeoutMs = intFromEnv('ASAAS_GET_CONCURRENCY_WAIT_TIMEOUT_MS', 10_000);
  }

  private getLimiter(accountKey: string): ConcurrencyLimiter {
    let limiter = this.limiters.get(accountKey);
    if (!limiter) {
      limiter = new ConcurrencyLimiter(this.maxConcurrent);
      this.limiters.set(accountKey, limiter);
    }
    return limiter;
  }

  async run<T>(accountKey: string, fn: () => Promise<T>): Promise<T>;
  async run<T>(fn: () => Promise<T>): Promise<T>;
  async run<T>(accountKeyOrFn: string | (() => Promise<T>), maybeFn?: () => Promise<T>): Promise<T> {
    const accountKey = typeof accountKeyOrFn === 'string' ? accountKeyOrFn : 'default';
    const fn = typeof accountKeyOrFn === 'function' ? accountKeyOrFn : maybeFn;
    if (!fn) throw new Error('ConcurrencyLimiter.run requer uma função');

    const limiter = this.getLimiter(accountKey);
    await limiter.acquire();
    let lease: DistributedLease | null = null;
    try {
      lease = await this.acquireDistributed(accountKey);
      return await fn();
    } finally {
      if (lease) await this.releaseDistributed(lease);
      limiter.release();
    }
  }

  get currentRunning(): number {
    return [...this.limiters.values()].reduce((total, limiter) => total + limiter.currentRunning, 0);
  }

  get queueLength(): number {
    return [...this.limiters.values()].reduce((total, limiter) => total + limiter.queueLength, 0);
  }

  private async acquireDistributed(accountKey: string): Promise<DistributedLease | null> {
    const config = getAsaasRedisConfig();
    if (!config || process.env.ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED === 'false') return null;

    const prefix = process.env.ASAAS_GET_REDIS_KEY_PREFIX ?? 'alusa:asaas:get';
    const safeAccount = sanitizeAsaasRedisKeyPart(accountKey);
    const token = randomUUID();
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.waitTimeoutMs) {
      try {
        for (let slot = 0; slot < this.distributedMax; slot += 1) {
          const key = `${prefix}:${safeAccount}:slot:${slot}`;
          const result = await asaasRedisCommand<string | null>(config, [
            'SET', key, token, 'NX', 'PX', String(this.leaseTtlMs),
          ]);
          if (result === 'OK') return { key, token, ttlMs: this.leaseTtlMs };
        }
      } catch {
        // Redis é um reforço distribuído; se estiver indisponível, o semáforo local continua ativo.
        return null;
      }
      await sleep(100);
    }

    throw new AsaasConcurrencyLimitError(this.waitTimeoutMs);
  }

  private async releaseDistributed(lease: DistributedLease): Promise<void> {
    const config = getAsaasRedisConfig();
    if (!config) return;
    const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
    try {
      await asaasRedisEval(config, script, [lease.key], [lease.token]);
    } catch {
      // Expiração automática do lease evita bloquear a conta em caso de falha.
    }
  }
}

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const envMax = intFromEnv('ASAAS_MAX_CONCURRENT_GETS', DEFAULT_LOCAL_MAX_CONCURRENT);
export const globalGetLimiter = new AccountScopedConcurrencyLimiter(
  Math.min(OFFICIAL_MAX_CONCURRENT, envMax),
);
