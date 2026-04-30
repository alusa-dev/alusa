import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getTokenMock, resolveSessionAccessMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  resolveSessionAccessMock: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

vi.mock('@/lib/auth-service', () => ({
  resolveSessionAccess: resolveSessionAccessMock,
}));

import { GET } from '@/app/api/auth/account-access/route';

describe('GET /api/auth/account-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não há sessão válida', async () => {
    getTokenMock.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest('http://localhost:3000/api/auth/account-access'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'UNAUTHENTICATED' });
  });

  it('retorna 403 quando a conta está desativada', async () => {
    getTokenMock.mockResolvedValueOnce({ id: 'user_1', contaId: 'conta_1' });
    resolveSessionAccessMock.mockResolvedValueOnce({ ok: false, reason: 'ACCOUNT_DEACTIVATED' });

    const response = await GET(new NextRequest('http://localhost:3000/api/auth/account-access'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'ACCOUNT_DEACTIVATED' });
  });

  it('retorna 200 quando a sessão segue ativa', async () => {
    getTokenMock.mockResolvedValueOnce({ id: 'user_1', contaId: 'conta_1' });
    resolveSessionAccessMock.mockResolvedValueOnce({ ok: true });

    const response = await GET(new NextRequest('http://localhost:3000/api/auth/account-access'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});