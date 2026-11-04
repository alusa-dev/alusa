import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateManyMock, credentialUpdateManyMock, mobileSessionUpdateManyMock, transactionMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn(),
  credentialUpdateManyMock: vi.fn(),
  mobileSessionUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: transactionMock,
    usuario: { updateMany: updateManyMock },
    authCredential: { updateMany: credentialUpdateManyMock },
    mobileAuthSession: { updateMany: mobileSessionUpdateManyMock },
  },
}));

const { revokeUserSessions } = await import('@/lib/auth-service');

describe('revokeUserSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      usuario: { updateMany: updateManyMock },
      authCredential: { updateMany: credentialUpdateManyMock },
      mobileAuthSession: { updateMany: mobileSessionUpdateManyMock },
    }));
    updateManyMock.mockResolvedValue({ count: 1 });
    credentialUpdateManyMock.mockResolvedValue({ count: 1 });
    mobileSessionUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it('incrementa a versão de forma atômica para o usuário informado', async () => {
    await expect(revokeUserSessions(' user_1 ')).resolves.toBe(1);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(credentialUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(mobileSessionUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: 'user_1', revokedAt: null },
      data: { revokedAt: expect.any(Date), lastUsedAt: expect.any(Date) },
    });
  });

  it('rejeita identificador vazio antes de consultar o banco', async () => {
    await expect(revokeUserSessions('   ')).rejects.toThrow('userId é obrigatório');
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
