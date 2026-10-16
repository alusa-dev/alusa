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

  it('deve retornar sucesso sem consultar Asaas quando não encontra plano na conta', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');
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
    expect(prisma.installmentPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 't1' }),
    }));
    expect(prisma.installmentPlan.update).not.toHaveBeenCalled();
    expect(loadAsaasCredentials).not.toHaveBeenCalled();
    expect(getInstallment).not.toHaveBeenCalled();
    expect(listInstallmentPayments).not.toHaveBeenCalled();
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

  it('deve solicitar retry quando lookup falha e processar a reentrega após recuperação', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    const plan = {
      id: 'ip1',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: null,
      externalReference: 'installmentPlan:ip1',
      installmentCount: 3,
    };
    vi.mocked(prisma.installmentPlan.findFirst)
      .mockResolvedValueOnce(plan as never)
      .mockResolvedValueOnce(plan as never);

    vi.mocked(loadAsaasCredentials)
      .mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never)
      .mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment)
      .mockResolvedValueOnce({ id: 'asaas_inst_1', deleted: false } as never)
      .mockResolvedValueOnce({ id: 'asaas_inst_1', deleted: false } as never);
    vi.mocked(listInstallmentPayments)
      .mockRejectedValueOnce(new Error('asaas down'))
      .mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 3, limit: 100, offset: 0,
        data: [
          { id: 'pay_1', status: 'RECEIVED', deleted: false },
          { id: 'pay_2', status: 'RECEIVED', deleted: false },
          { id: 'pay_3', status: 'RECEIVED', deleted: false },
        ],
      } as never);

    const payload = {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_last',
        status: 'CONFIRMED',
        externalReference: 'installmentPlan:ip1',
        installment: 'asaas_inst_1',
        installmentNumber: 3,
      },
    } as const;

    const firstDelivery = await handleInstallmentWebhook('t1', payload);
    expect(firstDelivery.success).toBe(false);
    expect(prisma.installmentPlan.update).not.toHaveBeenCalled();

    const retryDelivery = await handleInstallmentWebhook('t1', payload);
    expect(retryDelivery.success).toBe(true);
    expect(prisma.installmentPlan.update).toHaveBeenCalledWith({
      where: { id: 'ip1' },
      data: expect.objectContaining({ status: 'COMPLETED', statusUpdatedAt: expect.any(Date) }),
    });
  });

  it('deve solicitar retry quando há installmentId mas faltam credenciais Asaas', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip-no-credentials',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: 'asaas_inst_no_credentials',
      externalReference: 'installmentPlan:ip-no-credentials',
      installmentCount: 3,
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_last', status: 'CONFIRMED', externalReference: 'installmentPlan:ip-no-credentials',
        installment: 'asaas_inst_no_credentials', installmentNumber: 3,
      },
    });

    expect(res.success).toBe(false);
    expect(getInstallment).not.toHaveBeenCalled();
    expect(listInstallmentPayments).not.toHaveBeenCalled();
    expect(prisma.installmentPlan.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      title: 'totalCount contradiz os dados',
      totalCount: 2,
      hasMore: false,
      data: [{ id: 'pay-one', status: 'RECEIVED', deleted: false }],
    },
    {
      title: 'IDs duplicados',
      totalCount: 2,
      hasMore: false,
      data: [
        { id: 'pay-duplicate', status: 'RECEIVED', deleted: false },
        { id: 'pay-duplicate', status: 'RECEIVED', deleted: false },
      ],
    },
    { title: 'página sem progresso', totalCount: 10, hasMore: true, data: [] },
  ])('deve solicitar retry quando $title', async ({ totalCount, hasMore, data }) => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip-incomplete-pages',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: 'asaas_inst_incomplete_pages',
      externalReference: 'installmentPlan:ip-incomplete-pages',
      installmentCount: 3,
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment).mockResolvedValueOnce({ id: 'asaas_inst_incomplete_pages', deleted: false } as never);
    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({
      object: 'list', hasMore, totalCount, limit: 100, offset: 0, data,
    } as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_last', status: 'CONFIRMED', externalReference: 'installmentPlan:ip-incomplete-pages',
        installment: 'asaas_inst_incomplete_pages', installmentNumber: 3,
      },
    });

    expect(res.success).toBe(false);
    expect(listInstallmentPayments).toHaveBeenCalledTimes(1);
    expect(prisma.installmentPlan.update).not.toHaveBeenCalled();
  });

  it('deve avançar pelo limite solicitado e solicitar retry ao atingir o limite de páginas', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'ip-page-limit',
      status: 'ACTIVE',
      statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      asaasInstallmentId: 'asaas_inst_page_limit',
      externalReference: 'installmentPlan:ip-page-limit',
      installmentCount: 3,
    } as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x' } as never);
    vi.mocked(getInstallment).mockResolvedValueOnce({ id: 'asaas_inst_page_limit', deleted: false } as never);
    vi.mocked(listInstallmentPayments).mockImplementation(async ({ offset }) => ({
      object: 'list',
      hasMore: true,
      totalCount: 10_101,
      limit: 0,
      offset,
      data: Array.from({ length: 100 }, (_, index) => ({
        id: `pay-${offset + index}`,
        status: 'RECEIVED',
        deleted: false,
      })),
    }) as never);

    const res = await handleInstallmentWebhook('t1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_page_limit',
        status: 'CONFIRMED',
        externalReference: 'installmentPlan:ip-page-limit',
        installment: 'asaas_inst_page_limit',
        installmentNumber: 3,
      },
    });

    expect(res.success).toBe(false);
    expect(listInstallmentPayments).toHaveBeenCalledTimes(101);
    expect(prisma.installmentPlan.update).not.toHaveBeenCalled();
  });
});
