import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSession } from 'next-auth';

const { acceptInviteMock, prepareInviteIdentityMock, sendEmailVerificationForUserMock, hashPasswordMock, comparePasswordMock, serviceErrors } = vi.hoisted(() => ({
  acceptInviteMock: vi.fn(),
  prepareInviteIdentityMock: vi.fn(),
  sendEmailVerificationForUserMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  comparePasswordMock: vi.fn(),
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
    InviteEmailNotVerifiedError: class extends Error {},
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
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@alusa/lib/server/services/invite-user-service', () => ({
  acceptInvite: acceptInviteMock,
  prepareInviteIdentity: prepareInviteIdentityMock,
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
  comparePassword: comparePasswordMock,
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
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    hashPasswordMock.mockResolvedValue('hashed-password');
    comparePasswordMock.mockResolvedValue(true);
    prismaMock.invite.findUnique.mockResolvedValue({
      email: null,
      role: 'RESPONSAVEL',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      contaId: 'conta-1',
      invitedById: 'admin-1',
    });
    prismaMock.usuario.findFirst.mockResolvedValue(null);
    prismaMock.usuarioConta.findUnique.mockResolvedValue(null);
    prismaMock.usuarioConta.findFirst.mockResolvedValue({ id: 'admin-membership-1' });
    acceptInviteMock.mockResolvedValue({
      id: 'user-1',
      email: 'responsavel@example.com',
      role: 'RESPONSAVEL',
      contaId: 'conta-1',
      emailVerifiedAt: new Date(),
    });
    prepareInviteIdentityMock.mockResolvedValue({ id: 'user-1', email: 'responsavel@example.com', role: 'RESPONSAVEL', contaId: null, emailVerifiedAt: null });
  });

  it('cria apenas identidade global não verificada para RESPONSAVEL e preserva token no callback', async () => {
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

    expect(response.status).toBe(202);
    expect(prepareInviteIdentityMock).toHaveBeenCalledWith(
      'invite-token',
      'Responsável Teste',
      'hashed-password',
      'responsavel@example.com',
    );
    expect(acceptInviteMock).not.toHaveBeenCalled();
    expect(json).toMatchObject({ verificationRequired: true, verificationEmailSent: true, user: { email: 'responsavel@example.com', contaId: null, emailVerified: false } });
    expect(sendEmailVerificationForUserMock).toHaveBeenCalledWith(
      'user-1',
      expect.any(Object),
      { callbackUrl: '/auth/login?callbackUrl=%2Fauth%2Fregister%3Ftoken%3Dinvite-token' },
    );
  });

  it('exige senha e e-mail verificado antes de concluir; reusa identidade confirmada', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'responsavel@example.com',
      status: 'ATIVO',
      emailVerifiedAt: new Date(),
      senhaHash: 'password-hash',
    });

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
    expect(comparePasswordMock).toHaveBeenCalledWith('Abcdef1!', 'password-hash');
    expect(acceptInviteMock).toHaveBeenCalledWith('invite-token', 'responsavel@example.com', 'user-1');
    expect(json.user.email).toBe('responsavel@example.com');
  });

  it('rejeita troca de sessão ou e-mail contra convite vinculado antes de criar identidade', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({
      email: 'target@example.com', role: 'RECEPCAO', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), contaId: 'conta-1', invitedById: 'admin-1',
    });
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'foreign-user', email: 'foreign@example.com' } } as never);

    const response = await POST(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', email: 'target@example.com', password: 'Aa!23456', name: 'Pessoa' }),
    }));

    expect(response.status).toBe(403);
    expect(prepareInviteIdentityMock).not.toHaveBeenCalled();
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });

  it('não aceita identidade verificada com senha incorreta', async () => {
    prismaMock.usuario.findFirst.mockResolvedValue({
      id: 'user-1', email: 'responsavel@example.com', status: 'ATIVO', emailVerifiedAt: new Date(), senhaHash: 'password-hash',
    });
    comparePasswordMock.mockResolvedValue(false);

    const response = await POST(new Request('http://x/api/users/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invite-token', email: 'responsavel@example.com', password: 'Wrong123!' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });
});
