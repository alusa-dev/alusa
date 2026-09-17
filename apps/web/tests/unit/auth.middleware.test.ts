/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

import proxy from '@/proxy';

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

    const response = await proxy(
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

    const response = await proxy(new NextRequest('http://localhost:3000/dashboard'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('bloqueia páginas /financeiro para usuário autenticado sem papel financeiro', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1',
      contaId: 'conta_1',
      role: 'PROFESSOR',
      emailVerified: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await proxy(new NextRequest('http://localhost:3000/financeiro/pagamentos'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/dashboard');
  });

  it('permite páginas /financeiro para FINANCEIRO', async () => {
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

    const response = await proxy(new NextRequest('http://localhost:3000/financeiro/pagamentos'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('não redireciona POST /api/auth/login/validate sem sessão', async () => {
    const response = await proxy(
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
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/webhooks/asaas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('bloqueia API autenticada comum sem sessão', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await proxy(new NextRequest('http://localhost:3000/api/salas?contaId=conta-b'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('permite API autenticada comum com sessão válida', async () => {
    getTokenMock.mockResolvedValueOnce({ id: 'user_1', contaId: 'conta_1' });

    const response = await proxy(new NextRequest('http://localhost:3000/api/salas?contaId=conta_1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('preserva API de cobrança autenticada para RECEPCAO quando o handler define a operação permitida', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1', contaId: 'conta_1', role: 'RECEPCAO',
    });

    const response = await proxy(new NextRequest('http://localhost:3000/api/cobrancas/cob-1'));

    expect(response.status).toBe(200);
  });

  it('permite API financeira para papel FINANCEIRO', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1', contaId: 'conta_1', role: 'FINANCEIRO',
    });

    const response = await proxy(new NextRequest('http://localhost:3000/api/financeiro/kpis'));

    expect(response.status).toBe(200);
  });

  it('bloqueia API administrativa para papel financeiro sem privilégio de admin', async () => {
    getTokenMock.mockResolvedValueOnce({
      id: 'user_1', contaId: 'conta_1', role: 'FINANCEIRO',
    });

    const response = await proxy(new NextRequest('http://localhost:3000/api/admin/webhooks'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('delega APIs mobile ao Bearer token validado pelo Route Handler', async () => {
    const response = await proxy(
      new NextRequest('http://localhost:3000/api/mobile/agenda', {
        headers: { authorization: 'Bearer mobile-access-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('redireciona páginas protegidas sem sessão para login', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await proxy(new NextRequest('http://localhost:3000/dashboard'));

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

    const response = await proxy(new NextRequest('http://localhost:3000/dashboard'));

    expect(response.headers.get('location')).toBeNull();
  });
});
