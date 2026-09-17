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
});
