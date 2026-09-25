/**
 * Semáforo de concorrência para limitar requests simultâneos à API do Asaas.
 *
 * O Asaas permite até 50 GETs concorrentes. Este limiter garante que
 * o sistema nunca exceda esse threshold, evitando 429 por concorrência.
 */

import { randomUUID } from 'node:crypto';
import { asaasRedisEval, getAsaasRedisConfig, sanitizeAsaasRedisKeyPart } from './redis-rest';

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

export class AsaasConcurrencyStoreUnavailableError extends Error {
  readonly code = 'ASAAS_GET_CONCURRENCY_STORE_UNAVAILABLE' as const;
  readonly status = 503;

  constructor() {
    super('Controle distribuído de concorrência do Asaas indisponível.');
    this.name = 'AsaasConcurrencyStoreUnavailableError';
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
    // The SDK caps a single provider request at 60s; keep a margin so a slow
    // abort/release cannot expire the distributed slot while the request runs.
    this.leaseTtlMs = Math.max(65_000, intFromEnv('ASAAS_GET_LEASE_TTL_MS', 75_000));
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
    if (!config || process.env.ASAAS_DISTRIBUTED_GET_LIMIT_ENABLED === 'false') {
      if (process.env.NODE_ENV === 'production') throw new AsaasConcurrencyStoreUnavailableError();
      return null;
    }

    const prefix = process.env.ASAAS_GET_REDIS_KEY_PREFIX ?? 'alusa:asaas:get';
    const safeAccount = sanitizeAsaasRedisKeyPart(accountKey);
    const token = randomUUID();
    const startedAt = Date.now();
    const keys = Array.from(
      { length: this.distributedMax },
      (_, slot) => `${prefix}:${safeAccount}:slot:${slot}`,
    );
    const acquireScript = `
for i, key in ipairs(KEYS) do
  if redis.call('SET', key, ARGV[1], 'NX', 'PX', ARGV[2]) then
    return i
  end
end
return 0
`;

    while (Date.now() - startedAt < this.waitTimeoutMs) {
      try {
        const slot = Number(await asaasRedisEval<number>(config, acquireScript, keys, [token, String(this.leaseTtlMs)]));
        if (slot > 0) return { key: keys[slot - 1]!, token, ttlMs: this.leaseTtlMs };
      } catch {
        if (process.env.NODE_ENV === 'production') throw new AsaasConcurrencyStoreUnavailableError();
        // Fallback local é permitido apenas fora de produção.
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
