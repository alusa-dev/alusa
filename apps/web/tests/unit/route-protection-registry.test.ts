import { describe, expect, it, vi } from 'vitest';

import {
  hasCronSecret,
  resolveRouteProtection,
} from '@/lib/security/route-protection-registry';

describe('route protection registry', () => {
  it('classifica rotas criticas explicitamente', () => {
    expect(resolveRouteProtection('/api/jobs/webhook-scheduler')).toBe('CRON_SECRET');
    expect(resolveRouteProtection('/api/webhooks/asaas')).toBe('WEBHOOK_TOKEN');
    expect(resolveRouteProtection('/api/developer/contas')).toBe('GLOBAL_ADMIN');
    expect(resolveRouteProtection('/api/global-admin/auth/login')).toBe('DEVELOPER_MFA');
    expect(resolveRouteProtection('/api/alunos')).toBe('AUTH_USER');
  });

  it('valida segredo de cron por header dedicado ou bearer', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect(hasCronSecret(new Request('http://localhost', { headers: { 'x-cron-token': 'cron-secret' } }))).toBe(true);
    expect(hasCronSecret(new Request('http://localhost', { headers: { authorization: 'Bearer cron-secret' } }))).toBe(true);
    expect(hasCronSecret(new Request('http://localhost'))).toBe(false);
  });
});
