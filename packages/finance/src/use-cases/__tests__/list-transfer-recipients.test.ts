import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listTransferRecipients } from '../list-transfer-recipients';

vi.mock('@alusa/database', () => ({
  prisma: {
    transferRequest: {
      findMany: vi.fn(),
    },
  },
}));

describe('listTransferRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prioriza os dados oficiais persistidos do titular Pix nos destinatarios recentes', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr_1',
        createdAt: new Date('2026-03-24T10:00:00.000Z'),
        destination: {
          type: 'PIX',
          pixAddressKey: 'financeiro@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: true,
          recipientName: 'Fornecedor ABC',
          recipientDocumentMasked: '***.123.456-**',
          recipientBank: 'Banco do Brasil',
        },
        pixTransferSession: null,
      },
    ] as never);

    const result = await listTransferRecipients({ contaId: 'c1', limit: 8 });

    expect(result.items).toEqual([
      {
        id: 'PIX:EMAIL:financeiro@teste.com',
        type: 'PIX',
        label: 'Fornecedor ABC',
        detail: '***.123.456-** • Banco do Brasil • fi•••@teste.com',
        lastUsedAt: '2026-03-24T10:00:00.000Z',
        destination: {
          type: 'PIX',
          pixAddressKey: 'financeiro@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: true,
          recipientName: 'Fornecedor ABC',
          recipientDocumentMasked: '***.123.456-**',
          recipientBank: 'Banco do Brasil',
        },
      },
    ]);
  });

  it('ignora destinatario Pix quando a transferencia nao foi marcada para salvar', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr_2',
        createdAt: new Date('2026-03-24T10:00:00.000Z'),
        destination: {
          type: 'PIX',
          pixAddressKey: 'nao.salvar@teste.com',
          pixAddressKeyType: 'EMAIL',
          saveRecipient: false,
        },
        pixTransferSession: {
          recipientName: 'Nao deve aparecer',
          recipientDocumentMasked: '***.000.000-**',
          recipientBank: 'Banco Teste',
          recipientPixKeyMasked: 'na•••@teste.com',
        },
      },
    ] as never);

    const result = await listTransferRecipients({ contaId: 'c1', limit: 8 });

    expect(result.items).toEqual([]);
  });
});