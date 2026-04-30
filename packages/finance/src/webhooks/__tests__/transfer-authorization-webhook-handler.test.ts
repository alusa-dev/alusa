import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTransferAuthorizationWebhook } from '../transfer-authorization-webhook-handler';

vi.mock('@alusa/database', () => ({
  prisma: {
    webhookAsaas: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    pixTransferSession: {
      findFirst: vi.fn(),
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

  it('preenche a sessao de preview e responde REFUSED para consulta controlada', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.webhookAsaas.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pixTransferSession.findFirst).mockResolvedValueOnce({
      id: 'sess_1',
      status: 'WAITING_PREVIEW',
      expiresAt: new Date(Date.now() + 60000),
      pixKeyOriginal: 'financeiro@teste.com',
      pixKeyType: 'EMAIL',
    } as never);
    vi.mocked(prisma.pixTransferSession.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.webhookAsaas.upsert).mockResolvedValueOnce({} as never);

    const result = await handleTransferAuthorizationWebhook({
      contaId: 'c1',
      rawBody: JSON.stringify({ transfer: { id: 'asaas_prev_1' } }),
      payload: {
        type: 'TRANSFER',
        transfer: {
          id: 'asaas_prev_1',
          externalReference: 'pix-preview:sess_1',
          bankAccount: {
            ownerName: 'Fornecedor ABC',
            cpfCnpj: '12345678901',
            bank: { name: 'Banco do Brasil' },
            pixAddressKey: 'financeiro@teste.com',
          },
        },
      },
    });

    expect(result).toEqual({ status: 'REFUSED', refuseReason: 'Consulta concluida' });
    expect(prisma.pixTransferSession.update).toHaveBeenCalled();
  });

  it('aprova transferencias reais quando encontra TransferRequest', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.webhookAsaas.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr_1',
      externalReference: 'transfer:tr_1',
      asaasTransferId: null,
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.webhookAsaas.upsert).mockResolvedValueOnce({} as never);

    const result = await handleTransferAuthorizationWebhook({
      contaId: 'c1',
      rawBody: JSON.stringify({ transfer: { id: 'asaas_tr_1' } }),
      payload: {
        type: 'TRANSFER',
        transfer: {
          id: 'asaas_tr_1',
          externalReference: 'transfer:tr_1',
        },
      },
    });

    expect(result).toEqual({ status: 'APPROVED' });
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr_1' },
      data: { asaasTransferId: 'asaas_tr_1' },
    });
  });
});