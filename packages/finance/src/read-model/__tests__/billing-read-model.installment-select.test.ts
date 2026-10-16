import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    standaloneSubscription: { findMany: vi.fn() },
    subscription: { findMany: vi.fn() },
    standaloneInstallmentPlan: { findMany: vi.fn() },
    installmentPlan: { findMany: vi.fn() },
    financeInstallmentPlanReadModel: { upsert: vi.fn() },
  },
  findCustomerForPayer: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: mocks.prisma,
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('../../customer/customer-identity', () => ({
  findCustomerForPayer: mocks.findCustomerForPayer,
}));

import { rebuildFinanceBillingReadModels } from '../billing-read-model.service';

describe('rebuildFinanceBillingReadModels installment projection selects', () => {
  const contaId = 'conta-installment-a';
  const createdAt = new Date('2026-10-01T00:00:00.000Z');
  const updatedAt = new Date('2026-10-02T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.standaloneSubscription.findMany.mockResolvedValue([]);
    mocks.prisma.subscription.findMany.mockResolvedValue([]);
    mocks.prisma.standaloneInstallmentPlan.findMany.mockResolvedValue([]);
    mocks.prisma.installmentPlan.findMany.mockResolvedValue([]);
    mocks.prisma.financeInstallmentPlanReadModel.upsert.mockResolvedValue({ id: 'read-model-id' });
    mocks.findCustomerForPayer.mockResolvedValue(null);
  });

  it('upserts standalone installments by tenant and source with only the result id selected', async () => {
    mocks.prisma.standaloneInstallmentPlan.findMany.mockResolvedValue([{
      id: 'standalone-plan-a',
      contaId,
      customerId: 'customer-a',
      customer: { asaasCustomerId: 'cus-a' },
      asaasInstallmentId: 'ins-a',
      payerType: null,
      payerId: null,
      status: 'ACTIVE',
      billingType: 'PIX',
      value: 1250,
      installmentCount: 3,
      firstDueDate: new Date('2026-11-01T00:00:00.000Z'),
      familyGroupId: null,
      createdAt,
      updatedAt,
    }] as never);

    const result = await rebuildFinanceBillingReadModels({ contaId });

    expect(result.installmentsProjected).toBe(1);
    expect(mocks.prisma.standaloneInstallmentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contaId } }),
    );
    const [args] = mocks.prisma.financeInstallmentPlanReadModel.upsert.mock.calls[0];
    expect(args.where.uq_fin_installment_rm_source).toEqual({
      contaId,
      sourceKind: 'STANDALONE_INSTALLMENT',
      sourceId: 'standalone-plan-a',
    });
    expect(args.create).toMatchObject({
      contaId,
      sourceKind: 'STANDALONE_INSTALLMENT',
      sourceId: 'standalone-plan-a',
    });
    expect(args.select).toEqual({ id: true });
    expect(Object.keys(args.select)).toEqual(['id']);
  });

  it('upserts academic installments by tenant and source with only the result id selected', async () => {
    mocks.prisma.installmentPlan.findMany.mockResolvedValue([{
      id: 'academic-plan-a',
      contaId,
      asaasInstallmentId: 'ins-academic-a',
      status: 'ACTIVE',
      billingType: 'BOLETO',
      value: 2400,
      installmentCount: 4,
      firstDueDate: new Date('2026-11-01T00:00:00.000Z'),
      matriculaId: 'matricula-a',
      contratoId: 'contract-a',
      createdAt,
      updatedAt,
      matricula: {
        aluno: { id: 'student-a', nome: 'Student A', asaasCustomerId: 'cus-academic-a' },
        responsavelFinanceiro: null,
      },
    }] as never);

    const result = await rebuildFinanceBillingReadModels({ contaId });

    expect(result.installmentsProjected).toBe(1);
    expect(mocks.prisma.installmentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contaId } }),
    );
    expect(mocks.findCustomerForPayer).toHaveBeenCalledWith(contaId, 'ALUNO', 'student-a');
    const [args] = mocks.prisma.financeInstallmentPlanReadModel.upsert.mock.calls[0];
    expect(args.where.uq_fin_installment_rm_source).toEqual({
      contaId,
      sourceKind: 'ACADEMIC_INSTALLMENT',
      sourceId: 'academic-plan-a',
    });
    expect(args.create).toMatchObject({
      contaId,
      sourceKind: 'ACADEMIC_INSTALLMENT',
      sourceId: 'academic-plan-a',
    });
    expect(args.select).toEqual({ id: true });
    expect(Object.keys(args.select)).toEqual(['id']);
  });
});
