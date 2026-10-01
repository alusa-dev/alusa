import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';

import { logFinanceApiError, logFinanceApiRequest } from '@/lib/api/finance-api-response';

describe('finance-api-response observability', () => {
  let restoreTelemetry: (() => void) | undefined;

  afterEach(() => {
    restoreTelemetry?.();
    restoreTelemetry = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('emite métricas agregadas sem gerar access log ou carregar tenant', () => {
    vi.stubEnv('PERF_LOGS', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OBSERVABILITY_METRIC_SAMPLE_RATE', '1');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const metric = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ metric });

    logFinanceApiRequest('GET /api/financeiro/nota-fiscal/aluno/[alunoId]', {
      durationMs: 42,
      cacheHit: 'HIT',
    });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(metric).toHaveBeenCalledTimes(2);
    expect(metric).toHaveBeenNthCalledWith(1, {
      kind: 'counter',
      name: 'alusa.finance.api.requests',
      value: 1,
      dimensions: {
        'http.route': '/api/financeiro/nota-fiscal/aluno/:id',
        'cache.state': 'hit',
      },
    });
    expect(JSON.stringify(metric.mock.calls)).not.toContain('contaId');
    expect(JSON.stringify(metric.mock.calls)).not.toContain('conta-1');
  });

  it('registra alerta estruturado apenas para requisições financeiras lentas', () => {
    const log = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ log });

    logFinanceApiRequest('GET /api/financeiro/kpis', {
      durationMs: 2_500,
      cacheHit: 'MISS',
      correlationId: 'safe-correlation-id',
    });

    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'warn',
      'event.name': 'finance.api.request.slow',
      'http.route': '/api/financeiro/kpis',
      duration_ms: 2_500,
      correlationId: 'safe-correlation-id',
      attributes: { cacheState: 'MISS' },
    }));
  });

  it('não inclui mensagem nem metadata livre no log de falha financeira', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ log });

    const correlationId = logFinanceApiError(
      'POST /api/financeiro/cobrancas/[id]',
      new Error('token=private-secret student=Ana Silva'),
      { contaId: 'conta-private', paymentId: 'payment-private' },
    );

    const output = JSON.stringify(errorSpy.mock.calls);
    expect(output).toContain(correlationId);
    expect(output).not.toContain('private-secret');
    expect(output).not.toContain('Ana Silva');
    expect(output).not.toContain('conta-private');
    expect(output).not.toContain('payment-private');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'error',
      'event.name': 'finance.api.request.failed',
      'http.route': '/api/financeiro/cobrancas/:id',
      correlationId,
    }));
  });
});
