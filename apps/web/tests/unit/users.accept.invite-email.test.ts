import { beforeEach, describe, expect, it, vi } from 'vitest';

const { acceptInviteMock, sendEmailVerificationForUserMock, hashPasswordMock, serviceErrors } = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  sendEmailVerificationForUserMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  serviceErrors: {
    ExpiredInviteError: class extends Error {},
    InvalidInviteError: class extends Error {},
    MissingInviteEmailError: class extends Error {},
    UserAlreadyLinkedError: class extends Error {},
    DuplicateInviteError: class extends Error {},
    InviteStateConflictError: class extends Error {},
    ExistingAccountAuthenticationRequiredError: class extends Error {},
    MissingGuardianRecordError: class extends Error {},
    InvalidGuardianStudentsError: class extends Error {},
    StudentAlreadyLinkedError: class extends Error {},
    GuardianProfileConflictError: class extends Error {},
    MissingGuardianDataError: class extends Error {},
    UserInactiveError: class extends Error {},
  },
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    invite: {
      findUnique: vi.fn(),
    },
    usuario: {
      findFirst: vi.fn(),
    },
    usuarioConta: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@alusa/lib/server/services/invite-user-service', () => ({
  acceptInvite: acceptInviteMock,
  expirePendingInvite: vi.fn(),
  ...serviceErrors,
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));

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
      role: 'RESPONSAVEL',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      contaId: 'conta-1',
    });
    prismaMock.usuario.findFirst.mockResolvedValue(null);
    prismaMock.usuarioConta.findUnique.mockResolvedValue(null);
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
          cpf: '529.982.247-25',
          telefone: '(11) 99999-9999',
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
      undefined,
      { cpf: '52998224725', telefone: '11999999999' },
    );
    expect(json.user.email).toBe('responsavel@example.com');
    expect(sendEmailVerificationForUserMock).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('informa que a conta já está vinculada à escola sem pedir login novamente', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue({
      id: 'user-1',
      status: 'ATIVO',
      contaId: 'outra-conta',
    });
    prismaMock.usuarioConta.findUnique.mockResolvedValue({ status: 'ATIVO' });

    const response = await POST(
      new Request('http://x/api/users/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'invite-token',
          name: 'Responsável Teste',
          password: 'Abcdef1!',
          email: 'responsavel@example.com',
          cpf: '529.982.247-25',
          telefone: '(11) 99999-9999',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
      code: 'USER_ALREADY_LINKED',
    });
    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });
});
