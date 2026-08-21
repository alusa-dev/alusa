/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSessionMock, revokeUserSessionsMock, auditRecordMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  revokeUserSessionsMock: vi.fn(),
  auditRecordMock: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/lib/auth-service', () => ({ revokeUserSessions: revokeUserSessionsMock }));
vi.mock('@alusa/finance', () => ({ auditLogService: { record: auditRecordMock } }));

import { POST } from '@/app/api/auth/revoke-all-sessions/route';

function request(cookie = 'next-auth.session-token.0=part0; next-auth.session-token.1=part1') {
  return new NextRequest('http://localhost:3000/api/auth/revoke-all-sessions', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000/conta/seguranca',
      cookie,
    },
  });
}

describe('POST /api/auth/revoke-all-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user_1', contaId: 'conta_1' } });
    revokeUserSessionsMock.mockResolvedValue(1);
    auditRecordMock.mockResolvedValue(undefined);
  });

  it('revoga todas as sessões e limpa os cookies atuais', async () => {
    const response = await POST(request());
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(revokeUserSessionsMock).toHaveBeenCalledWith('user_1');
    expect(auditRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.sessions_revoked',
      entity: { type: 'Usuario', id: 'user_1' },
    }));
    expect(cookies).toContain('next-auth.session-token.0=;');
    expect(cookies).toContain('next-auth.session-token.1=;');
  });

  it('não aceita a operação sem sessão', async () => {
    getServerSessionMock.mockResolvedValueOnce(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(revokeUserSessionsMock).not.toHaveBeenCalled();
  });

  it('rejeita origem não confiável', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/auth/revoke-all-sessions', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.example',
          referer: 'https://attacker.example/page',
        },
      }),
    );

    expect(response.status).toBe(403);
    expect(getServerSessionMock).not.toHaveBeenCalled();
    expect(revokeUserSessionsMock).not.toHaveBeenCalled();
  });

  it('falha sem expor detalhes quando o banco está indisponível', async () => {
    revokeUserSessionsMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Não foi possível revogar as sessões.',
    });
  });
});
