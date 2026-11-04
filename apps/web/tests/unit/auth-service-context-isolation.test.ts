import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, credentialRows, membershipRows, ownerAccounts } = vi.hoisted(() => {
  const credentialRows: Array<{ context: string; normalizedEmail: string; passwordHash: string; emailVerifiedAt: Date; sessionVersion: number; user: { id: string; email: string; nome: string; foto: null; telefone: null; birthDate: null; status: string } }> = [];
  const membershipRows: Array<{ contaId: string; role: string; conta: { nome: string } }> = [];
  const ownerAccounts: Array<{ id: string; nome: string; ownerUserId: string }> = [];
  const prismaMock = {
    authCredential: {
      findFirst: vi.fn(async (args: { where: { context: string; normalizedEmail: string } }) =>
        credentialRows.find((row) => row.context === args.where.context && row.normalizedEmail === args.where.normalizedEmail) ?? null),
      findUnique: vi.fn(async (args: { where: { uq_auth_credential_context_user?: { context: string; userId: string } } }) => {
        const key = args.where.uq_auth_credential_context_user;
        return key ? credentialRows.find((row) => row.context === key.context && row.user.id === key.userId) ?? null : null;
      }),
    },
    usuarioConta: {
      findFirst: vi.fn(async (args: { where: { contaId?: string } }) => {
        const row = membershipRows.find((item) => !args.where.contaId || item.contaId === args.where.contaId);
        return row ? { ...row, conta: { status: 'ATIVO', deletedAt: null }, usuario: { nome: 'Invitee' } } : null;
      }),
      findMany: vi.fn(async (args: { where: { contaId?: string } }) => membershipRows
        .filter((item) => !args.where.contaId || item.contaId === args.where.contaId)),
    },
    conta: {
      findUnique: vi.fn(async () => ({
        financeStatus: 'FINANCE_NOT_STARTED', financeIntegrationMode: 'WHITELABEL_BAAS',
        externalAsaasOnboardingStatus: 'NOT_STARTED', financeProfile: null,
      })),
      findMany: vi.fn(async (args: { where: { id?: string; ownerUserId?: string } }) => ownerAccounts
        .filter((item) => (!args.where.id || item.id === args.where.id) && (!args.where.ownerUserId || item.ownerUserId === args.where.ownerUserId))),
    },
  };
  return { prismaMock, credentialRows, membershipRows, ownerAccounts };
});

vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async (value: string, hash: string) => value === hash) } }));

import { verifyCredentialsDetailed } from '@/lib/auth-service';
import { authOptions } from '@/lib/auth-options';

