import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionUser } from '@/lib/auth/session';

import { withBillingAgreementRequest } from './http';

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: vi.fn(),
}));

const mockedGetSessionUser = vi.mocked(getSessionUser);

describe('withBillingAgreementRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão institucional', async () => {
    mockedGetSessionUser.mockResolvedValue(null);
    const response = await withBillingAgreementRequest(async () => NextResponse.json({ ok: true }));

    expect(response.status).toBe(401);
  });

  it('retorna 403 para perfil sem permissão financeira ou de matrícula', async () => {
    mockedGetSessionUser.mockResolvedValue({ id: 'user-1', contaId: 'conta-a', role: 'PROFESSOR' });
    const response = await withBillingAgreementRequest(async () => NextResponse.json({ ok: true }));

    expect(response.status).toBe(403);
  });

  it('propaga somente contaId e ator obtidos da sessão', async () => {
    mockedGetSessionUser.mockResolvedValue({ id: 'user-1', contaId: 'conta-a', role: 'FINANCEIRO' });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await withBillingAgreementRequest(handler);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith({ contaId: 'conta-a', actorId: 'user-1' });
  });
});
