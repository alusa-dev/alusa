import { afterEach, describe, expect, it } from 'vitest';

import { enforceApiRateLimit } from '@/lib/security/api-rate-limit';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('API rate limit policy', () => {
  it('does not rate-limit webhook/auth namespaces globally', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';

    await expect(
      enforceApiRateLimit(new Request('https://app.example.com/api/webhooks/asaas', { method: 'POST' }), '/api/webhooks/asaas'),
    ).resolves.toBeNull();
    await expect(
      enforceApiRateLimit(new Request('https://app.example.com/api/auth/login', { method: 'POST' }), '/api/auth/login'),
    ).resolves.toBeNull();
  });

  it('uses tenant and user identity for authenticated reads', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'true';

    await expect(
      enforceApiRateLimit(new Request('https://app.example.com/api/alunos'), '/api/alunos', {
        contaId: 'conta-a',
        id: 'user-a',
      }),
    ).resolves.toBeNull();
  });

  it('limita ingestão pública de Web Vitals por IP e método', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    process.env.TRUST_PROXY_HEADERS = 'true';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;

    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const request = () => new Request('https://app.example.com/api/observability/web-vitals', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, 'user-agent': 'web-vitals-test' },
    });

    await expect(
      enforceApiRateLimit(new Request('https://app.example.com/api/observability/web-vitals'), '/api/observability/web-vitals'),
    ).resolves.toBeNull();

    let response: Response | null = null;
    for (let index = 0; index < 61; index += 1) {
      response = await enforceApiRateLimit(request(), '/api/observability/web-vitals');
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get('ratelimit-limit')).toBe('60');
  });

  it('falha fechado para Web Vitals em produção se o rate limiter distribuído estiver indisponível', async () => {
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;

    const response = await enforceApiRateLimit(
      new Request('https://app.example.com/api/observability/web-vitals', { method: 'POST' }),
      '/api/observability/web-vitals',
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get('retry-after')).toBe('5');
  });

  it('returns a stable 429 contract for an expensive operation', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;
    const request = () => new Request('https://app.example.com/api/financeiro/relatorios', { method: 'POST' });
    const token = { contaId: `conta-${Date.now()}`, id: `user-${Date.now()}` };

    let response: Response | null = null;
    for (let index = 0; index < 11; index += 1) {
      response = await enforceApiRateLimit(request(), '/api/financeiro/relatorios', token);
    }

    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(response?.headers.get('ratelimit-limit')).toBe('10');
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Muitas requisições. Tente novamente mais tarde.',
      },
    });
  });

  it('gives report reads their own budget and keeps exports on the expensive-operation limit', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;

    const suffix = `${Date.now()}-${Math.random()}`;
    const token = { contaId: `reports-conta-${suffix}`, id: `reports-user-${suffix}` };
    const overviewPath = ['', 'api', 'financeiro', 'relatorios', 'overview'].join('/');
    const overviewRequest = () => new Request(
      `https://app.example.com${overviewPath}`,
    );

    let overviewResponse: Response | null = null;
    for (let index = 0; index < 61; index += 1) {
      overviewResponse = await enforceApiRateLimit(
        overviewRequest(),
        overviewPath,
        token,
      );
    }

    expect(overviewResponse?.status).toBe(429);
    expect(overviewResponse?.headers.get('ratelimit-limit')).toBe('60');

    const exportToken = { contaId: `export-conta-${suffix}`, id: `export-user-${suffix}` };
    const exportPath = ['', 'api', 'financeiro', 'relatorios', 'export'].join('/');
    const exportRequest = () => new Request(
      `https://app.example.com${exportPath}`,
    );
    let exportResponse: Response | null = null;
    for (let index = 0; index < 11; index += 1) {
      exportResponse = await enforceApiRateLimit(
        exportRequest(),
        exportPath,
        exportToken,
      );
    }

    expect(exportResponse?.status).toBe(429);
    expect(exportResponse?.headers.get('ratelimit-limit')).toBe('10');
  });
});
