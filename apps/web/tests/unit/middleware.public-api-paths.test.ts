import { describe, expect, it } from 'vitest';

import { isPublicApiPath } from '@/lib/middleware/public-api-paths';

describe('isPublicApiPath', () => {
  it('identifica rotas de autenticação', () => {
    expect(isPublicApiPath('/api/auth/login/validate')).toBe(true);
    expect(isPublicApiPath('/api/auth/callback/credentials')).toBe(true);
  });

  it('identifica webhooks e jobs', () => {
    expect(isPublicApiPath('/api/webhooks/asaas')).toBe(true);
    expect(isPublicApiPath('/api/jobs/process-finance-webhooks')).toBe(true);
  });

  it('não marca APIs autenticadas do app', () => {
    expect(isPublicApiPath('/api/alunos')).toBe(false);
    expect(isPublicApiPath('/api/dashboard/metrics')).toBe(false);
  });
});
