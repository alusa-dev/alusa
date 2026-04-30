import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createInstallmentPlan } from '../create-installment-plan';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      matricula: {
        findFirst: vi.fn(),
      },
      contrato: {
        findFirst: vi.fn(),
      },
      installmentPlan: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
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

vi.mock('../ensure-customer', () => ({
  ensureCustomer: vi.fn(),
}));

describe('createInstallmentPlan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const { requireKycApproved } = await import('../../foundation/kyc-guard');
    vi.mocked(requireKycApproved).mockResolvedValue({ success: true, data: true } as never);
  });

  it('deve bloquear quando enableInstallments está off', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(false);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('FEATURE_DISABLED');
  });

  it('deve retornar idempotente quando já existe InstallmentPlan com asaasInstallmentId', async () => {
    const { prisma } = await import('@alusa/database');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    vi.mocked(prisma.installmentPlan.findUnique).mockResolvedValueOnce({
      id: 'ip1',
      contratoId: 'c1',
      matriculaId: 'm1',
      externalReference: 'installmentPlan:ip1',
      asaasInstallmentId: 'asaas_inst_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toMatchObject({
        installmentPlanId: 'ip1',
        externalReference: 'installmentPlan:ip1',
        asaasInstallmentId: 'asaas_inst_1',
        status: 'ACTIVE',
      });
    }
  });

  it('deve criar parcelamento no Asaas e persistir asaasInstallmentId', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createInstallment: asaasCreateInstallment, listInstallmentPayments } = await import('@alusa/asaas');
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { ensureCustomer } = await import('../ensure-customer');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);

    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      alunoId: 'a1',
      responsavelFinanceiroId: 'r1',
      aluno: { id: 'a1', dataNasc: new Date('2000-01-01') },
    } as never);

    vi.mocked(prisma.contrato.findFirst).mockResolvedValueOnce({ id: 'c1' } as never);

    // Nenhum plano existente
    vi.mocked(prisma.installmentPlan.findUnique)
      .mockResolvedValueOnce(null as never) // byContrato
      .mockResolvedValueOnce(null as never); // byMatricula

    vi.mocked(ensureCustomer).mockResolvedValueOnce({
      success: true,
      data: { customerId: 'asaas_cus_1', externalReference: 'financeProfile:fp1' },
    } as never);

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'sandbox_x', contaId: 't1' } as never);

    vi.mocked(asaasCreateInstallment).mockResolvedValueOnce({
      object: 'installment',
      id: 'asaas_inst_1',
      installmentCount: 3,
      billingType: 'BOLETO',
      deleted: false,
    } as never);

    // Sem pagamentos gerados (simplifica teste)
    vi.mocked(listInstallmentPayments).mockResolvedValueOnce({ data: [] } as never);

    vi.mocked(prisma.installmentPlan.create).mockResolvedValueOnce({
      id: 'ip1',
      externalReference: 'alusa:installment:ip1',
      asaasInstallmentId: 'asaas_inst_1',
      status: 'ACTIVE',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    vi.mocked(asaasCreateInstallment).mockResolvedValueOnce({
      object: 'installment',
      id: 'asaas_inst_1',
      installmentCount: 3,
      billingType: 'BOLETO',
      deleted: false,
    } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(true);

    expect(asaasCreateInstallment).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sandbox_x',
        data: expect.objectContaining({
          customer: 'asaas_cus_1',
          installmentCount: 3,
          value: 150,
          dueDate: '2099-01-10',
          billingType: 'BOLETO',
        }),
      }),
    );

    // paymentExternalReference deve estar no formato V2 (sem subcontaId)
    const callData = vi.mocked(asaasCreateInstallment).mock.calls[0][0].data;
    expect(callData.paymentExternalReference).toMatch(/^alusa:installment:/);
    expect(callData.paymentExternalReference!.length).toBeLessThanOrEqual(100);
  });

  it('deve bloquear quando KYC não está aprovado', async () => {
    const { featureFlagsService } = await import('../../foundation/feature-flags.service');
    const { prisma } = await import('@alusa/database');
    const { requireKycApproved } = await import('../../foundation/kyc-guard');

    vi.mocked(featureFlagsService.isEnabled).mockResolvedValueOnce(true);
    vi.mocked(requireKycApproved).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const res = await createInstallmentPlan({
      contaId: 't1',
      contratoId: 'c1',
      matriculaId: 'm1',
      installmentCount: 3,
      billingType: 'BOLETO',
      value: 150,
      firstDueDate: '2099-01-10',
      actor: { type: 'USER', id: 'u1' },
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('KYC_NAO_APROVADO');
    expect(prisma.matricula.findFirst).not.toHaveBeenCalled();
  });
});
