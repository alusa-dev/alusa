import { beforeEach, describe, expect, it, vi } from 'vitest';

const { usuarioFindFirstMock, authCredentialFindFirstMock } = vi.hoisted(() => ({
  usuarioFindFirstMock: vi.fn(),
  authCredentialFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    usuario: {
      findFirst: usuarioFindFirstMock,
    },
    authCredential: {
      findFirst: authCredentialFindFirstMock,
    },
  },
}));

describe('checkFirstUserRegistrationAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuarioFindFirstMock.mockResolvedValue(null);
    authCredentialFindFirstMock.mockResolvedValue(null);
  });

  it('permite e-mail que ainda não existe no cadastro local', async () => {
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({ email: 'new@example.com' }),
    ).resolves.toEqual({ available: true });

    expect(usuarioFindFirstMock).toHaveBeenCalledWith({
      where: { email: { equals: 'new@example.com', mode: 'insensitive' } },
      select: { id: true, email: true, status: true, conta: { select: { status: true, deletedAt: true } } },
    });
  });

  it('bloqueia e-mail ligado a uma conta local ativa', async () => {
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'user_1',
      email: 'used@example.com',
      status: 'ATIVO',
      conta: { status: 'ATIVO', deletedAt: null },
    });
    authCredentialFindFirstMock.mockResolvedValueOnce({ id: 'owner-credential' });
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({ email: 'used@example.com' }),
    ).resolves.toEqual({ available: false, reason: 'LOCAL_ACTIVE' });
  });

  it('orienta reativação para e-mail ligado a uma conta desativada', async () => {
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'user_2',
      email: 'inactive@example.com',
      status: 'ATIVO',
      conta: { status: 'INATIVO', deletedAt: null },
    });
    authCredentialFindFirstMock.mockResolvedValueOnce({ id: 'owner-credential' });
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({ email: 'inactive@example.com' }),
    ).resolves.toEqual({
      available: false,
      reason: 'LOCAL_DEACTIVATED',
      userId: 'user_2',
      email: 'inactive@example.com',
    });
  });

  it('allows an e-mail used only by a collaborator credential to register a new owner context', async () => {
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'collaborator-user',
      email: 'staff@example.com',
      status: 'ATIVO',
      conta: { status: 'ATIVO', deletedAt: null },
    });
    authCredentialFindFirstMock.mockResolvedValueOnce(null);
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(checkFirstUserRegistrationAvailability({ email: 'staff@example.com' }))
      .resolves.toEqual({ available: true });
    expect(authCredentialFindFirstMock).toHaveBeenCalledWith({
      where: { context: 'OWNER', userId: 'collaborator-user' },
      select: { id: true },
    });
  });
});
