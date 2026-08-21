import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateManyMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { usuario: { updateMany: updateManyMock } },
}));

const { revokeUserSessions } = await import('@/lib/auth-service');

describe('revokeUserSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('incrementa a versão de forma atômica para o usuário informado', async () => {
    updateManyMock.mockResolvedValueOnce({ count: 1 });

    await expect(revokeUserSessions(' user_1 ')).resolves.toBe(1);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it('rejeita identificador vazio antes de consultar o banco', async () => {
    await expect(revokeUserSessions('   ')).rejects.toThrow('userId é obrigatório');
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
