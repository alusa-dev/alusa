import { afterEach, describe, expect, it, vi } from 'vitest';

import { logFinanceApiRequest } from '@/lib/api/finance-api-response';

describe('finance-api-response observability', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('emite log estruturado quando PERF_LOGS=1', () => {
    vi.stubEnv('PERF_LOGS', '1');
    vi.stubEnv('NODE_ENV', 'production');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logFinanceApiRequest('GET /api/financeiro/kpis', {
      contaId: 'conta-1',
      durationMs: 42,
      cacheHit: 'HIT',
    });

    expect(infoSpy).toHaveBeenCalledWith('[finance-api]', {
      route: 'GET /api/financeiro/kpis',
      contaId: 'conta-1',
      durationMs: 42,
      cacheHit: 'HIT',
      correlationId: undefined,
      cold: false,
    });
  });
});
