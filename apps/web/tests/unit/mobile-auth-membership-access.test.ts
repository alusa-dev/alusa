import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, verifyCredentialsDetailedMock, resolveSessionAccessMock, jwtVerifyMock } = vi.hoisted(() => ({
  prismaMock: {
    usuarioConta: { findMany: vi.fn(), updateMany: vi.fn() },
    mobileAuthSession: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    conta: { findFirst: vi.fn() },
  },
  verifyCredentialsDetailedMock: vi.fn(),
  resolveSessionAccessMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setSubject() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'mobile-access-token'; }
  },
  jwtVerify: jwtVerifyMock,
}));
vi.mock('@/lib/prisma', () => ({ __esModule: true, default: prismaMock }));
vi.mock('@/lib/auth-service', () => ({
  verifyCredentialsDetailed: verifyCredentialsDetailedMock,
  resolveSessionAccess: resolveSessionAccessMock,
}));

import { loginMobile, refreshMobileSession, verifyMobileAccessToken } from '@/lib/mobile-auth-service';

const verifiedUser = {
  id: 'user-1', email: 'multi@example.test', nome: 'Multi Tenant',
  role: 'ADMIN', contaId: 'school-a', emailVerifiedAt: new Date(), sessionVersion: 1,
};
const schoolBMembership = {
  contaId: 'school-b', role: 'FINANCEIRO',
  conta: { id: 'school-b', nome: 'School B', status: 'ATIVO', deletedAt: null },
};

describe('mobile auth tenant membership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'mobile-auth-test-secret';
    verifyCredentialsDetailedMock.mockResolvedValue({ ok: true, user: verifiedUser });
    prismaMock.mobileAuthSession.create.mockResolvedValue({ id: 'mobile-session-1' });
    prismaMock.usuarioConta.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      mobileAuthSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'mobile-session-new' }),
      },
    }));
    prismaMock.mobileAuthSession.findUnique.mockResolvedValue({
      id: 'session-a', userId: verifiedUser.id, expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
      user: { ...verifiedUser, status: 'ATIVO' },
    });
    prismaMock.mobileAuthSession.update.mockResolvedValue({});
    jwtVerifyMock.mockImplementation(async (token: string) => ({ payload: {
      sub: verifiedUser.id, sid: token === 'token-a' ? 'session-a' : 'session-b', sv: 1,
      contaId: token === 'token-a' ? 'school-a' : 'school-b',
    } }));
  });

  it('denies mobile login without a tenant membership and does not fall back to Usuario defaults', async () => {
    prismaMock.usuarioConta.findMany.mockResolvedValue([]);

    await expect(loginMobile({
      email: verifiedUser.email,
      password: 'valid-password',
      contaId: 'school-a',
    })).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });

    expect(prismaMock.conta.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.mobileAuthSession.create).not.toHaveBeenCalled();
  });

  it('denies suspended school A while allowing active school B with its membership role', async () => {
    prismaMock.usuarioConta.findMany.mockResolvedValue([schoolBMembership]);

    await expect(loginMobile({
      email: verifiedUser.email,
      password: 'valid-password',
      contaId: 'school-a',
    })).rejects.toMatchObject({ code: 'ACCOUNT_UNAVAILABLE' });
    await expect(loginMobile({
      email: verifiedUser.email,
      password: 'valid-password',
      contaId: 'school-b',
    })).resolves.toMatchObject({
      activeContaId: 'school-b',
      user: { role: 'FINANCEIRO', contaId: 'school-b' },
    });
  });

  it('revokes already-issued mobile access and refresh for A while preserving B', async () => {
    prismaMock.usuarioConta.findMany.mockResolvedValue([schoolBMembership]);
    resolveSessionAccessMock.mockImplementation(async ({ contaId }: { contaId?: string }) =>
      contaId === 'school-b'
        ? { ok: true, contaId: 'school-b', role: 'FINANCEIRO', emailVerified: true }
        : { ok: false, reason: 'ACCOUNT_UNAVAILABLE' });
    prismaMock.mobileAuthSession.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => ({
      id: where.id ?? 'session-a', userId: verifiedUser.id, expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
      user: { ...verifiedUser, status: 'ATIVO' },
    }));

    await expect(verifyMobileAccessToken('token-a')).resolves.toBeNull();
    await expect(verifyMobileAccessToken('token-b')).resolves.toMatchObject({ contaId: 'school-b', role: 'FINANCEIRO' });
    await expect(refreshMobileSession({ refreshToken: 'a'.repeat(32), contaId: 'school-a' }))
      .rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(refreshMobileSession({ refreshToken: 'b'.repeat(32), contaId: 'school-b' }))
      .resolves.toMatchObject({ activeContaId: 'school-b', user: { role: 'FINANCEIRO' } });
  });
});
