import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('rateLimitAsync', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('usa fallback em memoria quando Redis REST nao esta configurado', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TOKEN;

    const { rateLimitAsync } = await import('@/lib/rate-limit');
    const key = `unit-memory-${Date.now()}`;

    await expect(rateLimitAsync(key, 1, 1_000)).resolves.toMatchObject({ ok: true, remaining: 0 });
    await expect(rateLimitAsync(key, 1, 1_000)).resolves.toMatchObject({ ok: false, remaining: 0 });
  });

  it('usa Redis REST quando configurado', async () => {
    process.env.RATE_LIMIT_DISABLE_IN_DEV = 'false';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 5_000 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { rateLimitAsync } = await import('@/lib/rate-limit');
    const result = await rateLimitAsync('tenant:conta-1', 3, 60_000);

    expect(result).toMatchObject({ ok: true, remaining: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer redis-token',
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual([
      'INCR',
      'alusa:test:rate-limit:tenant:conta-1',
    ]);
  });
});
