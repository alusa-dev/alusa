import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleInstallmentWebhook } from '../installment-webhook-handler';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      installmentPlan: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getInstallment: vi.fn(),
  listInstallmentPayments: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

describe('handleInstallmentWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve ignorar eventos que não são PAYMENT_*', async () => {
    const { prisma } = await import('@alusa/database');

    const res = await handleInstallmentWebhook('t1', {
      event: 'SUBSCRIPTION_UPDATED',
      payment: { id: 'pay_1' },
    });

    expect(res).toEqual({ success: true });
    expect(prisma.installmentPlan.findFirst).not.toHaveBeenCalled();
  });

  it('deve retornar sucesso quando não encontra InstallmentPlan', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_1',
        externalReference: 'installmentPlan:ip1',
        status: 'CONFIRMED',
        installmentNumber: 1,
      },
    });

    expect(res).toEqual({ success: true });
  });

  it('deve setar asaasInstallmentId e cancelar quando installment.deleted=true', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip1',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: null,
      externalReference: 'installmentPlan:ip1',
      installmentCount: 3,
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment).mockResolvedValueOnce({ id: 'asaas_inst_1', deleted: true } as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_1',
        status: 'CONFIRMED',
        externalReference: 'installmentPlan:ip1',
        installment: 'asaas_inst_1',
        installmentNumber: 1,
      },
    });

    expect(res.success).toBe(true);
    expect(listInstallmentPayments).not.toHaveBeenCalled();

    expect(prisma.installmentPlan.update).toHaveBeenCalledWith({
      where: { id: 'ip1' },
      data: expect.objectContaining({
        asaasInstallmentId: 'asaas_inst_1',
        status: 'CANCELED',
        statusUpdatedAt: expect.any(Date),
      }),
    });

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 't1',
        action: 'finance.webhook.installmentPlan_status_changed',
        entity: { type: 'InstallmentPlan', id: 'ip1' },
      }),
    );
  });

  it('deve marcar COMPLETED via Asaas quando todas as parcelas estão pagas', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip1',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: 'asaas_inst_1',
      externalReference: 'installmentPlan:ip1',
      installmentCount: 3,
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment).mockResolvedValueOnce({ id: 'asaas_inst_1', deleted: false } as never);
    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({
      object: 'list',
      hasMore: false,
      totalCount: 3,
      limit: 100,
      offset: 0,
      data: [
        { id: 'pay_1', status: 'CONFIRMED', deleted: false },
        { id: 'pay_2', status: 'RECEIVED', deleted: false },
        { id: 'pay_3', status: 'RECEIVED_IN_CASH', deleted: false },
      ],
    } as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_2',
        status: 'RECEIVED',
        externalReference: 'installmentPlan:ip1',
        installment: 'asaas_inst_1',
        installmentNumber: 2,
      },
    });

    expect(res.success).toBe(true);
    expect(prisma.installmentPlan.update).toHaveBeenCalledWith({
      where: { id: 'ip1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        statusUpdatedAt: expect.any(Date),
      }),
    });
  });

  it('deve fazer fallback heurístico para COMPLETED quando Asaas falha', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip1',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: null,
      externalReference: 'installmentPlan:ip1',
      installmentCount: 3,
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment).mockRejectedValueOnce(new Error('asaas down'));
    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({} as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_last',
        status: 'CONFIRMED',
        externalReference: 'installmentPlan:ip1',
        installment: 'asaas_inst_1',
        installmentNumber: 3,
      },
    });

    expect(res.success).toBe(true);

    expect(prisma.installmentPlan.update).toHaveBeenCalledWith({
      where: { id: 'ip1' },
      data: expect.objectContaining({
        asaasInstallmentId: 'asaas_inst_1',
        status: 'COMPLETED',
        statusUpdatedAt: expect.any(Date),
      }),
    });
  });
});
