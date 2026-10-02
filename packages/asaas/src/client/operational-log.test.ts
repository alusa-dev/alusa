import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';
import { logAsaasOperationalEvent } from './operational-log';

describe('Asaas operational logging', () => {
  let restoreTelemetry: (() => void) | undefined;

  afterEach(() => {
    restoreTelemetry?.();
    restoreTelemetry = undefined;
    vi.restoreAllMocks();
  });

  it('uses the public observability singleton', () => {
    const log = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ log });

    logAsaasOperationalEvent({
      eventName: 'asaas.http.request.failed',
      severity: 'error',
      errorType: 'AsaasHttpError',
      method: 'GET',
      route: '/v3/payments',
      status: 503,
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      'event.name': 'asaas.http.request.failed',
      'http.route': '/v3/payments',
    }));
  });

  it('aggregates circuit events without retaining account keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    logAsaasOperationalEvent({ eventName: 'asaas.circuit.opened', severity: 'warn' });
    logAsaasOperationalEvent({ eventName: 'asaas.circuit.opened', severity: 'warn' });
    expect(warn).toHaveBeenCalledTimes(1);
    now += 60_000;
    logAsaasOperationalEvent({ eventName: 'asaas.circuit.opened', severity: 'warn' });

    expect(warn).toHaveBeenCalledTimes(2);
    const summary = JSON.parse(String(warn.mock.calls[1]?.[0])) as {
      'event.name': string;
      attributes?: { count?: number };
    };
    expect(summary['event.name']).toBe('asaas.circuit.opened');
    expect(summary.attributes?.count).toBe(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('api-key-or-account-key');
  });
});
