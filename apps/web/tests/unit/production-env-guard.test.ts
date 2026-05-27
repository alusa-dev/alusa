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
      }),
    ).not.toThrow();
  });
});
