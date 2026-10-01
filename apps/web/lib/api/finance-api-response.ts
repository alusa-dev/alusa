import { createHash, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import {
  createStructuredLog,
  normalizeHttpRoute,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';
import { shouldSampleMetric } from '@/lib/observability/sampling';

import type { CacheState } from '@/lib/private-cache';

export function financeJsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export function logFinanceApiError(
  route: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const correlationId = randomUUID();
  const log = createStructuredLog({
    severity: 'error',
    'service.name': 'alusa-web',
    'service.version': process.env.VERCEL_GIT_COMMIT_SHA,
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': 'finance.api.request.failed',
    correlationId,
    'http.route': routePath(route),
    'error.type': safeErrorType(error),
  });
  // Keep call compatibility for legacy callers; arbitrary metadata never enters telemetry.
  void extra;
  console.error(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
  return correlationId;
}

export function financeInternalError(
  route: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const correlationId = logFinanceApiError(route, error, extra);
  return financeJsonError(
    500,
    'ERRO_INTERNO',
    'Não foi possível concluir a operação financeira agora.',
    { correlationId },
  );
}

export function stableQueryFingerprint(input: Record<string, unknown>) {
  return createHash('sha1')
    .update(JSON.stringify(input, Object.keys(input).sort()))
    .digest('hex')
    .slice(0, 12);
}

export type FinanceApiObservabilityMeta = {
  durationMs: number;
  cacheHit?: CacheState;
  correlationId?: string;
};

export function logFinanceApiRequest(route: string, meta: FinanceApiObservabilityMeta) {
  const normalizedRoute = routePath(route);
  const dimensions = normalizeMetricDimensions({
    'http.route': normalizedRoute,
    'cache.state': meta.cacheHit ?? 'unknown',
  });
  void sharedTelemetry.recordMetric({
    kind: 'counter',
    name: 'alusa.finance.api.requests',
    value: 1,
    dimensions,
  });
  if (
    Number.isFinite(meta.durationMs) &&
    meta.durationMs >= 0 &&
    shouldSampleMetric(process.env.OBSERVABILITY_METRIC_SAMPLE_RATE)
  ) {
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: 'alusa.finance.api.duration',
      value: meta.durationMs,
      unit: 'millisecond',
      dimensions,
    });
  }

  if (meta.durationMs < 2_000) return;
  const log = createStructuredLog({
    severity: 'warn',
    'service.name': 'alusa-web',
    'service.version': process.env.VERCEL_GIT_COMMIT_SHA,
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': 'finance.api.request.slow',
    correlationId: safeCorrelationId(meta.correlationId),
    'http.route': normalizedRoute,
    duration_ms: meta.durationMs,
    attributes: meta.cacheHit ? { cacheState: meta.cacheHit } : undefined,
    allowedAttributes: ['cacheState'],
  });
  console.warn(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}

export async function measureFinanceApi<T>(
  route: string,
  contaId: string | undefined,
  run: () => Promise<T>,
  extra: Omit<FinanceApiObservabilityMeta, 'durationMs'> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    logFinanceApiRequest(route, {
      durationMs: Date.now() - startedAt,
      ...extra,
    });
  }
}

function routePath(route: string): string {
  const parts = route.trim().split(/\s+/, 2);
  const candidate = parts.length === 2 && /^[A-Z]+$/.test(parts[0]) ? parts[1] : route;
  return normalizeHttpRoute(candidate);
}

function safeErrorType(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error';
}

function safeCorrelationId(value?: string): string | undefined {
  return value && /^[a-zA-Z0-9:._-]{8,128}$/.test(value) ? value : undefined;
}
