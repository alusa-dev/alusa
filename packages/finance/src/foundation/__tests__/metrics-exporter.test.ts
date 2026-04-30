import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@alusa/asaas', () => {
  const circuitSnapshots: Record<string, { state: string; failures: number; lastFailureAt: number }> = {};
  const quotaSnapshots: Record<string, { count: number; limit: number; remaining: number; percentUsed: number; warning: boolean; exceeded: boolean; windowEndsAt: number; windowEndsIn: string }> = {};

  return {
    globalCircuitBreaker: {
      allSnapshots: vi.fn(() => circuitSnapshots),
      _set: (key: string, val: typeof circuitSnapshots[string]) => { circuitSnapshots[key] = val; },
      _clear: () => { Object.keys(circuitSnapshots).forEach((k) => delete circuitSnapshots[k]); },
    },
    globalQuotaTracker: {
      allSnapshots: vi.fn(() => quotaSnapshots),
      limit: 25000,
      _set: (key: string, val: typeof quotaSnapshots[string]) => { quotaSnapshots[key] = val; },
      _clear: () => { Object.keys(quotaSnapshots).forEach((k) => delete quotaSnapshots[k]); },
    },
    globalRateLimitTracker: {
      snapshot: vi.fn(() => ({})),
    },
    globalGetLimiter: {
      currentRunning: 3,
      maxConcurrent: 50,
      queueLength: 0,
    },
  };
});

vi.mock('../asaas-api-logger', () => ({
  getApiCallStats: vi.fn(() => ({
    totalCalls: 100,
    successCalls: 95,
    errorCalls: 5,
    avgDurationMs: 150,
    errorRate: 0.05,
    byMethod: { GET: 70, POST: 30 },
    byEndpoint: {
      '/v3/payments': { count: 50, errors: 2 },
      '/v3/customers': { count: 30, errors: 1 },
    },
    windowStart: new Date('2026-01-01'),
    generatedAt: new Date('2026-01-01'),
  })),
}));

import { collectOperationalMetrics, toPrometheusText } from '../metrics-exporter';

describe('MetricsExporter', () => {
  beforeEach(async () => {
    const asaas = await import('@alusa/asaas');
    (asaas.globalCircuitBreaker as unknown as { _clear: () => void })._clear();
    (asaas.globalQuotaTracker as unknown as { _clear: () => void })._clear();
  });

  describe('collectOperationalMetrics', () => {
    it('deve agregar métricas de todas as fontes', () => {
      const metrics = collectOperationalMetrics();

      expect(metrics.generatedAt).toBeDefined();
      expect(metrics.circuitBreaker).toBeDefined();
      expect(metrics.quota).toBeDefined();
      expect(metrics.rateLimitTracker).toBeDefined();
      expect(metrics.concurrency).toBeDefined();
      expect(metrics.apiCalls).toBeDefined();
    });

    it('deve refletir concurrency state', () => {
      const metrics = collectOperationalMetrics();

      expect(metrics.concurrency.active).toBe(3);
      expect(metrics.concurrency.maxConcurrent).toBe(50);
      expect(metrics.concurrency.waiting).toBe(0);
    });

    it('deve refletir API call stats', () => {
      const metrics = collectOperationalMetrics();

      expect(metrics.apiCalls.totalCalls).toBe(100);
      expect(metrics.apiCalls.successCalls).toBe(95);
      expect(metrics.apiCalls.errorCalls).toBe(5);
      expect(metrics.apiCalls.errorRate).toBe(0.05);
    });

    it('deve retornar top endpoints ordenados por count', () => {
      const metrics = collectOperationalMetrics();

      expect(metrics.apiCalls.topEndpoints[0].endpoint).toBe('/v3/payments');
      expect(metrics.apiCalls.topEndpoints[0].count).toBe(50);
    });

    it('deve contar total de circuitos abertos', async () => {
      const asaas = await import('@alusa/asaas');
      const cb = asaas.globalCircuitBreaker as unknown as { _set: (k: string, v: unknown) => void };
      cb._set('acc1', { state: 'OPEN', failures: 5, lastFailureAt: Date.now() });
      cb._set('acc2', { state: 'CLOSED', failures: 0, lastFailureAt: 0 });

      const metrics = collectOperationalMetrics();
      expect(metrics.circuitBreaker.totalOpen).toBe(1);
      expect(metrics.circuitBreaker.circuits['acc1'].state).toBe('OPEN');
    });

    it('deve refletir quota usage', async () => {
      const asaas = await import('@alusa/asaas');
      const qt = asaas.globalQuotaTracker as unknown as { _set: (k: string, v: unknown) => void };
      qt._set('acc1', { count: 20000, limit: 25000, remaining: 5000, percentUsed: 80, warning: true, exceeded: false, windowEndsAt: Date.now() + 3600000, windowEndsIn: '1h' });

      const metrics = collectOperationalMetrics();
      expect(metrics.quota.accounts['acc1'].used).toBe(20000);
      expect(metrics.quota.accounts['acc1'].warning).toBe(true);
    });
  });

  describe('toPrometheusText', () => {
    it('deve gerar texto em formato Prometheus válido', () => {
      const metrics = collectOperationalMetrics();
      const text = toPrometheusText(metrics);

      expect(text).toContain('# HELP');
      expect(text).toContain('# TYPE');
      expect(text).toContain('asaas_circuit_breaker_open_total');
      expect(text).toContain('asaas_quota_limit');
      expect(text).toContain('asaas_concurrency_active');
      expect(text).toContain('asaas_api_calls_total');
      expect(text).toContain('asaas_api_calls_errors');
      expect(text).toContain('asaas_api_calls_error_rate');
    });

    it('deve incluir labels de métodos', () => {
      const metrics = collectOperationalMetrics();
      const text = toPrometheusText(metrics);

      expect(text).toContain('method="GET"');
      expect(text).toContain('method="POST"');
    });
  });
});
