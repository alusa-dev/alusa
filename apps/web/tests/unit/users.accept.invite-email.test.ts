import { beforeEach, describe, expect, it, vi } from 'vitest';

const { acceptInviteMock, sendEmailVerificationForUserMock, hashPasswordMock } = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  sendEmailVerificationForUserMock: vi.fn(),
  hashPasswordMock: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    invite: {
      findUnique: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@alusa/lib', () => ({
  InviteUserService: {
    acceptInvite: acceptInviteMock,
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/auth-password', () => ({
  hashPassword: hashPasswordMock,
  passwordPolicyMessage: 'Senha inválida',
}));

vi.mock('@/lib/auth-email-flow', () => ({
  sendEmailVerificationForUser: sendEmailVerificationForUserMock,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

import { POST } from '@/app/api/users/accept/route';

describe('/api/users/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hashPasswordMock.mockResolvedValue('hashed-password');
    prismaMock.invite.findUnique.mockResolvedValue({
      email: null,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
    });
    prismaMock.usuario.findFirst.mockResolvedValue(null);
    acceptInviteMock.mockResolvedValue({
      id: 'user-1',
      email: 'responsavel@example.com',
      role: 'RESPONSAVEL',
      contaId: 'conta-1',
    });
  });

  it('encaminha o email digitado para convites sem email fixo', async () => {
    const response = await POST(
      new Request('http://x/api/users/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'invite-token',
          name: 'Responsável Teste',
          password: 'Abcdef1!',
          email: 'responsavel@example.com',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(acceptInviteMock).toHaveBeenCalledWith(
      'invite-token',
      'Responsável Teste',
      'hashed-password',
      'responsavel@example.com',
    );
    expect(json.user.email).toBe('responsavel@example.com');
    expect(sendEmailVerificationForUserMock).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      expect.any(Object),
    );
  });
});
