import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existingIdentity, credentialRows, membershipRows, prismaMock, createdCredentials, createdMemberships, createdAccounts, hashPasswordMock } = vi.hoisted(() => {
  const existingIdentity = {
    id: 'invite-user-1', email: 'shared@example.com', status: 'ATIVO',
    conta: { status: 'ATIVO', deletedAt: null },
  };
  const credentialRows = [{
    context: 'COLLABORATOR', normalizedEmail: 'shared@example.com', userId: 'invite-user-1', passwordHash: 'collaborator-hash',
  }];
  const membershipRows = [{ userId: 'invite-user-1', contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' }];
  const createdCredentials: Array<Record<string, unknown>> = [];
  const createdMemberships: Array<Record<string, unknown>> = [];
  const createdAccounts: Array<Record<string, unknown>> = [];
  const hashPasswordMock = vi.fn();
  const prismaMock = {
    usuario: { findFirst: vi.fn(async () => existingIdentity) },
    authCredential: { findFirst: vi.fn(async (args: { where: { context: string; userId: string } }) =>
      credentialRows.find((row) => row.context === args.where.context && row.userId === args.where.userId) ?? null) },
    platformSchoolInvitation: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      conta: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          createdAccounts.push(args.data);
          return { id: 'school-b' };
        }),
        update: vi.fn(),
      },
      usuario: { findUniqueOrThrow: vi.fn(async () => ({ id: 'invite-user-1', email: 'shared@example.com', role: 'RESPONSAVEL' })) },
      usuarioConta: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { createdMemberships.push(args.data); }) },
      authCredential: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { createdCredentials.push(args.data); }) },
    })),
  };
  return { existingIdentity, credentialRows, membershipRows, prismaMock, createdCredentials, createdMemberships, createdAccounts, hashPasswordMock };
});

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));
vi.mock('@/lib/auth-password', () => ({
  hashPassword: hashPasswordMock,
  passwordPolicyMessage: 'Senha inválida',
  passwordPolicyRegex: /^.{8,}$/,
}));

import { createFirstUser } from '@/lib/first-user-service';

describe('owner registration with an existing invite identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialRows.splice(0, credentialRows.length, {
      context: 'COLLABORATOR', normalizedEmail: 'shared@example.com', userId: 'invite-user-1', passwordHash: 'collaborator-hash',
    });
    membershipRows.splice(0, membershipRows.length, { userId: 'invite-user-1', contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' });
    createdCredentials.splice(0);
    createdMemberships.splice(0);
    createdAccounts.splice(0);
    hashPasswordMock.mockResolvedValue('owner-hash');
  });

  it('creates a separate OWNER credential and school without changing the existing collaborator identity or membership', async () => {
    await createFirstUser({
      escolaNome: 'School B', nome: 'New owner', email: ' Shared@Example.com ', senha: 'SenhaFort3!',
    });

    expect(prismaMock.authCredential.findFirst).toHaveBeenCalledWith({
      where: { context: 'OWNER', userId: 'invite-user-1' }, select: { id: true },
    });
    expect(createdAccounts).toHaveLength(1);
    expect(createdMemberships).toEqual([expect.objectContaining({ usuarioId: 'invite-user-1', contaId: 'school-b', role: 'ADMIN', status: 'ATIVO' })]);
    expect(createdCredentials).toEqual([expect.objectContaining({
      context: 'OWNER', normalizedEmail: 'shared@example.com', userId: 'invite-user-1', passwordHash: 'owner-hash',
    })]);
    expect(credentialRows).toEqual([{
      context: 'COLLABORATOR', normalizedEmail: 'shared@example.com', userId: 'invite-user-1', passwordHash: 'collaborator-hash',
    }]);
    expect(membershipRows).toEqual([{ userId: 'invite-user-1', contaId: 'school-a', role: 'PROFESSOR', status: 'ATIVO' }]);
  });
});
