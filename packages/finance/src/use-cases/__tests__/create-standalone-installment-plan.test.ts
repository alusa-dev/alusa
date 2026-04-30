import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createStandaloneInstallmentPlan } from '../create-standalone-installment-plan';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      responsavel: { findFirst: vi.fn() },
      aluno: { findFirst: vi.fn() },
      customer: { findUnique: vi.fn() },
      standaloneInstallmentPlan: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      charge: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  createInstallment: vi.fn(),
  listInstallmentPayments: vi.fn(),
}));

vi.mock('../../foundation/feature-flags.service', () => ({
  featureFlagsService: {
    isEnabled: vi.fn(),
  },
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: {
    record: vi.fn(async () => {}),
  },
}));

vi.mock('../../foundation/kyc-guard', () => ({
  requireKycApproved: vi.fn(),
}));

describe('createStandaloneInstallmentPlan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValue({ success: true, data: true } as never);

    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValue(true as never);
  });

  it('deve bloquear quando feature flag estiver desabilitada', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false as never);

    const res = await createStandaloneInstallmentPlan({
      contaId: 't1',
      payer: { type: 'responsavel', responsavelId: 'r1' },
      installmentCount: 2,
      billingType: 'BOLETO',
      value: 100,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FEATURE_DISABLED');
  });

  it('deve bloquear billingType UNDEFINED', async () => {
    const res = await createStandaloneInstallmentPlan({
      contaId: 't1',
      payer: { type: 'responsavel', responsavelId: 'r1' },
      installmentCount: 2,
      billingType: 'UNDEFINED',
      value: 100,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FORMA_PAGAMENTO_INVALIDA');
  });

  it('deve retornar erro quando customer nao existe', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ id: 'r1', nome: 'Resp' } as never);
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce(null as never);

    const res = await createStandaloneInstallmentPlan({
      contaId: 't1',
      payer: { type: 'responsavel', responsavelId: 'r1' },
      installmentCount: 2,
      billingType: 'BOLETO',
      value: 100,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('CUSTOMER_SEM_ASAAS_ID');
  });

  it('deve criar parcelamento e sincronizar cobranças', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment, listInstallmentPayments } = await import('@alusa/asaas');

    vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({ id: 'r1', nome: 'Resp' } as never);
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({ id: 'cust1', asaasCustomerId: 'asaas_cus_1' } as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);

    vi.mocked(createInstallment).mockResolvedValueOnce({
      object: 'installment',
      id: 'asaas_inst_1',
      installmentCount: 2,
      billingType: 'BOLETO',
      deleted: false,
    } as never);

    vi.mocked(prisma.standaloneInstallmentPlan.create).mockResolvedValueOnce({
      id: 'sip1',
      externalReference: 'alusa:installment:sip1',
      asaasInstallmentId: 'asaas_inst_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({
      data: [
        {
          id: 'pay_1',
          dueDate: '2099-02-10',
          value: 100,
          status: 'PENDING',
          billingType: 'BOLETO',
        },
      ],
    } as never);

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.create).mockResolvedValueOnce({ id: 'ch1' } as never);

    const res = await createStandaloneInstallmentPlan({
      contaId: 't1',
      payer: { type: 'responsavel', responsavelId: 'r1' },
      installmentCount: 2,
      billingType: 'BOLETO',
      value: 100,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toMatchObject({
        installmentPlanId: 'sip1',
        asaasInstallmentId: 'asaas_inst_1',
        status: 'ACTIVE',
      });
    }

    expect(createInstallment).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        data: expect.objectContaining({
          customer: 'asaas_cus_1',
          installmentCount: 2,
          value: 50,
          totalValue: 100,
          dueDate: '2099-01-10',
          billingType: 'BOLETO',
        }),
      })
    );
  });
});
