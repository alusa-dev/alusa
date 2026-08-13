import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateManyMock = vi.fn();
const findUniqueMock = vi.fn();
const transactionMock = vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) =>
  callback({
    authActionToken: {
      updateMany: updateManyMock,
      findUnique: findUniqueMock,
    },
  }),
);

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: transactionMock,
  },
}));

describe('consumeAuthActionToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reivindica o token atomicamente e impede um segundo consumo', async () => {
    const user = {
      id: 'user_1',
      contaId: 'conta_1',
      email: 'user@example.com',
      nome: 'User',
      emailVerifiedAt: null,
    };
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    findUniqueMock.mockResolvedValueOnce({
      id: 'token_1',
      type: 'RESET_PASSWORD',
      invalidatedAt: null,
      user,
    });

    const { consumeAuthActionToken } = await import('@/lib/auth-action-tokens');
    const first = await consumeAuthActionToken('RESET_PASSWORD', 'plain-token');
    const second = await consumeAuthActionToken('RESET_PASSWORD', 'plain-token');

    expect(first).toEqual({ tokenId: 'token_1', user });
    expect(second).toBeNull();
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'RESET_PASSWORD',
          usedAt: null,
          invalidatedAt: null,
        }),
        data: { usedAt: expect.any(Date) },
      }),
    );
  });
});
