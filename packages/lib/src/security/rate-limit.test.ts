import { afterEach, describe, expect, it, vi } from 'vitest';

import { strictRateLimitAsync } from './rate-limit';

describe('strictRateLimitAsync', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registra categoria segura para rejeição EVAL e falha fechado', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-test-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'ERR Error compiling script; source contains sensitive detail',
    }), { status: 400 })));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await strictRateLimitAsync('tenant-key', 5, 60_000);

    expect(result).toMatchObject({ ok: false, source: 'unavailable', degraded: true });
    expect(errorLog).toHaveBeenCalledWith('[rate-limit][strict-unavailable]', expect.objectContaining({
      error: 'Redis REST rate limit failed with HTTP 400 [SCRIPT_REJECTED]',
    }));
    const loggedDetails = JSON.stringify(errorLog.mock.calls);
    expect(loggedDetails).not.toContain('sensitive detail');
    expect(loggedDetails).not.toContain('redis-test-secret');
    expect(loggedDetails).not.toContain('redis.example.test');
  });
});
