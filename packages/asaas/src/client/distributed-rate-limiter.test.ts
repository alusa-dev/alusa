import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAsaasDistributedRateLimit } from './distributed-rate-limiter';

describe('checkAsaasDistributedRateLimit', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('retorna null sem configuração Redis', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    await expect(checkAsaasDistributedRateLimit({
      key: 'ip:127.0.0.1',
      maxRequests: 200,
      windowMs: 60_000,
    })).resolves.toBeNull();
  });

  it('usa uma reserva atômica EVAL e interpreta a resposta do Redis', async () => {
    process.env.ASAAS_REDIS_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = '  https://redis.example.com  ';
    process.env.UPSTASH_REDIS_REST_TOKEN = '  test-token\n';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: [1, 199, 59_000] }), { status: 200 }),
    );

    const result = await checkAsaasDistributedRateLimit({
      key: 'conta:conta-1:token:abc:ip:127.0.0.1',
      maxRequests: 200,
      windowMs: 60_000,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 199,
      resetMs: 59_000,
      backend: 'redis',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://redis.example.com');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody[0]).toBe('EVAL');
    expect(String(requestBody[3])).toContain('conta-1');
    expect(String(requestBody[3])).toContain('ip:127_0_0_1');
    expect(String(requestBody[1])).toContain('PEXPIRE');
  });
});
