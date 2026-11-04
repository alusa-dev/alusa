import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSession } from 'next-auth';

const { acceptInviteMock, prepareInviteIdentityMock, hashPasswordMock, comparePasswordMock, inviteLookups, prismaMock, serviceErrors } = vi.hoisted(() => {
  const invite = {
    id: 'invite-1', token: 'invite-token', email: 'target@example.com', role: 'RECEPCAO',
    status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), contaId: 'conta-1', invitedById: 'admin-1',
  };
  return {
    acceptInviteMock: vi.fn(),
    prepareInviteIdentityMock: vi.fn(),
    hashPasswordMock: vi.fn(),
    comparePasswordMock: vi.fn(),
    inviteLookups: { current: invite },
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
    prismaMock: {
      authCredential: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
      usuario: { findFirst: vi.fn() },
      usuarioConta: { findUnique: vi.fn(), findFirst: vi.fn() },
    },
  };
});

vi.mock('@alusa/lib/server/services/invite-user-service', () => ({
  acceptInvite: acceptInviteMock,
  prepareInviteIdentity: prepareInviteIdentityMock,
  expirePendingInvite: vi.fn(),
  ...serviceErrors,
}));

vi.mock('@/src/server/users/invite-acceptance.service', () => ({
  findInviteForAcceptance: vi.fn(async () => inviteLookups.current),
  findPendingInviteForAcceptance: vi.fn(async () => inviteLookups.current),
  findExistingUserForInvite: vi.fn(async () => null),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: vi.fn(() => '127.0.0.1'), rateLimit: vi.fn(() => ({ ok: true })) }));
vi.mock('@/lib/auth-password', () => ({ hashPassword: hashPasswordMock, comparePassword: comparePasswordMock, passwordPolicyMessage: 'Senha inválida' }));
vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));

import { POST } from '@/app/api/users/accept/route';

function request(body: Record<string, unknown>) {
  return new Request('http://x/api/users/accept', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('/api/users/accept auth context isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteLookups.current = {
      id: 'invite-1', token: 'invite-token', email: 'target@example.com', role: 'RECEPCAO',
      status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), contaId: 'conta-1', invitedById: 'admin-1',
    };
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    hashPasswordMock.mockResolvedValue('hashed-password');
    comparePasswordMock.mockResolvedValue(true);
    prismaMock.authCredential.findUnique.mockResolvedValue(null);
    prismaMock.authCredential.upsert.mockResolvedValue({} as never);
    prismaMock.usuario.findFirst.mockResolvedValue(null);
    acceptInviteMock.mockResolvedValue({ id: 'user-1', email: 'target@example.com', role: 'RECEPCAO', contaId: 'conta-1', emailVerifiedAt: new Date() });
    prepareInviteIdentityMock.mockResolvedValue({ id: 'user-1', email: 'target@example.com', role: 'RECEPCAO', contaId: null, emailVerifiedAt: null });
  });

  it('creates a verified COLLABORATOR credential and accepts the invite using its bound token', async () => {
    const response = await POST(request({ token: 'invite-token', name: 'Pessoa', password: 'Abcdef1!', email: 'target@example.com' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.authCredential.findUnique).toHaveBeenCalledWith({
      where: { uq_auth_credential_context_email: { context: 'COLLABORATOR', normalizedEmail: 'target@example.com' } },
      select: { passwordHash: true, user: { select: { id: true, email: true, status: true } }, emailVerifiedAt: true },
    });
    expect(prismaMock.authCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_auth_credential_context_user: { context: 'COLLABORATOR', userId: 'user-1' } },
      create: expect.objectContaining({ context: 'COLLABORATOR', emailVerifiedAt: expect.any(Date) }),
    }));
    expect(body).toMatchObject({ verificationRequired: false, user: { email: 'target@example.com', contaId: 'conta-1', emailVerified: true } });
    expect(acceptInviteMock).toHaveBeenCalledWith('invite-token', 'target@example.com', 'user-1');
  });

  it('rejects OWNER sessions for a collaborator invite without changing either context credential', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1', email: 'target@example.com', authContext: 'OWNER' } } as never);
    prismaMock.authCredential.findUnique.mockResolvedValue({
      userId: 'user-1', emailVerifiedAt: new Date(), user: { id: 'user-1', email: 'target@example.com', status: 'ATIVO' },
    } as never);

    const response = await POST(request({ token: 'invite-token', email: 'target@example.com' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('AUTH_CONTEXT_REQUIRED');
    expect(prismaMock.authCredential.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_auth_credential_context_email: { context: 'COLLABORATOR', normalizedEmail: 'target@example.com' } },
    }));
    expect(prismaMock.authCredential.upsert).not.toHaveBeenCalled();
    expect(acceptInviteMock).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'RECEPCAO', context: 'COLLABORATOR' },
    { role: 'RESPONSAVEL', context: 'PORTAL' },
  ] as const)('accepts a $role invite only in its mapped $context session', async ({ role, context }) => {
    inviteLookups.current = { ...inviteLookups.current, role };
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1', email: 'target@example.com', authContext: context } } as never);
    prismaMock.authCredential.findUnique.mockResolvedValue({
      userId: 'user-1', emailVerifiedAt: new Date(), user: { id: 'user-1', email: 'target@example.com', status: 'ATIVO' },
    } as never);

    const response = await POST(request({ token: 'invite-token', email: 'target@example.com' }));

    expect(response.status).toBe(200);
    expect(prismaMock.authCredential.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_auth_credential_context_email: { context, normalizedEmail: 'target@example.com' } },
    }));
    expect(acceptInviteMock).toHaveBeenCalledWith('invite-token', 'target@example.com', 'user-1');
    expect(prismaMock.authCredential.upsert).not.toHaveBeenCalled();
  });
});
