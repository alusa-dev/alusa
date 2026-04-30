import { describe, it, expect, beforeEach, vi } from 'vitest';
import { globalAsaasHooks } from './asaas-hooks';

describe('AsaasHooks', () => {
  beforeEach(() => {
    globalAsaasHooks.removeAllListeners();
  });

  describe('onApiCall', () => {
    it('deve notificar listeners registrados', () => {
      const listener = vi.fn();
      globalAsaasHooks.onApiCall(listener);

      globalAsaasHooks.emitApiCall({
        method: 'GET',
        endpoint: '/v3/payments',
        accountKey: 'acc1',
        httpStatus: 200,
        durationMs: 100,
        success: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', success: true }),
      );
    });

    it('deve permitir remover listener', () => {
      const listener = vi.fn();
      const unsubscribe = globalAsaasHooks.onApiCall(listener);

      unsubscribe();

      globalAsaasHooks.emitApiCall({
        method: 'GET', endpoint: '/v3/payments', accountKey: 'acc1',
        httpStatus: 200, durationMs: 100, success: true,
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('onCircuitOpen', () => {
    it('deve notificar quando circuito abre', () => {
      const listener = vi.fn();
      globalAsaasHooks.onCircuitOpen(listener);

      globalAsaasHooks.emitCircuitOpen({
        accountKey: 'acc1',
        failures: 5,
        cooldownMs: 30000,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ accountKey: 'acc1', failures: 5 }),
      );
    });
  });

  describe('onQuotaWarning', () => {
    it('deve notificar quando quota atinge warning', () => {
      const listener = vi.fn();
      globalAsaasHooks.onQuotaWarning(listener);

      globalAsaasHooks.emitQuotaWarning({
        accountKey: 'acc1',
        used: 20000,
        limit: 25000,
        percentUsed: 80,
        exceeded: false,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ percentUsed: 80, exceeded: false }),
      );
    });
  });

  describe('onRateLimitHit', () => {
    it('deve notificar quando rate limit é atingido', () => {
      const listener = vi.fn();
      globalAsaasHooks.onRateLimitHit(listener);

      globalAsaasHooks.emitRateLimitHit({
        accountKey: 'acc1',
        endpoint: '/v3/payments',
        resetSeconds: 60,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: '/v3/payments', resetSeconds: 60 }),
      );
    });
  });

  describe('fail-safe', () => {
    it('deve continuar notificando outros listeners se um falhar', () => {
      const failingListener = vi.fn(() => { throw new Error('boom'); });
      const okListener = vi.fn();

      globalAsaasHooks.onApiCall(failingListener);
      globalAsaasHooks.onApiCall(okListener);

      globalAsaasHooks.emitApiCall({
        method: 'GET', endpoint: '/test', accountKey: 'acc1',
        httpStatus: 200, durationMs: 50, success: true,
      });

      expect(failingListener).toHaveBeenCalled();
      expect(okListener).toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('deve remover todos os listeners de todos os tipos', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      const l3 = vi.fn();
      const l4 = vi.fn();

      globalAsaasHooks.onApiCall(l1);
      globalAsaasHooks.onCircuitOpen(l2);
      globalAsaasHooks.onQuotaWarning(l3);
      globalAsaasHooks.onRateLimitHit(l4);

      globalAsaasHooks.removeAllListeners();

      globalAsaasHooks.emitApiCall({ method: 'GET', endpoint: '', accountKey: '', httpStatus: 200, durationMs: 0, success: true });
      globalAsaasHooks.emitCircuitOpen({ accountKey: '', failures: 0, cooldownMs: 0 });
      globalAsaasHooks.emitQuotaWarning({ accountKey: '', used: 0, limit: 0, percentUsed: 0, exceeded: false });
      globalAsaasHooks.emitRateLimitHit({ accountKey: '', endpoint: '', resetSeconds: null });

      expect(l1).not.toHaveBeenCalled();
      expect(l2).not.toHaveBeenCalled();
      expect(l3).not.toHaveBeenCalled();
      expect(l4).not.toHaveBeenCalled();
    });
  });

  describe('múltiplos listeners', () => {
    it('deve notificar todos os listeners do mesmo tipo', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      const l3 = vi.fn();

      globalAsaasHooks.onApiCall(l1);
      globalAsaasHooks.onApiCall(l2);
      globalAsaasHooks.onApiCall(l3);

      globalAsaasHooks.emitApiCall({
        method: 'POST', endpoint: '/test', accountKey: 'acc1',
        httpStatus: 201, durationMs: 200, success: true,
      });

      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
      expect(l3).toHaveBeenCalled();
    });
  });
});
