import { createHash, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

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
  console.error(`[${route}]`, {
    correlationId,
    ...extra,
    error: error instanceof Error ? error.message : String(error),
  });
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
  contaId?: string;
  durationMs: number;
  cacheHit?: CacheState;
  correlationId?: string;
  cold?: boolean;
};

export function logFinanceApiRequest(route: string, meta: FinanceApiObservabilityMeta) {
  if (process.env.PERF_LOGS !== '1' && process.env.NODE_ENV === 'production') {
    return;
  }

  console.info('[finance-api]', {
    route,
    contaId: meta.contaId,
    durationMs: meta.durationMs,
    cacheHit: meta.cacheHit,
    correlationId: meta.correlationId,
    cold: meta.cold ?? (meta.cacheHit === 'MISS' || meta.cacheHit === 'BYPASS'),
  });
}

export async function measureFinanceApi<T>(
  route: string,
  contaId: string | undefined,
  run: () => Promise<T>,
  extra: Omit<FinanceApiObservabilityMeta, 'contaId' | 'durationMs'> = {},
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    logFinanceApiRequest(route, {
      contaId,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
  }
}
