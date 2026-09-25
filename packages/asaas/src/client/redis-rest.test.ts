import { afterEach, describe, expect, it, vi } from 'vitest';

import { asaasRedisCommand, getAsaasRedisConfig } from './redis-rest';

describe('Asaas Redis REST client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('classifica falha do script sem expor mensagem remota, URL ou token', async () => {
    vi.stubEnv('ASAAS_REDIS_ENABLED', 'true');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-test-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'ERR Error compiling script; source contains sensitive detail',
    }), { status: 400 })));

    const config = getAsaasRedisConfig();
    await expect(asaasRedisCommand(config!, ['PING'])).rejects.toThrow('Redis REST 400 [SCRIPT_REJECTED]');
    await expect(asaasRedisCommand(config!, ['PING'])).rejects.not.toThrow('sensitive detail');
    await expect(asaasRedisCommand(config!, ['PING'])).rejects.not.toThrow('redis-test-secret');
    await expect(asaasRedisCommand(config!, ['PING'])).rejects.not.toThrow('redis.example.test');
  });

  it('classifica erros de autenticação sem retornar corpo do provedor', async () => {
    vi.stubEnv('ASAAS_REDIS_ENABLED', 'true');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-test-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'invalid authorization token',
    }), { status: 401 })));

    const config = getAsaasRedisConfig();
    await expect(asaasRedisCommand(config!, ['PING'])).rejects.toThrow('Redis REST 401 [AUTH_REJECTED]');
  });
});
