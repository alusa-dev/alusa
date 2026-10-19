import { describe, expect, it, vi } from 'vitest';

import {
  hasCronSecret,
  resolveRouteProtection,
} from '@/lib/security/route-protection-registry';

describe('route protection registry', () => {
  it('classifica rotas criticas explicitamente', () => {
    expect(resolveRouteProtection('/api/jobs/webhook-scheduler')).toBe('CRON_SECRET');
    expect(resolveRouteProtection('/api/webhooks/asaas')).toBe('WEBHOOK_TOKEN');
    expect(resolveRouteProtection('/api/mobile/auth/login')).toBe('PUBLIC');
    expect(resolveRouteProtection('/api/mobile/agenda')).toBe('MOBILE_ACCESS_TOKEN');
    expect(resolveRouteProtection('/api/admin/contas')).toBe('TENANT_ADMIN');
    expect(resolveRouteProtection('/api/financeiro/kpis')).toBe('TENANT_FINANCE');
    expect(resolveRouteProtection('/api/finance/charges')).toBe('TENANT_FINANCE');
    expect(resolveRouteProtection('/api/cobrancas/cob-1')).toBe('AUTH_USER');
    expect(resolveRouteProtection('/api/alunos')).toBe('AUTH_USER');
    expect(resolveRouteProtection('/api/assets/asaas-seal')).toBe('PUBLIC');
    expect(resolveRouteProtection('/api/health')).toBe('PUBLIC');
    expect(resolveRouteProtection('/api/health/env')).toBe('PUBLIC');
  });

  it('valida segredo de cron por header dedicado ou bearer', () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect(hasCronSecret(new Request('http://localhost', { headers: { 'x-cron-token': 'cron-secret' } }))).toBe(true);
    expect(hasCronSecret(new Request('http://localhost', { headers: { authorization: 'Bearer cron-secret' } }))).toBe(true);
    expect(hasCronSecret(new Request('http://localhost'))).toBe(false);
  });

  it('mantém CRON_SECRET como bearer canônico quando o segredo legado diverge', () => {
    vi.stubEnv('CRON_SECRET', 'canonical-secret');
    vi.stubEnv('CRON_SECRET_TOKEN', 'legacy-secret');
    expect(hasCronSecret(new Request('http://localhost', { headers: { authorization: 'Bearer canonical-secret' } }))).toBe(true);
    expect(hasCronSecret(new Request('http://localhost', { headers: { authorization: 'Bearer legacy-secret' } }))).toBe(false);
    expect(hasCronSecret(new Request('http://localhost', { headers: { 'x-cron-token': 'legacy-secret' } }))).toBe(true);
  });

  it('mantém bearer legado somente quando CRON_SECRET não está configurado', () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('CRON_SECRET_TOKEN', 'legacy-secret');
    expect(hasCronSecret(new Request('http://localhost', { headers: { authorization: 'Bearer legacy-secret' } }))).toBe(true);
  });
});
