import { afterEach, describe, expect, it, vi } from 'vitest';

import { sharedTelemetry, type TelemetryMetric } from '@alusa/observability';
import {
  recordChargeSyncTelemetry,
  resolveChargeSyncSource,
  type ChargeSyncOutcome,
  type ChargeSyncRoute,
  type ChargeSyncSource,
} from '@/src/server/finance/charge-sync-observability';

describe('charge sync telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('accepts only the two fixed source values', () => {
    expect(resolveChargeSyncSource('automatic_fallback')).toBe('automatic_fallback');
    expect(resolveChargeSyncSource(null)).toBe('explicit_action');
    expect(resolveChargeSyncSource('tenant-123')).toBe('explicit_action');
  });

  it('records fixed source/outcome dimensions and duration for each outcome', async () => {
    vi.stubEnv('OBSERVABILITY_METRIC_SAMPLE_RATE', '1');
    const records: TelemetryMetric[] = [];
    const restore = sharedTelemetry.replaceSink({
      metric: (record) => records.push(record),
    });

    recordChargeSyncTelemetry('automatic_fallback', 'success', 12, '/api/cobrancas/:id/sync-asaas');
    recordChargeSyncTelemetry('explicit_action', 'skipped', 4, '/api/portal/financeiro/:id');
    recordChargeSyncTelemetry('automatic_fallback', 'failure', 99, '/api/cobrancas/:id/sync-asaas');
    await Promise.resolve();
    restore();

    const requests = records.filter((record) => record.name === 'alusa.finance.charge_sync.request');
    const durations = records.filter((record) => record.name === 'alusa.finance.charge_sync.duration');
    expect(requests).toHaveLength(3);
    expect(durations.map((record) => record.value)).toEqual([12, 4, 99]);
    expect(requests.map((record) => record.dimensions)).toEqual([
      {
        'operation.name': 'finance.charge_sync.automatic_fallback',
        result: 'success',
        'http.route': '/api/cobrancas/:id/sync-asaas',
      },
      {
        'operation.name': 'finance.charge_sync.explicit_action',
        result: 'skipped',
        'http.route': '/api/portal/financeiro/:id',
      },
      {
        'operation.name': 'finance.charge_sync.automatic_fallback',
        result: 'failure',
        'http.route': '/api/cobrancas/:id/sync-asaas',
      },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/contaId|userId|chargeId|paymentId|payload|secret/i);
  });

  it('falls back to safe labels for invalid dimensions and duration', async () => {
    vi.stubEnv('OBSERVABILITY_METRIC_SAMPLE_RATE', '1');
    const records: TelemetryMetric[] = [];
    const restore = sharedTelemetry.replaceSink({ metric: (record) => records.push(record) });
    recordChargeSyncTelemetry(
      'tenant-123' as ChargeSyncSource,
      'payment-id-123' as ChargeSyncOutcome,
      Number.NaN,
      '/api/cobrancas/charge-123/sync-asaas' as ChargeSyncRoute,
    );
    await Promise.resolve();
    restore();

    expect(records[0]?.dimensions).toEqual({
      'operation.name': 'finance.charge_sync.explicit_action',
      result: 'failure',
      'http.route': '/api/cobrancas/:id/sync-asaas',
    });
    expect(records[1]?.value).toBe(0);
  });
});
