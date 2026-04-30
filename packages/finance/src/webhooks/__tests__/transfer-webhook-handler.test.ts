import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTransferWebhook } from '../transfer-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      transferRequest: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      pixTransferSession: {
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getTransfer: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('@alusa/lib', () => ({
  createNotification: vi.fn(async () => {}),
}));

describe('handleTransferWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar sucesso quando não encontra TransferRequest', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(null as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_PENDING',
      transfer: { id: 'asaas_tr_1', status: 'PENDING', externalReference: 'transfer:tr1' },
    });

    expect(res).toEqual({ success: true });
  });

  it('deve atualizar status e setar asaasTransferId quando necessário', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PENDING',
      asaasTransferId: null,
      externalReference: 'transfer:tr1',
      destination: {
        type: 'PIX',
        pixAddressKey: 'financeiro@teste.com',
        pixAddressKeyType: 'EMAIL',
      },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 10,
      netValue: 10,
      status: 'DONE',
      externalReference: 'transfer:tr1',
      operationType: 'PIX',
      type: 'BANK_ACCOUNT',
      bankAccount: {
        ownerName: 'Fornecedor ABC',
        cpfCnpj: '12345678901',
        pixAddressKey: 'financeiro@teste.com',
        bank: { name: 'Banco do Brasil' },
      },
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pixTransferSession.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_PENDING',
      transfer: { id: 'asaas_tr_1', status: 'PENDING', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);

    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        asaasTransferId: 'asaas_tr_1',
        status: 'DONE',
        statusUpdatedAt: expect.any(Date),
        destination: expect.objectContaining({
          recipientName: 'Fornecedor ABC',
          recipientDocumentMasked: '***.456.789-**',
          recipientBank: 'Banco do Brasil',
          recipientPixKeyMasked: 'fi•••@teste.com',
        }),
      }),
    });

    expect(prisma.pixTransferSession.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 't1',
        confirmTransferRequestId: 'tr1',
      },
      data: expect.objectContaining({
        status: 'DONE',
        recipientName: 'Fornecedor ABC',
        recipientDocumentMasked: '***.456.789-**',
        recipientBank: 'Banco do Brasil',
        recipientPixKeyMasked: 'fi•••@teste.com',
      }),
    });

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 't1',
        action: 'finance.webhook.transfer_status_changed',
        entity: { type: 'TransferRequest', id: 'tr1' },
        metadata: expect.objectContaining({
          nextStatus: 'DONE',
          statusSource: 'ASAAS_GET',
        }),
      }),
    );
  });

  it('deve usar o evento quando o payload nao trouxer status', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PENDING',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: {
        type: 'PIX',
        pixAddressKey: 'financeiro@teste.com',
        pixAddressKeyType: 'EMAIL',
      },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
    vi.mocked(getTransfer).mockRejectedValueOnce(new Error('temporary failure'));
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pixTransferSession.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_DONE',
      transfer: { id: 'asaas_tr_1', status: undefined, externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        status: 'DONE',
        statusUpdatedAt: expect.any(Date),
      }),
    });
  });

  it('deve localizar a transferencia pelo externalReference oficial quando o webhook vier sem ele', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'tr1',
        status: 'PENDING',
        asaasTransferId: null,
        externalReference: 'transfer:tr1',
        destination: {
          type: 'PIX',
          pixAddressKey: 'financeiro@teste.com',
          pixAddressKeyType: 'EMAIL',
        },
      } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 10,
      netValue: 10,
      status: 'DONE',
      externalReference: 'transfer:tr1',
      operationType: 'PIX',
      type: 'BANK_ACCOUNT',
      bankAccount: {
        ownerName: 'Fornecedor ABC',
        cpfCnpj: '12345678901',
        pixAddressKey: 'financeiro@teste.com',
        bank: { name: 'Banco do Brasil' },
      },
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pixTransferSession.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_DONE',
      transfer: { id: 'asaas_tr_1', status: 'DONE', externalReference: null },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        asaasTransferId: 'asaas_tr_1',
        status: 'DONE',
      }),
    });
  });

  it('deve bloquear regressão de estado terminal (DONE → PENDING)', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'DONE',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockRejectedValueOnce(new Error('fail'));

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_PENDING',
      transfer: { id: 'asaas_tr_1', status: 'PENDING', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.update).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.transfer_state_regression_blocked',
        metadata: expect.objectContaining({
          currentStatus: 'DONE',
          attemptedStatus: 'PENDING',
        }),
      }),
    );
  });

  it('deve persistir campos oficiais do Asaas (failReason, authorized, transactionReceiptUrl)', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PROCESSING',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 100,
      netValue: 99,
      status: 'DONE',
      operationType: 'PIX',
      authorized: true,
      failReason: null,
      effectiveDate: '2026-03-25',
      transactionReceiptUrl: 'https://asaas.com/receipt/123',
      externalReference: 'transfer:tr1',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_DONE',
      transfer: { id: 'asaas_tr_1', status: 'DONE', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        status: 'DONE',
        rawAsaasStatus: 'DONE',
        authorized: true,
        failReason: null,
        effectiveDate: '2026-03-25',
        transactionReceiptUrl: 'https://asaas.com/receipt/123',
      }),
    });
  });

  it('deve persistir failReason quando transfer falha', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PROCESSING',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 100,
      netValue: 0,
      status: 'FAILED',
      operationType: 'PIX',
      authorized: true,
      failReason: 'Dados bancários inválidos',
      externalReference: 'transfer:tr1',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_FAILED',
      transfer: { id: 'asaas_tr_1', status: 'FAILED', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({
        status: 'FAILED',
        rawAsaasStatus: 'FAILED',
        failReason: 'Dados bancários inválidos',
      }),
    });
  });

  it('deve emitir console.error ao receber TRANSFER_FAILED', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PROCESSING',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: { type: 'PIX', pixAddressKey: 'x', pixAddressKeyType: 'EVP' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 100,
      netValue: 0,
      status: 'FAILED',
      operationType: 'PIX',
      failReason: 'Chave Pix inválida',
      externalReference: 'transfer:tr1',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_FAILED',
      transfer: { id: 'asaas_tr_1', status: 'FAILED', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[finance][handleTransferWebhook][transfer-failed]',
      expect.objectContaining({
        contaId: 't1',
        transferRequestId: 'tr1',
        asaasTransferId: 'asaas_tr_1',
        event: 'TRANSFER_FAILED',
        failReason: 'Chave Pix inválida',
      }),
    );

    consoleSpy.mockRestore();
  });

  it('deve emitir notificação TRANSFER_CANCELLED ao receber TRANSFER_CANCELLED', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');
    const { createNotification } = await import('@alusa/lib');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      id: 'tr1',
      status: 'PROCESSING',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr1',
      destination: { type: 'PIX', pixAddressKey: 'financeiro@teste.com', pixAddressKeyType: 'EMAIL' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 200,
      netValue: 200,
      status: 'CANCELLED',
      operationType: 'PIX',
      externalReference: 'transfer:tr1',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({} as never);

    const res = await handleTransferWebhook('t1', {
      event: 'TRANSFER_CANCELLED',
      transfer: { id: 'asaas_tr_1', status: 'CANCELLED', externalReference: 'transfer:tr1' },
    });

    expect(res.success).toBe(true);
    expect(prisma.transferRequest.update).toHaveBeenCalledWith({
      where: { id: 'tr1' },
      data: expect.objectContaining({ status: 'CANCELED' }),
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 't1',
        type: 'TRANSFER_CANCELLED',
        severity: 'WARNING',
        dedupeKey: 'transfer:cancelled:tr1',
        entityType: 'TransferRequest',
        entityId: 'tr1',
      }),
    );
  });
});
