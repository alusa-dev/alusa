import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePaymentWebhook } from '../payment-webhook-handler';
import { fulfillReservedSaleOnPayment } from '../../use-cases/store-inventory';

const {
  mockUpdateFinanceStatusFromPayment,
  mockResolvePaymentToLocalEntity,
  mockEnsureAcademicChargeForCobranca,
  mockProjectAcademicEnrollmentFeeState,
  mockProjectFamilyEnrollmentFeeState,
  mockUpsertFinanceReconciliationIssue,
  mockLinkSaleToFirstInstallmentCharge,
} = vi.hoisted(() => ({
  mockUpdateFinanceStatusFromPayment: vi.fn(async () => ({ success: true })),
  mockResolvePaymentToLocalEntity: vi.fn(async () => ({ type: 'not_found', reason: 'test_default' })),
  mockEnsureAcademicChargeForCobranca: vi.fn(async () => ({ id: 'charge_academic_mock', cobrancaId: 'c_mock' })),
  mockProjectAcademicEnrollmentFeeState: vi.fn(async () => ({ projected: true })),
  mockProjectFamilyEnrollmentFeeState: vi.fn(async () => ({ projected: true })),
  mockUpsertFinanceReconciliationIssue: vi.fn(async () => ({ id: 'issue-1' })),
  mockLinkSaleToFirstInstallmentCharge: vi.fn(async () => null),
}));

vi.mock('../../foundation/payment-resolution-policy', () => {
  return {
    isPaymentResolutionPolicyEnabled: vi.fn(() => false),
  };
});

vi.mock('../payment-resolver', () => ({
  resolvePaymentToLocalEntity: mockResolvePaymentToLocalEntity,
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../guards/finance-status-guard', () => ({
  updateFinanceStatusFromPayment: mockUpdateFinanceStatusFromPayment,
}));

vi.mock('../../fiscal/ensure-academic-charge-for-cobranca', () => ({
  ensureAcademicChargeForCobranca: mockEnsureAcademicChargeForCobranca,
}));

vi.mock('../../use-cases/payment-command-ledger', () => ({
  confirmPaymentCommandsByProviderEvent: vi.fn(async () => ({ confirmed: 0 })),
}));

vi.mock('../../use-cases/store-inventory', () => ({
  fulfillReservedSaleOnPayment: vi.fn(async () => ({ fulfilled: false })),
  linkSaleToFirstInstallmentCharge: mockLinkSaleToFirstInstallmentCharge,
}));

vi.mock('../../projections/enrollment-fee-projection.service', () => ({
  projectAcademicEnrollmentFeeState: mockProjectAcademicEnrollmentFeeState,
  projectFamilyEnrollmentFeeState: mockProjectFamilyEnrollmentFeeState,
}));

vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: mockUpsertFinanceReconciliationIssue,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    $transaction: vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => callback((await import('@alusa/database')).prisma)),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    cobranca: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    financePaymentStateTransition: {
      create: vi.fn(async () => ({ id: 'state-transition-1' })),
      findUnique: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    standaloneSubscription: {
      findFirst: vi.fn(),
    },
    standaloneInstallmentPlan: {
      findFirst: vi.fn(),
    },
    installmentPlan: {
      findFirst: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    aluno: {
      findFirst: vi.fn(),
    },
    responsavel: {
      findFirst: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    pagamento: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    lancamento: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    logIntegracao: {
      create: vi.fn(),
    },
    enrollmentCreationOperation: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

describe('handlePaymentWebhook', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockUpdateFinanceStatusFromPayment.mockResolvedValue({ success: true });

    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
    const { prisma } = await import('@alusa/database');
    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(false);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'not_found', reason: 'test_default' });
    mockEnsureAcademicChargeForCobranca.mockResolvedValue({ id: 'charge_academic_mock', cobrancaId: 'c_mock' });
    mockProjectAcademicEnrollmentFeeState.mockResolvedValue({ projected: true });
    mockProjectFamilyEnrollmentFeeState.mockResolvedValue({ projected: true });
    mockUpsertFinanceReconciliationIssue.mockResolvedValue({ id: 'issue-1' });
    mockLinkSaleToFirstInstallmentCharge.mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: (_tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null as never);
    vi.mocked(prisma.financePaymentStateTransition.create).mockResolvedValue({ id: 'state-transition-1' } as never);
  });

  it('mantém payment da saga invisível quando webhook chega antes do commit', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce({
      id: 'op-1',
      status: 'PROCESSING',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-fee-1',
        status: 'PENDING',
        value: 80,
        dueDate: '2099-01-01',
        externalReference: 'enrollment-op:op-1:fee',
      },
    });

    expect(result).toEqual({
      success: false,
      error: 'ENROLLMENT_CREATION_IN_PROGRESS',
    });
    expect(prisma.enrollmentCreationOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'op-1', contaId: 'conta-1' },
      data: { asaasEnrollmentFeePaymentId: 'pay-fee-1' },
    });
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
  });

  it('não materializa cobrança operacional para payment sem vínculo local', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce(null as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_external_only',
        status: 'PENDING',
        value: 170,
        netValue: 168,
        dueDate: '2026-09-10',
        description: 'Mensalidade externa',
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
      localEntityType: 'Payment',
    });
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        entityType: 'PAYMENT',
        entityId: null,
        asaasId: 'pay_external_only',
        issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'finance.webhook.cobranca_not_found',
        metadata: expect.objectContaining({ createdPlaceholderCharge: false }),
      }),
    );
  });

  it('deve projetar a taxa de matrícula quando o pagamento for confirmado', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c_taxa',
      matriculaId: 'm_taxa',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_taxa',
      tipo: 'TAXA_MATRICULA',
      formaPagamento: 'CARTAO_CREDITO',
    } as never);

    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pg_taxa' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_taxa',
        status: 'CONFIRMED',
        value: 80,
        netValue: 77.92,
        billingType: 'CREDIT_CARD',
      },
    });

    expect(result.success).toBe(true);
    expect(mockProjectAcademicEnrollmentFeeState).toHaveBeenCalledWith({
      contaId: 'conta-1',
      cobrancaId: 'c_taxa',
      eventName: 'PAYMENT_CONFIRMED',
    });
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
  });

  it('deve registrar Pagamento quando confirmado mesmo sem liquidação', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      matriculaId: 'm1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);

    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'p1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_1',
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.pagamento.create).toHaveBeenCalledTimes(1);
    expect(prisma.pagamento.findFirst).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', asaasPaymentId: 'pay_1' },
      select: { id: true },
    });
    expect(prisma.lancamento.findFirst).not.toHaveBeenCalled();
    expect(prisma.lancamento.create).not.toHaveBeenCalled();
    expect(prisma.logIntegracao.create).toHaveBeenCalledTimes(1);
  });

  it('não trata Charge acadêmica resolvida deterministicamente como standalone', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');

    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValueOnce({
      type: 'charge',
      chargeId: 'charge_academic_1',
      cobrancaId: 'c_academic_1',
    });

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'charge_academic_1',
      cobrancaId: 'c_academic_1',
      status: 'OPEN',
      asaasPaymentId: 'pay_academic_1',
    } as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c_academic_1',
      matriculaId: 'm_academic_1',
      status: 'A_VENCER',
      asaasPaymentId: 'pay_academic_1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'CARTAO_CREDITO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pg_academic_1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_academic_1',
        status: 'CONFIRMED',
        value: 140,
        netValue: 136.73,
        originalValue: 150,
        subscription: 'sub_asaas_1',
        dueDate: '2026-07-05',
        paymentDate: '2026-06-18',
        creditDate: '2026-07-20',
        billingType: 'CREDIT_CARD',
        externalReference: 'alusa:subscription:m_academic_1:cycle_1',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.findUnique).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c_academic_1' },
        data: expect.objectContaining({
          status: 'PAGO',
          asaasStatus: 'CONFIRMED',
          dataPagamento: expect.any(Date),
          pagoEm: expect.any(Date),
        }),
      }),
    );
    const paymentUpdate = vi.mocked(prisma.cobranca.update).mock.calls.find(
      ([call]) => call?.where?.id === 'c_academic_1' && call?.data?.status === 'PAGO',
    )?.[0];
    expect(paymentUpdate?.data?.dataPagamento).toEqual(new Date('2026-06-18'));
    expect(paymentUpdate?.data?.asaasCreditDate).toEqual(new Date('2026-07-20'));
    expect(prisma.pagamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cobrancaId: 'c_academic_1',
          asaasPaymentId: 'pay_academic_1',
          valorPago: 140,
        }),
      }),
    );
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charge_academic_1' },
        data: expect.objectContaining({
          status: 'PAID',
          asaasStatus: 'CONFIRMED',
        }),
      }),
    );
  });

  it('deve vincular taxa pela externalReference legada mesmo sem charge local previa', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cobranca_legacy',
      matriculaId: 'mat_legacy',
      status: 'PENDENTE',
      asaasPaymentId: null,
      tipo: 'TAXA_MATRICULA',
      formaPagamento: 'PIX',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pg_legacy' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_taxa_legacy',
        status: 'PENDING',
        value: 80,
        netValue: 80,
        externalReference: 'charge:cobranca_legacy',
        billingType: 'PIX',
        dueDate: '2026-04-05',
        invoiceUrl: 'https://asaas.test/i/pay_taxa_legacy',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { matricula: { aluno: { contaId: 'conta-1' } } },
            {
              OR: expect.arrayContaining([
                { id: 'cobranca_legacy' },
                { asaasPaymentId: 'pay_taxa_legacy' },
                { asaasId: 'pay_taxa_legacy' },
              ]),
            },
          ],
        },
      }),
    );
    expect(prisma.cobranca.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'cobranca_legacy' },
        data: { asaasPaymentId: 'pay_taxa_legacy' },
      }),
    );
    expect(prisma.cobranca.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'cobranca_legacy' },
        data: expect.objectContaining({
          asaasStatus: 'PENDING',
          asaasValue: 80,
          asaasNetValue: 80,
        }),
      }),
    );
  });

  it('deve criar cobranca de assinatura com forma de pagamento oficial e persistir invoiceUrl do payment', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'sub_local_1',
      externalReference: 'subscription:matricula:m1',
      matriculaId: 'm1',
      matricula: {
        id: 'm1',
        alunoId: 'a1',
        planoId: 'p1',
        comboId: null,
        vencimentoDia: 5,
        plano: { id: 'p1', nome: 'Plano Mensal', valor: 75 },
        combo: null,
      },
    } as never);
    vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({
      id: 'c_mensalidade_1',
      matriculaId: 'm1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_sub_1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'CARTAO_CREDITO',
    } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'c_mensalidade_1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_sub_1',
        status: 'PENDING',
        value: 75,
        netValue: 72.5,
        subscription: 'sub_asaas_1',
        dueDate: '2026-04-05',
        billingType: 'CREDIT_CARD',
        description: 'Mensalidade - Plano Mensal',
        invoiceUrl: 'https://asaas.test/i/pay_sub_1',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formaPagamento: 'CARTAO_CREDITO',
          asaasPaymentId: 'pay_sub_1',
          asaasStatus: 'PENDING',
        }),
      }),
    );
    expect(mockEnsureAcademicChargeForCobranca).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        cobrancaId: 'c_mensalidade_1',
        asaasPaymentId: 'pay_sub_1',
        payment: expect.objectContaining({
          id: 'pay_sub_1',
          billingType: 'CREDIT_CARD',
          invoiceUrl: 'https://asaas.test/i/pay_sub_1',
        }),
      }),
    );
  });

  it('deve persistir invoiceUrl ao criar charge de assinatura standalone via webhook', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.standaloneSubscription.findFirst).mockResolvedValueOnce({
      id: 'sub_local_1',
      asaasSubscriptionId: 'sub_asaas_1',
      externalReference: 'alusa:standalone-subscription:sub_local_1',
      status: 'ACTIVE',
      description: 'Assinatura recorrente',
      billingType: 'CREDIT_CARD',
      customerId: 'customer_1',
    } as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValueOnce({
      payerType: 'ALUNO',
      payerId: 'aluno_1',
    } as never);
    vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({ nome: 'Bryan de Alencar Bezerra' } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'charge_standalone_1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_sub_standalone_1',
        status: 'PENDING',
        value: 80,
        netValue: 77.92,
        subscription: 'sub_asaas_1',
        dueDate: '2099-04-05',
        billingType: 'CREDIT_CARD',
        invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uq_charge_conta_asaas_payment: {
            contaId: 'conta-1',
            asaasPaymentId: 'pay_sub_standalone_1',
          },
        },
        update: expect.objectContaining({
          invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
        }),
        create: expect.objectContaining({
          invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
          standaloneSubscriptionId: 'sub_local_1',
        }),
      }),
    );
  });

  it('liga a primeira parcela e dispara fulfillment quando o webhook chega antes da venda', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findFirst).mockResolvedValueOnce({
      id: 'plan-standalone-1',
      externalReference: 'alusa:standalone-installment:plan-standalone-1',
      billingType: 'PIX',
      interestValue: null,
      fineValue: null,
      fineType: null,
      discountValue: null,
      discountType: null,
      discountDueDateLimitDays: null,
      customer: { id: 'customer-1', payerType: 'ALUNO', payerId: 'aluno-1' },
    } as never);
    vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({ nome: 'Cliente Parcelado' } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'charge-installment-1' } as never);
    mockLinkSaleToFirstInstallmentCharge.mockResolvedValueOnce('charge-installment-1');
    vi.mocked(fulfillReservedSaleOnPayment).mockResolvedValueOnce({ fulfilled: true });

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay-installment-1',
        status: 'CONFIRMED',
        value: 90,
        netValue: 88,
        installment: 'asaas-installment-1',
        installmentNumber: 1,
        dueDate: '2026-08-01',
        billingType: 'PIX',
      },
    });

    expect(result).toMatchObject({ success: true, stateChanged: true });
    expect(mockLinkSaleToFirstInstallmentCharge).toHaveBeenCalledWith({
      contaId: 'conta-1',
      installmentPlanId: 'plan-standalone-1',
    });
    expect(fulfillReservedSaleOnPayment).toHaveBeenCalledWith({
      contaId: 'conta-1',
      chargeId: 'charge-installment-1',
      trigger: 'webhook_installment_payment_confirmed',
    });
  });

  it('deve atualizar charge standalone por asaasPaymentId mesmo sem externalReference', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_1',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_1',
    } as never);

    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_1', status: 'CANCELED' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_DELETED',
      payment: {
        id: 'pay_1',
        status: 'PENDING',
        deleted: true,
        value: 100,
        netValue: 100,
        externalReference: undefined,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_1' },
        data: expect.objectContaining({
          status: 'CANCELED',
          asaasStatus: 'DELETED',
          liquidacaoStatus: 'NAO_APLICAVEL',
        }),
      }),
    );
  });

  it('normaliza recebimento em dinheiro mesmo quando o Asaas envia status RECEIVED', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_cash_1',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_cash_1',
    } as never);

    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_cash_1', status: 'PAID' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_cash_1',
        status: 'RECEIVED',
        value: 150,
        netValue: 150,
        paymentDate: '2026-06-21',
        billingType: 'RECEIVED_IN_CASH',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_cash_1' },
        data: expect.objectContaining({
          status: 'PAID',
          asaasStatus: 'RECEIVED_IN_CASH',
          liquidacaoStatus: 'DISPONIVEL',
        }),
      }),
    );
  });

  it('deve permitir charge standalone voltar de PAID para OVERDUE ao desfazer recebimento em dinheiro', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_cash_undo',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_cash_undo',
    } as never);

    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_cash_undo', status: 'OVERDUE' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      payment: {
        id: 'pay_cash_undo',
        status: 'OVERDUE',
        value: 150,
        netValue: 150,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_cash_undo' },
        data: expect.objectContaining({ status: 'OVERDUE' }),
      }),
    );
  });

  it('retorna skipReason quando bloqueia regressão de charge standalone', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_paid',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_paid',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_OVERDUE',
      payment: {
        id: 'pay_paid',
        status: 'OVERDUE',
        value: 150,
        netValue: 150,
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'STATUS_TRANSITION_BLOCKED',
      localEntityType: 'Charge',
      localEntityId: 'ch_paid',
      previousStatus: 'PAID',
      nextStatus: 'OVERDUE',
    });
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_paid' },
        data: expect.objectContaining({
          asaasStatus: 'OVERDUE',
          statusUpdatedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.charge.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OVERDUE' }),
      }),
    );
  });

  it('preserva asaasStatus pago quando PAYMENT_UPDATED tenta regredir snapshot em charge PAID', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_paid',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_paid',
      asaasStatus: 'CONFIRMED',
    } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_UPDATED',
      payment: {
        id: 'pay_paid',
        status: 'PENDING',
        value: 150,
        netValue: 143.5,
      },
    });

    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_paid' },
        data: expect.objectContaining({
          asaasStatus: 'CONFIRMED',
        }),
      }),
    );
  });

  it('preserva asaasStatus CONFIRMED ao bloquear regressão por PAYMENT_OVERDUE', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_paid',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_paid',
      asaasStatus: 'CONFIRMED',
    } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_OVERDUE',
      payment: {
        id: 'pay_paid',
        status: 'OVERDUE',
        value: 150,
        netValue: 150,
      },
    });

    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_paid' },
        data: expect.objectContaining({
          asaasStatus: 'CONFIRMED',
        }),
      }),
    );
  });

  it('deve marcar cobrança como ESTORNADO_PARCIAL e registrar auditoria sensível em estorno parcial', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      matriculaId: 'm1',
      status: 'PAGO',
      asaasPaymentId: 'pay_partial',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce({ id: 'pg_1' } as never);
    vi.mocked(prisma.pagamento.update).mockResolvedValueOnce({ id: 'pg_1' } as never);
    vi.mocked(prisma.lancamento.findFirst)
      .mockResolvedValueOnce({
        id: 'lan_1',
        valor: 100,
        descricao: 'Pagamento confirmado (c1)',
        referencia: 'pagamento:pay_partial',
        formaPagamento: 'BOLETO',
        tipo: 'RECEITA',
        origem: 'SISTEMA',
        status: 'RECEBIDO',
      } as never)
      .mockResolvedValueOnce(null as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_PARTIALLY_REFUNDED',
      payment: {
        id: 'pay_partial',
        status: 'RECEIVED',
        value: 100,
        netValue: 80,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ESTORNADO_PARCIAL',
          estornadoMotivo: 'Webhook Asaas: estorno parcial',
        }),
      }),
    );
    expect(prisma.lancamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          valor: 20,
          externalRef: 'asaas:payment:pay_partial:partial-refund',
          idempotencyKey: 'asaas:payment:pay_partial:partial-refund',
        }),
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'finance.webhook.payment_sensitive_event' }),
    );
  });

  it('deve estornar pagamento e lançamento quando webhook de chargeback chegar', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c2',
      matriculaId: 'm2',
      status: 'PAGO',
      asaasPaymentId: 'pay_chargeback',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce({ id: 'pg_2' } as never);
    vi.mocked(prisma.pagamento.update).mockResolvedValueOnce({ id: 'pg_2' } as never);
    vi.mocked(prisma.lancamento.findFirst).mockResolvedValueOnce({
      id: 'lan_2',
      valor: 95,
      descricao: 'Pagamento confirmado (c2)',
      referencia: 'pagamento:pay_chargeback',
      formaPagamento: 'BOLETO',
      tipo: 'RECEITA',
      origem: 'SISTEMA',
      status: 'RECEBIDO',
      externalRef: 'asaas:payment:pay_chargeback',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CHARGEBACK_REQUESTED',
      payment: {
        id: 'pay_chargeback',
        status: 'CHARGEBACK_REQUESTED',
        value: 100,
        netValue: 95,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.pagamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pg_2' },
        data: { status: 'ESTORNADO' },
      }),
    );
    expect(prisma.lancamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lan_2' },
        data: expect.objectContaining({ status: 'ESTORNADO' }),
      }),
    );
  });
});
