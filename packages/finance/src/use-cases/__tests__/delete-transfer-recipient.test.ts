import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteTransferRecipient } from '../delete-transfer-recipient';

vi.mock('@alusa/database', () => ({
  prisma: {
    transferRequest: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  },
}));

describe('deleteTransferRecipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('remove a chave Pix salva sem apagar o historico', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr_1',
        destination: {
          type: 'PIX',
          pixAddressKey: 'pix@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: true,
          recipientName: 'Jose Silva Silva',
        },
      },
      {
        id: 'tr_2',
        destination: {
          type: 'PIX',
          pixAddressKey: 'outra@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: true,
          recipientName: 'Outro',
        },
      },
    ] as never);
    vi.mocked(prisma.transferRequest.update).mockImplementation(async (args) => ({ id: args.where.id }) as never);

    const result = await deleteTransferRecipient({
      contaId: 'c1',
      recipientId: 'PIX:EMAIL:pix@teste.com',
    });

    expect(result).toEqual({ removedCount: 1 });
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr_1' },
      data: {
        destination: {
          type: 'PIX',
          pixAddressKey: 'pix@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: false,
          recipientName: 'Jose Silva Silva',
        },
      },
      select: { id: true },
    });
  });

  it('retorna zero quando nao encontra a chave Pix informada', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr_1',
        destination: {
          type: 'PIX',
          pixAddressKey: 'pix@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: false,
        },
      },
    ] as never);

    const result = await deleteTransferRecipient({
      contaId: 'c1',
      recipientId: 'PIX:EMAIL:ausente@teste.com',
    });

    expect(result).toEqual({ removedCount: 0 });
    expect(prisma.transferRequest.update).not.toHaveBeenCalled();
  });
});