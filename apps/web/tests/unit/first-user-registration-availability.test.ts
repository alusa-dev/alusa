import { beforeEach, describe, expect, it, vi } from 'vitest';

const usuarioFindFirstMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({
  default: {
    usuario: {
      findFirst: usuarioFindFirstMock,
    },
  },
}));

describe('checkFirstUserRegistrationAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuarioFindFirstMock.mockResolvedValue(null);
  });

  it('permite e-mail que ainda não existe no cadastro local', async () => {
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({ email: 'new@example.com' }),
    ).resolves.toEqual({ available: true });

    expect(usuarioFindFirstMock).toHaveBeenCalledWith({
      where: { email: { equals: 'new@example.com', mode: 'insensitive' } },
      select: { id: true, email: true, conta: { select: { status: true, deletedAt: true } } },
    });
  });

  it('bloqueia e-mail ligado a uma conta local ativa', async () => {
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'user_1',
      email: 'used@example.com',
      conta: { status: 'ATIVO', deletedAt: null },
    });
    const { checkFirstUserRegistrationAvailability } = await import('@/lib/first-user-service');

    await expect(
      checkFirstUserRegistrationAvailability({ email: 'used@example.com' }),
    ).resolves.toEqual({ available: false, reason: 'LOCAL_ACTIVE' });
  });

  it('orienta reativação para e-mail ligado a uma conta desativada', async () => {
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'user_2',
      email: 'inactive@example.com',
      conta: { status: 'INATIVO', deletedAt: null },
    });
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
});
