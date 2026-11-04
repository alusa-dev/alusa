import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/auth/verify-email/route';

const { acceptInviteApplicationMock, verifyEmailByTokenMock } = vi.hoisted(() => ({
  acceptInviteApplicationMock: vi.fn(),
  verifyEmailByTokenMock: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  authRateLimitAsync: vi.fn(async () => ({ ok: true })),
  rateLimitSubject: vi.fn(async (value: string) => value),
}));

vi.mock('@/lib/auth-email-flow', () => ({
  verifyEmailByToken: verifyEmailByTokenMock,
}));

vi.mock('@/src/server/users/invite-acceptance.application-service', () => ({
  acceptInviteApplication: acceptInviteApplicationMock,
}));

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyEmailByTokenMock.mockResolvedValue({ id: 'user-1', email: 'person@example.com' });
    acceptInviteApplicationMock.mockResolvedValue({ status: 200, body: { message: 'ok' } });
  });

  it('retorna 400 quando o body está vazio', async () => {
    const request = new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Token inválido.');
  });

  it('retorna 400 quando o JSON está malformado', async () => {
    const request = new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Token inválido.');
  });

  it('aceita o convite depois de validar o token de confirmação para a identidade confirmada', async () => {
    const response = await POST(new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'verified-token-12345678901234567890', inviteToken: 'invite-bearer' }),
    }));

    expect(response.status).toBe(200);
    expect(acceptInviteApplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      input: { token: 'invite-bearer', email: 'person@example.com' },
      authenticatedUserId: 'user-1',
      sessionEmail: 'person@example.com',
    }));
    await expect(response.json()).resolves.toMatchObject({ ok: true, inviteAccepted: true });
  });

  it('não usa o token do convite como confirmação de e-mail', async () => {
    const response = await POST(new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'verified-token-12345678901234567890' }),
    }));

    expect(response.status).toBe(200);
    expect(acceptInviteApplicationMock).not.toHaveBeenCalled();
  });

  it('mantém o e-mail confirmado e informa convite expirado sem conceder acesso', async () => {
    acceptInviteApplicationMock.mockResolvedValueOnce({ status: 410, body: { error: 'Convite expirado' } });
    const response = await POST(new Request('http://localhost:3000/api/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'verified-token-12345678901234567890', inviteToken: 'expired-invite' }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, inviteAccepted: false, inviteError: 'Convite expirado' });
  });
});
