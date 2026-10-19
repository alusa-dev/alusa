import { describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';

import {
  logJobFailure,
  logJobResult,
  resolveTenantScopeForJob,
  startJobRun,
} from '@/src/server/jobs/job-observability';

describe('job observability', () => {
  it('registra rejeições de request com dimensões limitadas e sem iniciar execução', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);

    const response = { status: 403 };
    const result = await resolveTenantScopeForJob('example-job', async () => ({
      ok: false,
      response,
      requestUrl: 'https://private.example/path?contaId=tenant-secret',
    }));

    expect(result.response).toBe(response);
    const log = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(log).toMatchObject({
      'event.name': 'job.request_rejected',
      attributes: { jobName: 'example-job', status: 'forbidden' },
    });
    expect(JSON.stringify(log)).not.toMatch(/private\.example|tenant-secret/);
    expect(info).not.toHaveBeenCalled();
    const metrics = recordMetric.mock.calls.map(([metric]) => metric);
    expect(metrics).toContainEqual(expect.objectContaining({
      name: 'alusa.job.request_rejected',
      value: 1,
      dimensions: { 'job.name': 'example-job', result: 'forbidden' },
    }));
    expect(metrics.some((metric) => metric.name === 'alusa.job.started')).toBe(false);
    expect(metrics.some((metric) => metric.name === 'alusa.job.failed')).toBe(false);

    warn.mockRestore();
    info.mockRestore();
    recordMetric.mockRestore();
  });

  it('registra exceção na resolução como rejeição 5xx e preserva a exceção original', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);
    const failure = new Error('private resolver detail');

    await expect(resolveTenantScopeForJob('example-job', async () => {
      throw failure;
    })).rejects.toBe(failure);

    const log = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(log).toMatchObject({
      'event.name': 'job.request_rejected',
      attributes: { jobName: 'example-job', status: 'server_error' },
    });
    expect(JSON.stringify(log)).not.toContain('private resolver detail');
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(
      expect.objectContaining({ name: 'alusa.job.request_rejected', dimensions: { 'job.name': 'example-job', result: 'server_error' } }),
    );
    expect(recordMetric.mock.calls.some(([metric]) => metric.name === 'alusa.job.started' || metric.name === 'alusa.job.failed')).toBe(false);

    warn.mockRestore();
    recordMetric.mockRestore();
  });

  it('correlaciona início, conclusão e falha com UUID por invocação sem propagar campos externos', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const startedAt = Date.now() - 10;
    const run = startJobRun('webhook-scheduler', startedAt);

    logJobResult('webhook-scheduler', run, { processed: 1 });
    logJobFailure('webhook-scheduler', run, { message: 'tenant-secret payload-value' });

    const start = JSON.parse(String(info.mock.calls[0]?.[0]));
    const completed = JSON.parse(String(info.mock.calls[1]?.[0]));
    const failed = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(run.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(start).toMatchObject({
      timestamp: new Date(startedAt).toISOString(),
      'event.name': 'job.started',
      attributes: { jobName: 'webhook-scheduler', correlationId: run.correlationId },
    });
    expect(completed.attributes.correlationId).toBe(run.correlationId);
    expect(failed.attributes.correlationId).toBe(run.correlationId);
    expect(JSON.stringify([start, completed, failed])).not.toMatch(/tenant-secret|payload-value/);
    info.mockRestore();
    error.mockRestore();
  });

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
      { partialFailure: true, attentionRequired: true },
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

  it('classifica atenção requerida separadamente de falha parcial e sucesso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);

    logJobResult(
      'rematriculas-run',
      Date.now(),
      { activationsNeedingAttention: 2, failureDetail: 'private activation data' },
      { attentionRequired: true, partialFailure: false },
    );

    const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      severity: 'warn',
      'event.name': 'job.needs_attention',
      attributes: {
        jobName: 'rematriculas-run',
        activationsNeedingAttention: 2,
        attentionRequired: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('private activation data');
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(
      expect.objectContaining({
        name: 'alusa.job.completed',
        dimensions: expect.objectContaining({ 'job.name': 'rematriculas-run', result: 'needs_attention' }),
      }),
    );
    warn.mockRestore();
    recordMetric.mockRestore();
  });

  it('emite pressão agregada de orçamento Asaas sem convertê-la em contagem genérica', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const recordMetric = vi.spyOn(sharedTelemetry, 'recordMetric').mockImplementation(() => undefined);
    logJobResult('reconcile-finance-webhooks', Date.now(), { asaasCalls: 220 }, {
      maxAsaasCallsPerAccount: 80,
      accountsNearAsaasCallBudget: 1,
      accountsAtAsaasCallBudget: 1,
      maxAsaasCallBudgetUtilizationPercent: 80,
      attentionRequired: true,
      budgetExhausted: true,
      partialFailure: true,
    });
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      'event.name': 'job.partial_failure',
      attributes: {
        maxAsaasCallsPerAccount: 80,
        accountsNearAsaasCallBudget: 1,
        accountsAtAsaasCallBudget: 1,
        maxAsaasCallBudgetUtilizationPercent: 80,
        budgetExhausted: true,
      },
    });
    const metrics = recordMetric.mock.calls.map(([metric]) => metric);
    expect(metrics).toContainEqual(expect.objectContaining({
      name: 'alusa.job.asaas_call_budget_utilization', value: 80, unit: 'percent',
      dimensions: { 'job.name': 'reconcile-finance-webhooks', result: 'near_budget' },
    }));
    expect(metrics.some((metric) => metric.name === 'alusa.job.items' && String(metric.dimensions?.result).includes('budget'))).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/contaId|paymentId|customerId|secret/);
    warn.mockRestore();
    recordMetric.mockRestore();
  });

  it('registra classificação vazia com dimensão fixa e não aceita valores arbitrários', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);

    logJobResult(
      'archive-finance-webhooks',
      Date.now(),
      { selected: 0 },
      { workStatus: 'empty', privateValue: 'tenant-secret' },
    );

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes.workStatus).toBe('empty');
    expect(JSON.stringify(payload)).not.toContain('tenant-secret');
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(
      expect.objectContaining({
        name: 'alusa.job.run.classification',
        value: 1,
        dimensions: { 'job.name': 'archive-finance-webhooks', result: 'empty' },
      }),
    );

    info.mockRestore();
    recordMetric.mockRestore();
  });

  it('registra contagens allowlisted e omite valores não numéricos do resultado', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logJobResult('archive-finance-webhooks', Date.now(), {
      selected: 8,
      archived: 6,
      deletedFromHot: 6,
      webhooksProcessed: 4,
      contractsMaterialized: 3,
      outboxFailed: 1,
      contaId: 'tenant-secret',
      records: [{ payload: 'private-payload' }],
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes).toMatchObject({
      selected: 8,
      archived: 6,
      deletedFromHot: 6,
      webhooksProcessed: 4,
      contractsMaterialized: 3,
      outboxFailed: 1,
    });
    expect(JSON.stringify(payload)).not.toContain('tenant-secret');
    expect(JSON.stringify(payload)).not.toContain('private-payload');
    expect(payload.attributes.records).toBeUndefined();
    info.mockRestore();
  });

  it('emite duração e resultado por etapa sem registrar detalhes de erro ou payload', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const recordMetric = vi
      .spyOn(sharedTelemetry, 'recordMetric')
      .mockImplementation(() => undefined);

    logJobResult('webhook-scheduler', Date.now(), {
      steps: [
        { step: 'drain_queue', ok: true, durationMs: 12, detail: { processed: 4 } },
        { step: 'health_check', ok: false, durationMs: 8, error: 'private detail' },
        { step: 'unsafe-step@example.com', ok: false, durationMs: 9 },
      ],
    });

    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes.steps).toEqual([
      { step: 'drain_queue', ok: true, durationMs: 12, counts: { processed: 4 } },
      { step: 'health_check', ok: false, durationMs: 8, counts: {} },
    ]);
    expect(JSON.stringify(payload)).not.toContain('private detail');
    expect(JSON.stringify(payload)).not.toContain('example.com');
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(
      expect.objectContaining({
        name: 'alusa.job.step.duration',
        value: 8,
        dimensions: expect.objectContaining({ 'job.step': 'health_check', result: 'error' }),
      }),
    );

    info.mockRestore();
    recordMetric.mockRestore();
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

  it('registra contagens seguras por etapa com dimensões fixas', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const recordMetric = vi.spyOn(sharedTelemetry, 'recordMetric').mockImplementation(() => undefined);
    logJobResult('webhook-scheduler', Date.now(), {
      steps: [{
        step: 'archive',
        ok: true,
        durationMs: 1,
        detail: { scanned: 12, eligible: 2, enqueued: 1, deletedFromHot: 3, contaId: 'tenant-secret', payload: { email: 'private@example.com' } },
      }],
    });
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes.steps).toEqual([{
      step: 'archive',
      ok: true,
      durationMs: 1,
      counts: { scanned: 12, eligible: 2, enqueued: 1, deletedFromHot: 3 },
    }]);
    expect(JSON.stringify(payload)).not.toMatch(/tenant-secret|private@example.com/);
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(expect.objectContaining({
      name: 'alusa.job.step.items',
      value: 3,
      dimensions: { 'job.name': 'webhook-scheduler', 'job.step': 'archive', result: 'deletedfromhot' },
    }));
    expect(recordMetric.mock.calls.map(([metric]) => metric)).toContainEqual(expect.objectContaining({
      name: 'alusa.job.step.items',
      value: 12,
      dimensions: { 'job.name': 'webhook-scheduler', 'job.step': 'archive', result: 'scanned' },
    }));
    info.mockRestore();
    recordMetric.mockRestore();
  });

  it('records only allowlisted aggregate counts for multi-stage jobs', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logJobResult('reconcile-payment-commands', Date.now(), {
      commandsScanned: 3,
      outboundOperationsScanned: 2,
      enrollmentCreationsInspected: 1,
      contractNotificationsClaimed: 4,
      whatsappOutboxSent: 2,
      eligibleClosures: 5,
      staleCommandsScanned: 6,
      staleCommandsMarked: 2,
      storageObjectsDeleted: 3,
      reservationsUpdated: 1,
      privateTenantId: 'tenant-secret',
    });
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.attributes).toMatchObject({
      commandsScanned: 3,
      outboundOperationsScanned: 2,
      enrollmentCreationsInspected: 1,
      contractNotificationsClaimed: 4,
      whatsappOutboxSent: 2,
      eligibleClosures: 5,
      staleCommandsScanned: 6,
      staleCommandsMarked: 2,
      storageObjectsDeleted: 3,
      reservationsUpdated: 1,
    });
    expect(JSON.stringify(payload)).not.toContain('tenant-secret');
    info.mockRestore();
  });
});
