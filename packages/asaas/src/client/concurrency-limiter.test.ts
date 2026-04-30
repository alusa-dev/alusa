import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from './concurrency-limiter';

describe('ConcurrencyLimiter', () => {
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
