import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AccountScopedConcurrencyLimiter,
  AsaasConcurrencyStoreUnavailableError,
  ConcurrencyLimiter,
} from './concurrency-limiter';

describe('ConcurrencyLimiter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('separa a concorrência por conta Asaas', async () => {
    vi.stubEnv('ASAAS_REDIS_ENABLED', 'false');
    const limiter = new AccountScopedConcurrencyLimiter(1);
    let release!: () => void;
    const first = limiter.run('account-a', () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = limiter.run('account-b', () => Promise.resolve('ok'));
    await expect(second).resolves.toBe('ok');
    expect(limiter.currentRunning).toBe(1);

    release();
    await first;
    vi.unstubAllEnvs();
  });

  describe('semáforo distribuído em produção', () => {
    it('falha fechado sem Redis configurado e libera o slot local', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ASAAS_REDIS_ENABLED', 'false');
      const limiter = new AccountScopedConcurrencyLimiter(1);
      const task = vi.fn(async () => 'must-not-run');

      await expect(limiter.run('account-a', task)).rejects.toBeInstanceOf(AsaasConcurrencyStoreUnavailableError);
      expect(task).not.toHaveBeenCalled();
      expect(limiter.currentRunning).toBe(0);
    });

    it('falha fechado se o Redis configurado ficar indisponível', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ASAAS_REDIS_ENABLED', 'true');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.invalid');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('redis unavailable')));
      const limiter = new AccountScopedConcurrencyLimiter(1);

      await expect(limiter.run('account-a', async () => 'must-not-run')).rejects.toMatchObject({
        code: 'ASAAS_GET_CONCURRENCY_STORE_UNAVAILABLE',
        status: 503,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('aloca e libera um slot com dois comandos Redis atômicos', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ASAAS_REDIS_ENABLED', 'true');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      const redisFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 1 }),
        });
      vi.stubGlobal('fetch', redisFetch);
      const limiter = new AccountScopedConcurrencyLimiter(1);

      await expect(limiter.run('account-a', async () => 'ok')).resolves.toBe('ok');

      expect(redisFetch).toHaveBeenCalledTimes(2);
      const acquireCommand = JSON.parse(String(redisFetch.mock.calls[0]?.[1]?.body)) as string[];
      expect(acquireCommand[0]).toBe('EVAL');
      expect(acquireCommand[2]).toBe('50');
    });
  });

  describe('execução básica', () => {
    it('deve executar task e retornar resultado', async () => {
      const limiter = new ConcurrencyLimiter(5);
      const result = await limiter.run(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('deve rastrear running count', async () => {
      const limiter = new ConcurrencyLimiter(5);
      expect(limiter.currentRunning).toBe(0);

      let resolveInner!: () => void;
      const blocked = new Promise<void>((resolve) => { resolveInner = resolve; });

      const promise = limiter.run(() => blocked);
      // Aguardar microtask para acquire completar
      await new Promise((r) => setTimeout(r, 0));
      expect(limiter.currentRunning).toBe(1);

      resolveInner();
      await promise;
      expect(limiter.currentRunning).toBe(0);
    });
  });

  describe('fila de espera', () => {
    it('deve enfileirar quando no limite', async () => {
      const limiter = new ConcurrencyLimiter(2);
      const resolvers: Array<() => void> = [];
      const results: number[] = [];

      // Preencher os 2 slots
      for (let i = 0; i < 2; i++) {
        const p = new Promise<void>((resolve) => { resolvers.push(resolve); });
        limiter.run(() => p).then(() => results.push(i));
      }
      await new Promise((r) => setTimeout(r, 0));
      expect(limiter.currentRunning).toBe(2);

      // Terceira task deve ficar na fila
      let thirdResolved = false;
      const thirdPromise = new Promise<void>((resolve) => { resolvers.push(resolve); });
      limiter.run(() => thirdPromise).then(() => { thirdResolved = true; });
      await new Promise((r) => setTimeout(r, 0));
      expect(limiter.queueLength).toBe(1);
      expect(thirdResolved).toBe(false);

      // Liberar primeiro slot
      resolvers[0]();
      await new Promise((r) => setTimeout(r, 10));
      expect(limiter.queueLength).toBe(0);
      expect(limiter.currentRunning).toBe(2);

      // Liberar restante
      resolvers[1]();
      resolvers[2]();
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  describe('acquire/release manual', () => {
    it('deve funcionar com acquire/release manuais', async () => {
      const limiter = new ConcurrencyLimiter(1);
      await limiter.acquire();
      expect(limiter.currentRunning).toBe(1);
      limiter.release();
      expect(limiter.currentRunning).toBe(0);
    });

    it('release sem acquire não vai abaixo de 0', () => {
      const limiter = new ConcurrencyLimiter(1);
      limiter.release();
      expect(limiter.currentRunning).toBe(0);
    });
  });

  describe('construtor', () => {
    it('deve aceitar valor mínimo de 1', () => {
      const limiter = new ConcurrencyLimiter(0);
      expect(limiter.maxConcurrent).toBe(1);
    });

    it('deve aceitar valor negativo como 1', () => {
      const limiter = new ConcurrencyLimiter(-5);
      expect(limiter.maxConcurrent).toBe(1);
    });
  });

  describe('erro na task', () => {
    it('deve liberar slot mesmo em caso de erro', async () => {
      const limiter = new ConcurrencyLimiter(1);
      await expect(
        limiter.run(() => Promise.reject(new Error('boom'))),
      ).rejects.toThrow('boom');
      expect(limiter.currentRunning).toBe(0);
    });
  });
});
