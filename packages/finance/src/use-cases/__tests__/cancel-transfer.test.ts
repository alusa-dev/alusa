import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cancelTransfer } from '../cancel-transfer';

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    transferRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@alusa/asaas', () => ({
  getTransfer: vi.fn(),
  cancelTransfer: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../webhooks/ensure-webhook-config-operational', () => ({
  ensureWebhookConfigOperational: vi.fn(async () => {}),
}));

const baseTransfer = {
  id: 'tr1',
  externalReference: 'transfer:tr1',
  asaasTransferId: 'asaas_tr_1',
  status: 'PENDING',
};

const actor = { type: 'USER' as const, id: 'u1' };

describe('cancelTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna TRANSFER_NAO_ENCONTRADA quando não existe', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(null as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toEqual({ success: false, error: 'TRANSFER_NAO_ENCONTRADA' });
  });

  it('cancela localmente quando status REQUESTED sem asaasTransferId', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      ...baseTransfer,
      asaasTransferId: null,
      status: 'REQUESTED',
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: null,
      status: 'CANCELED',
      statusUpdatedAt: new Date(),
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toMatchObject({ data: expect.objectContaining({ status: 'CANCELED' }) });
  });

  it('retorna TRANSFER_SEM_ID_ASAAS quando não REQUESTED sem asaasTransferId', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      ...baseTransfer,
      asaasTransferId: null,
      status: 'PENDING',
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toEqual({ success: false, error: 'TRANSFER_SEM_ID_ASAAS' });
  });

  it('retorna CREDENCIAIS_ASAAS_NAO_CONFIGURADAS quando não há credenciais', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(baseTransfer as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toEqual({ success: false, error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS' });
  });

  it('retorna TRANSFER_NAO_CANCELAVEL quando canBeCancelled: false (mesmo com status PENDING)', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(baseTransfer as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    // Asaas pode retornar PENDING mas canBeCancelled: false (ex: agendado em feriado)
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      status: 'PENDING',
      canBeCancelled: false,
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toEqual({ success: false, error: 'TRANSFER_NAO_CANCELAVEL' });
  });

  it('cancela com sucesso quando canBeCancelled: true', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer, cancelTransfer: asaasCancel } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(baseTransfer as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer)
      .mockResolvedValueOnce({ id: 'asaas_tr_1', status: 'PENDING', canBeCancelled: true } as never)
      .mockResolvedValueOnce({ id: 'asaas_tr_1', status: 'CANCELLED', canBeCancelled: false } as never);
    vi.mocked(asaasCancel).mockResolvedValueOnce(undefined as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      status: 'CANCELED',
      statusUpdatedAt: new Date(),
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toMatchObject({ data: expect.objectContaining({ status: 'CANCELED' }) });
    expect(asaasCancel).toHaveBeenCalledOnce();
  });

  it('reutiliza cancelamento já existente no Asaas (CANCELLED) sem chamar cancel novamente', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer, cancelTransfer: asaasCancel } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(baseTransfer as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      status: 'CANCELLED',
      canBeCancelled: false,
      authorized: false,
      failReason: null,
      transactionReceiptUrl: null,
      effectiveDate: null,
    } as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      status: 'CANCELED',
      statusUpdatedAt: new Date(),
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toMatchObject({ data: expect.objectContaining({ status: 'CANCELED' }) });
    expect(asaasCancel).not.toHaveBeenCalled();
  });

  it('usa status PENDING como fallback quando canBeCancelled ausente', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer, cancelTransfer: asaasCancel } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce(baseTransfer as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    // canBeCancelled ausente: fallback por status
    vi.mocked(getTransfer)
      .mockResolvedValueOnce({ id: 'asaas_tr_1', status: 'PENDING' } as never)
      .mockResolvedValueOnce({ id: 'asaas_tr_1', status: 'CANCELLED' } as never);
    vi.mocked(asaasCancel).mockResolvedValueOnce(undefined as never);
    vi.mocked(prisma.transferRequest.update).mockResolvedValueOnce({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      status: 'CANCELED',
      statusUpdatedAt: new Date(),
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toMatchObject({ data: expect.objectContaining({ status: 'CANCELED' }) });
  });

  it('retorna TRANSFER_NAO_CANCELAVEL para BANK_PROCESSING sem canBeCancelled', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(prisma.transferRequest.findFirst).mockResolvedValueOnce({
      ...baseTransfer,
      status: 'PROCESSING',
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'key' } as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_1',
      status: 'BANK_PROCESSING',
      // canBeCancelled ausente — fallback por status: BANK_PROCESSING não é PENDING
    } as never);

    const res = await cancelTransfer({ contaId: 'c1', transferId: 'tr1', actor });
    expect(res).toEqual({ success: false, error: 'TRANSFER_NAO_CANCELAVEL' });
  });
});