describe('auth credentials are isolated by context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialRows.splice(0);
    membershipRows.splice(0);
    ownerAccounts.splice(0);
    process.env.NODE_ENV = 'production';
    credentialRows.push({
      context: 'COLLABORATOR', normalizedEmail: 'invitee@example.com', passwordHash: 'correct-password',
      emailVerifiedAt: new Date('2026-01-01T00:00:00Z'), sessionVersion: 1,
      user: { id: 'user-1', email: 'invitee@example.com', nome: 'Invitee', foto: null, telefone: null, birthDate: null, status: 'ATIVO' },
    });
    membershipRows.push({ contaId: 'school-collab-1', role: 'PROFESSOR', conta: { nome: 'School one' } });
    ownerAccounts.push({ id: 'school-owner-1', nome: 'Owner school', ownerUserId: 'owner-user-1' });
  });

  it.each(['OWNER', 'PORTAL'] as const)('rejects collaborator credentials in the %s context', async (authContext) => {
    await expect(verifyCredentialsDetailed(' Invitee@Example.com ', 'correct-password', authContext))
      .resolves.toEqual({ ok: false, reason: 'USER_NOT_FOUND' });
    expect(prismaMock.authCredential.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { context: authContext, normalizedEmail: 'invitee@example.com' },
    }));
  });

  it('returns only the memberships for the selected context and exposes multiple schools for the chooser', async () => {
    membershipRows.push({ contaId: 'school-collab-2', role: 'FINANCEIRO', conta: { nome: 'School two' } });

    const result = await verifyCredentialsDetailed('invitee@example.com', 'correct-password', 'COLLABORATOR');

    expect(result).toMatchObject({ ok: true, user: {
      authContext: 'COLLABORATOR', contaId: undefined,
      availableAccounts: [
        { id: 'school-collab-1', name: 'School one', role: 'PROFESSOR' },
        { id: 'school-collab-2', name: 'School two', role: 'FINANCEIRO' },
      ],
    } });
    expect(prismaMock.conta.findMany).not.toHaveBeenCalled();
  });

  it('keeps a new owner identity and its school separate from an existing invite identity with the same email', async () => {
    credentialRows.push({
      context: 'OWNER', normalizedEmail: 'invitee@example.com', passwordHash: 'owner-password',
      emailVerifiedAt: new Date('2026-02-01T00:00:00Z'), sessionVersion: 1,
      user: { id: 'owner-user-1', email: 'invitee@example.com', nome: 'New owner', foto: null, telefone: null, birthDate: null, status: 'ATIVO' },
    });
    const ownerLogin = await verifyCredentialsDetailed('INVITEE@example.com', 'owner-password', 'OWNER');
    const collaboratorLogin = await verifyCredentialsDetailed('invitee@example.com', 'correct-password', 'COLLABORATOR');

    expect(ownerLogin).toMatchObject({ ok: true, user: { id: 'owner-user-1', authContext: 'OWNER', availableAccounts: [{ id: 'school-owner-1', name: 'Owner school' }] } });
    expect(collaboratorLogin).toMatchObject({ ok: true, user: { id: 'user-1', authContext: 'COLLABORATOR', availableAccounts: [{ id: 'school-collab-1', name: 'School one' }] } });
    expect(credentialRows.map(({ context, user }) => [context, user.id])).toEqual([
      ['COLLABORATOR', 'user-1'], ['OWNER', 'owner-user-1'],
    ]);
  });

  it('completes the credentials login callback using the generated compound credential selector', async () => {
    credentialRows.push({
      context: 'OWNER', normalizedEmail: 'invitee@example.com', passwordHash: 'owner-password',
      emailVerifiedAt: new Date('2026-02-01T00:00:00Z'), sessionVersion: 1,
      user: { id: 'owner-user-1', email: 'invitee@example.com', nome: 'New owner', foto: null, telefone: null, birthDate: null, status: 'ATIVO' },
    });
    ownerAccounts.push({ id: 'school-owner-1', nome: 'Owner school', ownerUserId: 'owner-user-1' });
    const credentialsProvider = authOptions.providers[0] as { options?: { authorize?: (credentials: unknown) => Promise<unknown> }; authorize?: (credentials: unknown) => Promise<unknown> };
    const authorize = credentialsProvider.options?.authorize ?? credentialsProvider.authorize;
    expect(authorize).toBeTypeOf('function');

    const user = await authorize!({ email: 'invitee@example.com', password: 'owner-password', authContext: 'OWNER', contaId: 'school-owner-1' });
    expect(user).toMatchObject({ id: 'owner-user-1', authContext: 'OWNER', contaId: 'school-owner-1' });
    const token = await authOptions.callbacks!.jwt!({ token: {}, user } as never);

    expect(token).toMatchObject({ id: 'owner-user-1', contaId: 'school-owner-1', authContext: 'OWNER', accountActive: true });
    expect(prismaMock.authCredential.findUnique).toHaveBeenCalledWith({
      where: { uq_auth_credential_context_user: { context: 'OWNER', userId: 'owner-user-1' } },
      select: { user: { select: { id: true, status: true } }, emailVerifiedAt: true, sessionVersion: true },
    });
  });

  it('does not fall back to owner accounts when the selected collaborator identity has no membership', async () => {
    membershipRows.splice(0);

    await expect(verifyCredentialsDetailed('invitee@example.com', 'correct-password', 'COLLABORATOR'))
      .resolves.toEqual({ ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    expect(prismaMock.conta.findMany).not.toHaveBeenCalled();
  });
});
