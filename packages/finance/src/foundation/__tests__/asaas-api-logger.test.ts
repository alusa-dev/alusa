import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetrySink, type TelemetryMetric } from '@alusa/observability';
import { getRecentApiCalls, logAsaasApiCall, resetApiCallStats } from '../asaas-api-logger';

describe('Asaas API telemetry', () => {
  let unsubscribe: (() => void) | undefined;
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    resetApiCallStats();
    vi.restoreAllMocks();
  });

  it('normaliza rota, agrega sucesso e não guarda identificadores de tenant/conta', () => {
    const metrics: TelemetryMetric[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    unsubscribe = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
    logAsaasApiCall({
      method: 'GET', endpoint: '/v3/payments/pay_private-key123', contaId: 'tenant-private',
      accountKey: 'account-private', httpStatus: 200, durationMs: 35, success: true,
    });

    expect(info).not.toHaveBeenCalled();
    expect(metrics[0]).toMatchObject({ name: 'finance.asaas.api.calls', dimensions: { 'http.route': '/v3/payments/:id' } });
    expect(JSON.stringify(getRecentApiCalls())).not.toContain('tenant-private');
    expect(JSON.stringify(getRecentApiCalls())).not.toContain('account-private');
  });

  it('registra falha sem serializar erro bruto ou identificadores', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    unsubscribe = registerTelemetrySink({ metric: () => undefined });
    logAsaasApiCall({
      method: 'POST', endpoint: '/v3/payments', contaId: 'tenant-private', accountKey: 'account-private',
      httpStatus: 500, durationMs: 1_400, success: false, error: 'Bearer secret token customer@example.com',
    });

    const serialized = String(error.mock.calls[0]?.[0]);
    expect(serialized).toContain('finance.asaas.api.failed');
    expect(serialized).not.toContain('tenant-private');
    expect(serialized).not.toContain('account-private');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('Bearer secret');
  });
});
