import { describe, expect, it } from 'vitest';

import { assertProductionSecurityEnv } from '@/lib/security/production-env-guard';

describe('production env guard', () => {
  it('falha em producao sem RLS runtime obrigatorio', () => {
    expect(() =>
      assertProductionSecurityEnv({
        NODE_ENV: 'production',
        RLS_RUNTIME_ENABLED: 'false',
        DATABASE_RLS_URL: '',
      }),
    ).toThrow(/RLS_RUNTIME_ENABLED=true/);
  });

  it('permite producao com RLS habilitado e URL dedicada', () => {
    expect(() =>
      assertProductionSecurityEnv({
        NODE_ENV: 'production',
        RLS_RUNTIME_ENABLED: 'true',
        DATABASE_RLS_URL: 'postgresql://rls@example/db',
        ASAAS_REDIS_ENABLED: 'true',
        UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
        UPSTASH_REDIS_REST_TOKEN: 'token',
        ASAAS_WEBHOOK_STRICT_HTTP_REJECTIONS: 'true',
        ASAAS_WEBHOOK_AUTH_TOKEN_SECRET: 'a-secure-webhook-secret',
        ASAAS_WEBHOOK_PUBLIC_BASE_URL: 'https://app.example.com',
        CRON_SECRET: 'cron-secret',
        CACHE_LAYER_ENABLED: 'true',
        REDIS_CACHE_ENABLED: 'true',
      }),
    ).not.toThrow();
  });
});
