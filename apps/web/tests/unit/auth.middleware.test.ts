/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getTokenMock, verifyGlobalAdminSessionTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  verifyGlobalAdminSessionTokenMock: vi.fn(async () => null),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

vi.mock('@/features/global-admin/auth/session', () => ({
  GLOBAL_ADMIN_SESSION_COOKIE: 'alusa.global_admin.session',
  verifyGlobalAdminSessionToken: verifyGlobalAdminSessionTokenMock,
}));

import middleware from '@/middleware';

describe('auth middleware', () => {
  beforeEach(() => {
    delete process.env.TEST_ROUTES_ENABLED;
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('redireciona conta desativada para login e limpa cookies da sessão', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1',
      contaId: 'conta_1',
      role: 'ADMIN',
      emailVerified: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, reason: 'ACCOUNT_DEACTIVATED' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await middleware(
      new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'next-auth.session-token=session-token' },
      }),
    );

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/auth/login?callbackUrl=%2Fdashboard&account=deactivated',
    );
    expect(response.cookies.get('next-auth.session-token')?.value).toBe('');
  });

  it('permite a navegação quando a conta segue ativa', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1',
      contaId: 'conta_1',
      role: 'FINANCEIRO',
      emailVerified: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await middleware(new NextRequest('http://localhost:3000/dashboard'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('não redireciona POST /api/auth/login/validate sem sessão', async () => {
    const response = await middleware(
      new NextRequest('http://localhost:3000/api/auth/login/validate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          referer: 'http://localhost:3000/auth/login',
        },
      }),
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('permite webhooks sem sessão', async () => {
    const response = await middleware(
      new NextRequest('http://localhost:3000/api/webhooks/asaas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('redireciona páginas protegidas sem sessão para login', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await middleware(new NextRequest('http://localhost:3000/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth/login');
  });

  it('permite dashboard para conta externa pendente e deixa a coleta da API key para o modal persistente', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1',
      contaId: 'conta_1',
      role: 'ADMIN',
      emailVerified: true,
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
      externalAsaasOnboardingStatus: 'PENDING_CONFIGURATION',
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await middleware(new NextRequest('http://localhost:3000/dashboard'));

    expect(response.headers.get('location')).toBeNull();
  });
});