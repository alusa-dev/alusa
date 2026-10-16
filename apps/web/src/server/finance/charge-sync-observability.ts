import { normalizeMetricDimensions, sharedTelemetry } from '@alusa/observability';
import { shouldSampleMetric } from '@/lib/observability/sampling';

export const CHARGE_SYNC_SOURCE_HEADER = 'x-alusa-sync-source';

export type ChargeSyncSource = 'automatic_fallback' | 'explicit_action';
export type ChargeSyncOutcome = 'success' | 'skipped' | 'failure';
export type ChargeSyncRoute =
  | '/api/cobrancas/:id/sync-asaas'
  | '/api/portal/financeiro/:id';

const SOURCE_VALUES = new Set<ChargeSyncSource>(['automatic_fallback', 'explicit_action']);
const OUTCOME_VALUES = new Set<ChargeSyncOutcome>(['success', 'skipped', 'failure']);
const ROUTE_VALUES = new Set<ChargeSyncRoute>([
  '/api/cobrancas/:id/sync-asaas',
  '/api/portal/financeiro/:id',
]);

export function resolveChargeSyncSource(rawValue: string | null): ChargeSyncSource {
  return rawValue && SOURCE_VALUES.has(rawValue as ChargeSyncSource)
    ? rawValue as ChargeSyncSource
    : 'explicit_action';
}

export function recordChargeSyncTelemetry(
  source: ChargeSyncSource,
  outcome: ChargeSyncOutcome,
  durationMs: number,
  route: ChargeSyncRoute,
): void {
  const safeSource = SOURCE_VALUES.has(source) ? source : 'explicit_action';
  const safeOutcome = OUTCOME_VALUES.has(outcome) ? outcome : 'failure';
  const safeRoute = ROUTE_VALUES.has(route) ? route : '/api/cobrancas/:id/sync-asaas';
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const dimensions = normalizeMetricDimensions(
    {
      'operation.name': `finance.charge_sync.${safeSource}`,
      result: safeOutcome,
      'http.route': safeRoute,
    },
    ['operation.name', 'result', 'http.route'],
  );

  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.finance.charge_sync.request',
    value: 1,
    dimensions,
  });
  if (shouldSampleMetric(process.env.OBSERVABILITY_METRIC_SAMPLE_RATE)) {
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.finance.charge_sync.duration',
      value: safeDuration,
      unit: 'millisecond',
      dimensions,
    });
  }
}
