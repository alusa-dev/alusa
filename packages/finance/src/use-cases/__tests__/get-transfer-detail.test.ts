import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTransferDetail } from '../get-transfer-detail';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      transferRequest: {
        findFirst: vi.fn(),
      },
      webhookAsaas: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getTransfer: vi.fn(),
}));

describe('getTransferDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve unir dados locais, webhook persistido e retorno oficial do Asaas', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr_1',
      externalReference: 'transfer:tr_1',
      asaasTransferId: 'asaas_tr_1',
      value: { toString: () => '100.00' },
      destination: {
        type: 'PIX',
        pixAddressKey: 'jose@pix.com',
        pixAddressKeyType: 'EMAIL',
      },
      description: null,
      scheduleDate: new Date('2026-04-10T00:00:00.000Z'),
      status: 'PENDING',
      statusUpdatedAt: new Date('2026-04-09T18:00:00.000Z'),
      createdAt: new Date('2026-04-09T17:30:00.000Z'),
      pixTransferSession: {
        recipientName: 'Jose Silva',
        recipientDocumentMasked: '***.944.444-**',
        recipientBank: 'Banco Virtual - BACEN',
        recipientPixKeyMasked: 'jo•••@pix.com',
      },
    } as never);

    vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValueOnce({
      payload: {
        transfer: {
          netValue: 98,
          transferFee: 2,
          operationType: 'PIX',
          bankAccount: {
            ownerName: 'Jose Silva',
            cpfCnpj: '12345678901',
            bank: { name: 'Banco Virtual - BACEN', code: '999' },
            pixAddressKey: 'jose@pix.com',
          },
        },
      },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-04-09',
      value: 100,
      netValue: 97,
      transferFee: 3,
      status: 'DONE',
      effectiveDate: '2026-04-10',
      scheduleDate: '2026-04-10',
      endToEndIdentifier: 'E2E123',
      transactionReceiptUrl: 'https://receipt.test/asaas_tr_1',
      operationType: 'PIX',
      type: 'PIX',
      authorized: true,
      externalReference: 'transfer:tr_1',
      description: 'Repasse mensalidade abril',
      bankAccount: {
        ownerName: 'Jose Silva Oficial',
        cpfCnpj: '98765432100',
        bank: { name: 'Banco Oficial', code: '001' },
        pixAddressKey: 'jose@pix.com',
      },
    } as never);

    const result = await getTransferDetail({ contaId: 'conta_1', transferId: 'tr_1' });

    expect(result).toMatchObject({
      id: 'tr_1',
      externalReference: 'transfer:tr_1',
      asaasTransferId: 'asaas_tr_1',
      amount: 100,
      feeAmount: 3,
      netAmount: 97,
      status: 'DONE',
      operation: 'PIX',
      description: 'Repasse mensalidade abril',
      scheduleDate: '2026-04-10',
      transferDate: '2026-04-10',
      transactionReceiptUrl: 'https://receipt.test/asaas_tr_1',
      endToEndIdentifier: 'E2E123',
      authorized: true,
      recipient: {
        name: 'Jose Silva Oficial',
        cpfCnpj: '***.654.321-**',
        bankName: 'Banco Oficial',
        pixKey: 'jo•••@pix.com',
      },
    });
  });

  it('deve falhar quando a transferência não pertence à conta', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(null as never);

    await expect(
      getTransferDetail({ contaId: 'conta_1', transferId: 'tr_inexistente' }),
    ).rejects.toThrow('TRANSFER_NAO_ENCONTRADA');
  });
});