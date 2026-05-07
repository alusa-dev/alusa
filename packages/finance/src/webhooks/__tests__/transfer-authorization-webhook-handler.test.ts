import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTransferAuthorizationWebhook } from '../transfer-authorization-webhook-handler';

vi.mock('@alusa/database', () => ({
  prisma: {
    webhookAsaas: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    transferRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => {}),
  },
}));

describe('handleTransferAuthorizationWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aprova transferencias reais quando encontra TransferRequest', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.webhookAsaas.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr_1',
      value: 150,
      destination: { type: 'PIX', pixAddressKey: 'financeiro@teste.com', pixAddressKeyType: 'EMAIL' },
      description: 'Pagamento fornecedor',
      scheduleDate: new Date('2026-05-06T00:00:00.000Z'),
      externalReference: 'transfer:tr_1',
      asaasTransferId: null,
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.webhookAsaas.create).mockResolvedValueOnce({} as never);

    const result = await handleTransferAuthorizationWebhook({
      contaId: 'c1',
      rawBody: JSON.stringify({ transfer: { id: 'asaas_tr_1', externalReference: 'transfer:tr_1' } }),
      payload: {
        type: 'TRANSFER',
        transfer: {
          id: 'asaas_tr_1',
          value: 150,
          scheduleDate: '2026-05-06',
          operationType: 'PIX',
          externalReference: 'transfer:tr_1',
          description: 'Pagamento fornecedor',
          bankAccount: {
            pixAddressKey: 'financeiro@teste.com',
          },
        },
      },
    });

    expect(result).toEqual({ status: 'APPROVED' });
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr_1' },
      data: { asaasTransferId: 'asaas_tr_1' },
    });
  });

  it('recusa transferencia quando payload oficial diverge do snapshot local', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.webhookAsaas.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr_2',
      value: 150,
      destination: { type: 'PIX', pixAddressKey: 'financeiro@teste.com', pixAddressKeyType: 'EMAIL' },
      description: 'Pagamento fornecedor',
      scheduleDate: new Date('2026-05-06T00:00:00.000Z'),
      externalReference: 'transfer:tr_2',
      asaasTransferId: null,
    } as never);
    vi.mocked(prisma.webhookAsaas.create).mockResolvedValueOnce({} as never);

    const result = await handleTransferAuthorizationWebhook({
      contaId: 'c1',
      rawBody: JSON.stringify({ transfer: { id: 'asaas_tr_2', externalReference: 'transfer:tr_2' } }),
      payload: {
        type: 'TRANSFER',
        transfer: {
          id: 'asaas_tr_2',
          value: 150,
          scheduleDate: '2026-05-06',
          operationType: 'PIX',
          externalReference: 'transfer:tr_2',
          description: 'Pagamento fornecedor',
          bankAccount: {
            pixAddressKey: 'outra-chave@teste.com',
          },
        },
      },
    });

    expect(result).toEqual({ status: 'REFUSED', refuseReason: 'Chave Pix divergente' });
    expect(prisma.transferRequest.update).not.toHaveBeenCalled();
  });
});