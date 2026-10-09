import { describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';

import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

describe('job observability', () => {
  it('registra contagens dos jobs de ingressos e mantém a lista de campos permitidos', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);

    logJobResult('events-jobs', Date.now(), {
      expired: 2,
      consistent: 3,
      issued: 4,
      inspected: 5,
      findingCount: 6,
      arbitraryCount: 7,
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes).toMatchObject({
      expired: 2,
      consistent: 3,
      issued: 4,
      inspected: 5,
      findingCount: 6,
    });
    expect(payload.attributes.arbitraryCount).toBeUndefined();
    const metrics = recordMetric.mock.calls.map(([metric]) => metric);
    expect(metrics).toContainEqual(
      expect.objectContaining({
        name: 'alusa.job.items',
        value: 2,
        dimensions: expect.objectContaining({ result: 'expired' }),
      }),
    );
    expect(metrics).toContainEqual(
      expect.objectContaining({
        name: 'alusa.job.items',
        value: 6,
        dimensions: expect.objectContaining({ result: 'findingcount' }),
      }),
    );
    expect(
      metrics.some(
        (metric) =>
          metric.name === 'alusa.job.items' && metric.dimensions?.result === 'arbitraryCount',
      ),
    ).toBe(false);

    info.mockRestore();
    recordMetric.mockRestore();
  });

  it('registra apenas métricas numéricas do resultado', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logJobResult(
      'example-job',
      Date.now() - 10,
      { processed: 3, failed: 1, results: [{ sensitive: 'value' }] },
      { dryRun: false },
    );

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      severity: 'info',
      'event.name': 'job.completed',
      attributes: {
        jobName: 'example-job',
        processed: 3,
        failed: 1,
        dryRun: false,
      },
    });
    expect(payload.attributes.results).toBeUndefined();
    info.mockRestore();
  });

  it('não serializa a mensagem de erro para logs de falha desconhecida', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logJobFailure('example-job', Date.now(), { secret: 'not-logged' });

    const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      'event.name': 'job.failed',
      'error.type': 'unknown_error',
      attributes: { jobName: 'example-job' },
    });
    expect(JSON.stringify(payload)).not.toContain('not-logged');
    error.mockRestore();
  });

  it('identifica falha parcial como resultado distinto de sucesso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logJobResult(
      'reconcile-asaas-customers',
      Date.now() - 10,
      { scanned: 2, failed: 1 },
      { partialFailure: true },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      severity: 'warn',
      'event.name': 'job.partial_failure',
      attributes: { jobName: 'reconcile-asaas-customers', failed: 1, partialFailure: true },
    });
    warn.mockRestore();
    info.mockRestore();
  });

  it('limita error.type a nomes seguros de erro', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsafeError = new Error('sensitive message');
    unsafeError.name = 'Error: customer@example.com';

    logJobFailure('example-job', Date.now(), unsafeError);

    const payload = JSON.parse(String(errorLog.mock.calls[0]?.[0]));
    expect(payload['error.type']).toBe('Error');
    expect(JSON.stringify(payload)).not.toContain('customer@example.com');
    errorLog.mockRestore();
  });
});
