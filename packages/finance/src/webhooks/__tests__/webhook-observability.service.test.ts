import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetrySink, type TelemetryMetric, type StructuredLog } from '@alusa/observability';
import {
  alertIfUnknownEvent,
  alertQueueLagCritical,
  alertTokenRejected,
  evaluateWebhookSLOs,
  logWebhookProcessing,
  type WebhookLogEntry,
} from '../webhook-observability.service';

describe('webhook telemetry', () => {
  let unsubscribe: (() => void) | undefined;
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    vi.restoreAllMocks();
  });

  it('agrega métricas de sucesso sem emitir um log por evento', () => {
    const metrics: TelemetryMetric[] = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    unsubscribe = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });

    const entry: WebhookLogEntry = {
      timestamp: new Date().toISOString(), eventName: 'PAYMENT_RECEIVED', eventId: 'evt-private-id',
      category: 'PAYMENT', handled: true, critical: false, impactLevel: 'low', result: 'SUCCESS',
      durationMs: 42, contaId: 'tenant-private-id', correlationId: 'asaas-event:evt-private-id',
    };
    logWebhookProcessing(entry);

    expect(errorLog).not.toHaveBeenCalled();
    expect(metrics).toHaveLength(2);
    expect(JSON.stringify(metrics)).not.toContain('tenant-private-id');
    expect(JSON.stringify(metrics)).not.toContain('evt-private-id');
    expect(metrics[0]).toMatchObject({ kind: 'counter', name: 'finance.webhook.processed' });
  });

  it('registra falhas com contexto técnico sem payload, tenant ou mensagem bruta', () => {
    const logs: StructuredLog[] = [];
    const metrics: TelemetryMetric[] = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    unsubscribe = registerTelemetrySink({ log: (record) => logs.push(record), metric: (metric) => metrics.push(metric) });

    logWebhookProcessing({
      timestamp: new Date().toISOString(), eventName: 'PAYMENT_RECEIVED', eventId: 'evt-private-id',
      category: 'PAYMENT', handled: true, critical: true, impactLevel: 'critical', result: 'ERROR',
      durationMs: 125, contaId: 'tenant-private-id', error: 'Bearer secret customer@example.com',
      correlationId: 'asaas-event:evt-private-id', source: 'WEBHOOK',
    });

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ severity: 'error', 'event.name': 'finance.webhook.processing.failed' });
    expect(JSON.stringify({ logs, metrics })).not.toContain('tenant-private-id');
    expect(JSON.stringify({ logs, metrics })).not.toContain('customer@example.com');
    expect(logs[0]?.correlationId).toBe('asaas-event:evt-private-id');
    expect(logs[0]).not.toHaveProperty('eventId');
  });

  it('normaliza alertas e limita dados e volume de sinais de segurança', () => {
    const logs: StructuredLog[] = [];
    const metrics: TelemetryMetric[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    unsubscribe = registerTelemetrySink({
      log: (record) => logs.push(record),
      metric: (metric) => metrics.push(metric),
    });

    alertIfUnknownEvent('unknown-private-event');
    alertIfUnknownEvent('another-private-event');
    alertTokenRejected({
      tokenHashPrefix: 'private-token-hash',
      event: 'PAYMENT_RECEIVED',
      eventId: 'private-event-id',
    });
    alertTokenRejected({
      tokenHashPrefix: 'another-private-token-hash',
      event: 'PAYMENT_RECEIVED',
      eventId: 'another-private-event-id',
    });
    alertQueueLagCritical({
      level: 'CRITICAL',
      lagSeconds: 360,
      backlog: 520,
      contaId: 'private-tenant-id',
      message: 'Raw operational details',
    });
    alertQueueLagCritical({
      level: 'CRITICAL',
      lagSeconds: 361,
      backlog: 521,
      contaId: 'another-private-tenant-id',
      message: 'More raw operational details',
    });
    const slo = evaluateWebhookSLOs(
      { lagSeconds: 360, backlog: 520, errored: 10, processed: 5, exhausted: 20 },
      { maxLagSeconds: 100, maxBacklog: 100, maxErrorRate: 0.1, maxExhausted: 10 },
    );

    expect(slo.ok).toBe(false);
    expect(logs.map((log) => log['event.name'])).toEqual([
      'finance.webhook.event.unknown',
      'finance.webhook.auth.token_rejected',
      'finance.webhook.queue.lag_alert',
    ]);
    expect(logs[2]).toMatchObject({
      severity: 'error',
      attributes: { 'alert.level': 'critical', 'queue.lag_seconds': 360, 'queue.backlog': 520 },
    });
    expect(logs).toHaveLength(3);
    expect(metrics.filter((metric) => metric.name === 'finance.webhook.unknown_events')).toHaveLength(2);
    expect(metrics.filter((metric) => metric.name === 'finance.webhook.auth.token_rejected')).toHaveLength(2);
    expect(metrics.filter((metric) => metric.name === 'finance.webhook.queue.lag_alerts')).toHaveLength(2);
    expect(metrics.find((metric) => metric.name === 'finance.webhook.queue.lag_alerts')?.dimensions).toEqual({
      provider: 'asaas',
      result: 'critical',
    });
    expect(JSON.stringify({ logs, metrics })).not.toContain('unknown-private-event');
    expect(JSON.stringify({ logs, metrics })).not.toContain('private-token-hash');
    expect(JSON.stringify({ logs, metrics })).not.toContain('private-event-id');
    expect(JSON.stringify({ logs, metrics })).not.toContain('private-tenant-id');
    expect(JSON.stringify({ logs, metrics })).not.toContain('Raw operational details');
  });
});
