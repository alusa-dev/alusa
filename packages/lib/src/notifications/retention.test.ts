import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  notificationRecipient: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};

vi.mock('../prisma', () => ({
  prisma: prismaMock,
}));

const { archiveLowValueNotifications } = await import('./retention');

describe('notification retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notificationRecipient.findMany.mockResolvedValue([]);
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 0 });
  });

  it('arquiva eventos antigos de baixo valor em lote e preserva o escopo do tenant', async () => {
    prismaMock.notificationRecipient.findMany.mockResolvedValue([{ id: 'recipient-1' }]);
    prismaMock.notificationRecipient.updateMany.mockResolvedValue({ count: 1 });

    const result = await archiveLowValueNotifications({
      contaId: 'conta-1',
      olderThanDays: 30,
      limit: 100,
    });

    expect(result.archived).toBe(1);
    expect(prismaMock.notificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          archivedAt: null,
          notification: expect.objectContaining({
            type: expect.objectContaining({ in: expect.arrayContaining(['ENROLLMENT_CREATED']) }),
          }),
        }),
        take: 100,
      }),
    );
    expect(prismaMock.notificationRecipient.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['recipient-1'] }, contaId: 'conta-1' },
      data: {
        archivedAt: expect.any(Date),
        readAt: expect.any(Date),
      },
    });
  });

  it('não escreve quando não existem candidatos', async () => {
    const result = await archiveLowValueNotifications({ contaId: 'conta-1' });

    expect(result.archived).toBe(0);
    expect(prismaMock.notificationRecipient.updateMany).not.toHaveBeenCalled();
  });
});
