import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePaymentWebhook } from '../payment-webhook-handler';
import { fulfillReservedSaleOnPayment } from '../../use-cases/store-inventory';

const {
  mockUpdateFinanceStatusFromPayment,
  mockResolvePaymentToLocalEntity,
  mockConfirmPaymentCommandsByProviderEvent,
  mockEnsureAcademicChargeForCobranca,
  mockProjectAcademicEnrollmentFeeState,
  mockProjectFamilyEnrollmentFeeState,
  mockUpsertFinanceReconciliationIssue,
  mockLinkSaleToFirstInstallmentCharge,
  mockConfirmEventMapOrderPayment,
  mockReconcileEventMapOrder,
  mockSyncEventMapOrderPaymentCreated,
  mockRefundEventMapOrder,
  mockMarkEventMapRefundProcessing,
  mockCancelEventMapOrder,
  mockRefundTicketSales,
} = vi.hoisted(() => ({
  mockUpdateFinanceStatusFromPayment: vi.fn(async () => ({ success: true })),
  mockResolvePaymentToLocalEntity: vi.fn(async () => ({ type: 'not_found', reason: 'test_default' })),
  mockConfirmPaymentCommandsByProviderEvent: vi.fn(async () => ({ confirmed: 0 })),
  mockEnsureAcademicChargeForCobranca: vi.fn(async () => ({ id: 'charge_academic_mock', cobrancaId: 'c_mock' })),
  mockProjectAcademicEnrollmentFeeState: vi.fn(async () => ({ projected: true })),
  mockProjectFamilyEnrollmentFeeState: vi.fn(async () => ({ projected: true })),
  mockUpsertFinanceReconciliationIssue: vi.fn(async () => ({ id: 'issue-1' })),
  mockLinkSaleToFirstInstallmentCharge: vi.fn(async () => null),
  mockConfirmEventMapOrderPayment: vi.fn(async () => null),
  mockReconcileEventMapOrder: vi.fn(async () => null),
  mockSyncEventMapOrderPaymentCreated: vi.fn(async () => null),
  mockRefundEventMapOrder: vi.fn(async () => null),
  mockMarkEventMapRefundProcessing: vi.fn(async () => null),
  mockCancelEventMapOrder: vi.fn(async () => null),
  mockRefundTicketSales: vi.fn(async () => null),
}));

vi.mock('../../events/refund-event-ticket-sales-by-payment', () => ({
  refundEventTicketSalesByPayment: mockRefundTicketSales,
}));

vi.mock('../../events/confirm-public-event-map-order-payment', () => ({
  confirmPublicEventMapOrderPayment: mockConfirmEventMapOrderPayment,
}));

vi.mock('../../events/event-map-payment-transitions', () => ({
  cancelPublicEventMapOrderByPayment: mockCancelEventMapOrder,
  markPublicEventMapOrderRefundProcessingByPayment: mockMarkEventMapRefundProcessing,
  reconcileEventMapOrderFinancialStateFromAsaas: mockReconcileEventMapOrder,
  refundPublicEventMapOrderByPayment: mockRefundEventMapOrder,
  syncPublicEventMapOrderPaymentCreated: mockSyncEventMapOrderPaymentCreated,
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
  confirmPaymentCommandsByProviderEvent: mockConfirmPaymentCommandsByProviderEvent,
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
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
    eventMapOrder: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
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
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValue([]);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'not_found', reason: 'test_default' });
    mockConfirmPaymentCommandsByProviderEvent.mockResolvedValue({ confirmed: 0 });
    mockEnsureAcademicChargeForCobranca.mockResolvedValue({ id: 'charge_academic_mock', cobrancaId: 'c_mock' });
    mockProjectAcademicEnrollmentFeeState.mockResolvedValue({ projected: true });
    mockProjectFamilyEnrollmentFeeState.mockResolvedValue({ projected: true });
    mockUpsertFinanceReconciliationIssue.mockResolvedValue({ id: 'issue-1' });
    mockLinkSaleToFirstInstallmentCharge.mockResolvedValue(null);
    mockConfirmEventMapOrderPayment.mockResolvedValue(null);
    mockReconcileEventMapOrder.mockResolvedValue(null);
    mockSyncEventMapOrderPaymentCreated.mockResolvedValue(null);
    mockRefundEventMapOrder.mockResolvedValue(null);
    mockMarkEventMapRefundProcessing.mockResolvedValue(null);
    mockCancelEventMapOrder.mockResolvedValue(null);
    mockRefundTicketSales.mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: (_tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValue(null as never);
    vi.mocked(prisma.financePaymentStateTransition.create).mockResolvedValue({ id: 'state-transition-1' } as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
  });

  it('observa pagamento de assinatura externa sem criar vínculos ou issues locais', async () => {
    const { prisma } = await import('@alusa/database');
    mockResolvePaymentToLocalEntity.mockResolvedValue({
      type: 'external', resourceType: 'SUBSCRIPTION', asaasId: 'sub-external',
    });
    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay-external', status: 'RECEIVED', value: 100, subscription: 'sub-external' },
    });
    expect(result).toEqual({ success: true });
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).not.toHaveBeenCalled();
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

  it('consome a cobrança resolvida pelo resolver dentro da conta autenticada', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');

    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'cobranca', cobrancaId: 'cobranca-a' });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cobranca-a',
      matriculaId: 'matricula-a',
      status: 'PENDENTE',
      asaasPaymentId: 'pay-a',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pagamento-a' } as never);

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay-a', status: 'CONFIRMED', value: 100, netValue: 95 },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
        asaasPaymentId: 'pay-a',
      },
    }));
    expect(prisma.pagamento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cobrancaId: 'cobranca-a', asaasPaymentId: 'pay-a' }),
    }));
    expect(mockUpsertFinanceReconciliationIssue).not.toHaveBeenCalledWith(expect.objectContaining({
      issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('processa cobrança V2 encontrada pelo payment ID com policy determinística desabilitada', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');

    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(false);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'cobranca', cobrancaId: 'cobranca-v2-a' });
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cobranca-v2-a',
      matriculaId: 'mat-a',
      status: 'PENDENTE',
      asaasPaymentId: 'pay-v2-a',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pagamento-v2-a' } as never);

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay-v2-a',
        status: 'CONFIRMED',
        value: 120,
        externalReference: 'alusa:subscription:mat-a:plan-a',
        subscription: 'asaas-subscription-a',
      },
    });

    expect(result.success).toBe(true);
    expect(mockResolvePaymentToLocalEntity).toHaveBeenCalledTimes(1);
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
        asaasPaymentId: 'pay-v2-a',
      },
    }));
    expect(prisma.pagamento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cobrancaId: 'cobranca-v2-a', asaasPaymentId: 'pay-v2-a' }),
    }));
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
  });

  it('mantém referência V2 de assinatura sem cobrança única em reconciliação', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');

    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValue({
      type: 'not_found',
      reason: 'subscription_reference_without_unique_charge',
    });

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-subscription-ambiguous',
        status: 'PENDING',
        value: 120,
        dueDate: '2026-08-15',
        subscription: 'asaas-subscription-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a',
      asaasId: 'pay-subscription-ambiguous',
      issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('não usa fallback legado quando referência V2 não tem cobrança, mesmo se resolver acha Subscription', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');

    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValue({
      type: 'subscription',
      subscriptionId: 'subscription-without-charge',
      cobrancaId: undefined,
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-subscription-without-charge',
        status: 'PENDING',
        value: 120,
        dueDate: '2026-08-15',
        subscription: 'asaas-subscription-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
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
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
      id: 'cobranca_legacy',
      matriculaId: 'mat_legacy',
      status: 'PENDENTE',
      asaasPaymentId: null,
      asaasId: null,
      asaasStatus: null,
      providerStatus: null,
      version: 1,
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
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'cobranca_legacy',
        contaId: 'conta-1',
        matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
      },
    }));
    expect(prisma.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cobranca_legacy', contaId: 'conta-1', asaasPaymentId: null,
        asaasId: null, status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      },
      data: { asaasPaymentId: 'pay_taxa_legacy' },
    });
    expect(prisma.cobranca.update).toHaveBeenCalledWith(
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

  it.each(['PENDENTE', 'A_VENCER', 'ATRASADO'] as const)(
    'associa uma única mensalidade aberta %s com vencimento UTC exato', async (status) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'matricula-a',
      contaId: 'conta-1',
      aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
      id: 'cobranca-exata',
      matriculaId: 'matricula-a',
      status,
      asaasPaymentId: null,
      asaasId: null,
      asaasStatus: null,
      providerStatus: null,
      version: 1,
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    }] as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValue({ id: 'pagamento-exato' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-exato',
        status: 'PENDING',
        value: 75,
        subscription: 'sub-exato',
        dueDate: '2026-04-05',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1',
        matriculaId: 'matricula-a',
        vencimento: {
          gte: new Date('2026-04-05T00:00:00.000Z'),
          lt: new Date('2026-04-06T00:00:00.000Z'),
        },
      }),
      take: 2,
    }));
    expect(prisma.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cobranca-exata', contaId: 'conta-1', asaasPaymentId: null,
        asaasId: null, status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      },
      data: { asaasPaymentId: 'pay-exato' },
    });
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    },
  );

  it('permite retry idêntico quando o compare-and-set perdeu para o mesmo payment ID', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'cobranca-exata',
        matriculaId: 'matricula-a',
        status: 'PENDENTE',
        asaasPaymentId: 'pay-idempotent',
        asaasId: null,
        asaasStatus: 'PENDING',
        providerStatus: 'PENDING',
        version: 1,
        tipo: 'MENSALIDADE',
        formaPagamento: 'BOLETO',
      } as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'matricula-a', contaId: 'conta-1', aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
      id: 'cobranca-exata', matriculaId: 'matricula-a', status: 'PENDENTE',
      asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
      version: 1, tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
    }] as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValue({ id: 'pagamento-retry' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay-idempotent', status: 'CONFIRMED', value: 75, subscription: 'sub-a', dueDate: '2026-04-05' },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'cobranca-exata', contaId: 'conta-1', asaasPaymentId: null, asaasId: null,
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      }),
    }));
    expect(prisma.cobranca.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1', id: 'cobranca-exata', OR: [{ asaasPaymentId: 'pay-idempotent' }, { asaasId: 'pay-idempotent' }] },
    }));
    expect(prisma.pagamento.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cobrancaId: 'cobranca-exata', asaasPaymentId: 'pay-idempotent' }),
    }));
  });

  it('envia para reconciliação quando compare-and-set encontra outro payment ID', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'matricula-a', contaId: 'conta-1', aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
      id: 'cobranca-exata', matriculaId: 'matricula-a', status: 'PENDENTE',
      asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
      version: 1, tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
    }] as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay-racer-b', status: 'PENDING', value: 75, subscription: 'sub-a', dueDate: '2026-04-05' },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.cobranca.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-racer-b', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('reconcilia segundo payment da mesma assinatura após o ciclo já estar vinculado', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValue({
      id: 'matricula-a', contaId: 'conta-1', aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany)
      .mockResolvedValueOnce([{
        id: 'cobranca-ciclo', matriculaId: 'matricula-a', status: 'PENDENTE',
        asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
        version: 1, tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
      }] as never)
      .mockResolvedValueOnce([{
        id: 'cobranca-ciclo', matriculaId: 'matricula-a', status: 'PENDENTE',
        asaasPaymentId: 'pay-cycle-first', asaasId: null, asaasStatus: 'PENDING', providerStatus: 'PENDING',
        version: 2, tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
      }] as never);

    const first = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay-cycle-first', status: 'PENDING', value: 75, subscription: 'sub-a', dueDate: '2026-04-05' },
    });
    const second = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay-cycle-second', status: 'PENDING', value: 75, subscription: 'sub-a', dueDate: '2026-04-05' },
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.cobranca.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-cycle-second', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it.each([
    { field: 'asaasPaymentId', mappedId: 'pay-already-linked' },
    { field: 'asaasId', mappedId: 'pay-already-legacy-linked' },
  ])('não processa cobrança já associada a outro payment por $field', async ({ field, mappedId }) => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'cobranca', cobrancaId: 'cobranca-conflict' });
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cobranca-conflict', matriculaId: 'matricula-a', status: 'PENDENTE',
      asaasPaymentId: field === 'asaasPaymentId' ? mappedId : null,
      asaasId: field === 'asaasId' ? mappedId : null,
      asaasStatus: 'PENDING', providerStatus: 'PENDING', version: 1,
      tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay-webhook-conflict', status: 'CONFIRMED', value: 75, externalReference: 'charge:cobranca-conflict' },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-webhook-conflict', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('bloqueia conflito global retornado pelo resolver mesmo com policy determinística desligada', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(false);
    mockResolvePaymentToLocalEntity.mockResolvedValue({
      type: 'conflict', reason: 'payment_id_mapped_to_different_entity',
    });
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay-global-conflict', status: 'CONFIRMED', value: 75,
        externalReference: 'alusa:subscription:matricula-b:plan-b',
      },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-global-conflict', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(prisma.charge.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
  });

  it('reconcilia referência V2 sem mensalidade antes de confirmar comando ou materializar Charge', async () => {
    const { prisma } = await import('@alusa/database');
    mockResolvePaymentToLocalEntity.mockResolvedValue({
      type: 'not_found', reason: 'subscription_reference_without_unique_charge',
    });
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
      id: 'charge-standalone-existing', cobrancaId: null,
    }] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-standalone-reused', status: 'RECEIVED', value: 80,
        dueDate: '2026-08-15', subscription: 'asaas-sub-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
    expect(prisma.charge.update).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-standalone-reused', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it.each([null, 'cobranca-de-outra-assinatura'])(
    'reconcilia sem mutar Cobranca V2 quando Charge global já existe com cobrancaId=%s',
    async (existingCobrancaId) => {
      const { prisma } = await import('@alusa/database');
      const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
      vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(false);
      mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'not_found', reason: 'test_default' });
      vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-payment-reused', cobrancaId: existingCobrancaId,
      }] as never);
      mockResolvePaymentToLocalEntity.mockResolvedValue({
        type: 'conflict', reason: 'payment_id_mapped_to_different_entity',
      });
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
        id: 'mat-a', contaId: 'conta-a', aluno: { contaId: 'conta-a' },
      } as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
        id: 'cobranca-v2', matriculaId: 'mat-a', status: 'PENDENTE',
        asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
        version: 1, tipo: 'MENSALIDADE', formaPagamento: 'BOLETO',
      }] as never);

      const result = await handlePaymentWebhook('conta-a', {
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay-payment-reused', status: 'CONFIRMED', value: 100,
          subscription: 'asaas-sub-a', dueDate: '2026-08-15',
          externalReference: 'alusa:subscription:mat-a:plan-a',
        },
      });

      expect(result).toMatchObject({
        success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
      });
      expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
      expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
      expect(prisma.cobranca.update).not.toHaveBeenCalled();
      expect(prisma.cobranca.create).not.toHaveBeenCalled();
      expect(prisma.pagamento.create).not.toHaveBeenCalled();
      expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
      expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-a', asaasId: 'pay-payment-reused', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
      }));
    },
  );

  it('reconcilia cobrança manual PAGO resolvida por referência sem reivindicá-la', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValue({ type: 'cobranca', cobrancaId: 'cobranca-manual-paga' });
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: 'cobranca-manual-paga', matriculaId: 'matricula-a', status: 'PAGO',
        asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
        version: 1, tipo: 'MENSALIDADE', formaPagamento: 'PIX',
      } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay-for-manual-charge', status: 'CONFIRMED', value: 90,
        externalReference: 'charge:cobranca-manual-paga',
      },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cobranca-manual-paga', contaId: 'conta-1', asaasPaymentId: null,
        asaasId: null, status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      },
      data: { asaasPaymentId: 'pay-for-manual-charge' },
    });
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-for-manual-charge', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it.each([
    { label: 'com vencimento ausente', dueDate: undefined, shouldSearch: false, candidates: [{ id: 'cob-a' }] },
    { label: 'com vencimento inválido', dueDate: '2026-02-30', shouldSearch: false, candidates: [{ id: 'cob-a' }] },
    { label: 'com mensalidades ambíguas na data exata', dueDate: '2026-04-05', shouldSearch: true, candidates: [{ id: 'cob-a' }, { id: 'cob-b' }] },
  ])('mantém cobrança de assinatura em reconciliação $label', async ({ dueDate, shouldSearch, candidates }) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'matricula-a',
      contaId: 'conta-1',
      aluno: { contaId: 'conta-1' },
    } as never);
    if (shouldSearch) {
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce(candidates as never);
    }

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-unmatched-subscription',
        status: 'PENDING',
        value: 75,
        subscription: 'sub-unmatched',
        ...(dueDate ? { dueDate } : {}),
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    if (!shouldSearch) expect(prisma.cobranca.findMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.update).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      asaasId: 'pay-unmatched-subscription',
      issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('cria cobrança apenas quando não existe mensalidade local no ciclo exato', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1',
      contaId: 'conta-1',
      aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'sub_local_1',
      externalReference: 'subscription:matricula:m1',
      matriculaId: 'm1',
      matricula: {
        id: 'm1',
        contaId: 'conta-1',
        aluno: { contaId: 'conta-1' },
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
    expect(prisma.matricula.findFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        aluno: { contaId: 'conta-1' },
        asaasSubscriptionId: 'sub_asaas_1',
      },
      select: { id: true, contaId: true, aluno: { select: { contaId: true } } },
    });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-1',
        asaasSubscriptionId: 'sub_asaas_1',
        matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
      },
      select: expect.objectContaining({
        matricula: expect.objectContaining({
          select: expect.objectContaining({
            contaId: true,
            aluno: { select: { contaId: true } },
          }),
        }),
      }),
    }));
    expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contaId: 'conta-1',
        matriculaId: 'm1',
        matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        tipo: 'MENSALIDADE',
        vencimento: {
          gte: new Date('2026-04-05T00:00:00.000Z'),
          lt: new Date('2026-04-06T00:00:00.000Z'),
        },
      }),
      take: 2,
    }));
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

  it('reconcilia ciclo que já tem mensalidade manual paga e não cria outra cobrança', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'm1', contaId: 'conta-1', aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany)
      .mockResolvedValueOnce([{
        id: 'cob-manual-paid', matriculaId: 'm1', status: 'PAGO',
        asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
        version: 2, tipo: 'MENSALIDADE', formaPagamento: 'PIX',
      }] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay-after-manual', status: 'PENDING', value: 75, subscription: 'sub-asaas-1', dueDate: '2026-04-05' },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-after-manual', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('reconcilia mensalidade manual PAGO no ciclo exato sem criar cobrança duplicada', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({
      id: 'matricula-a', contaId: 'conta-1', aluno: { contaId: 'conta-1' },
    } as never);
    vi.mocked(prisma.cobranca.findMany)
      .mockResolvedValueOnce([{
        id: 'cobranca-manual-paga', matriculaId: 'matricula-a', status: 'PAGO',
        asaasPaymentId: null, asaasId: null, asaasStatus: null, providerStatus: null,
        version: 1, tipo: 'MENSALIDADE', formaPagamento: 'PIX',
      }] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-cycle-manual', status: 'PENDING', value: 75,
        subscription: 'sub-a', dueDate: '2026-04-05',
      },
    });

    expect(result).toMatchObject({
      success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.pagamento.create).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-cycle-manual', issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('não materializa cobrança quando Subscription aponta para matrícula de outro tenant', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'subscription-a',
      externalReference: 'subscription:matricula-b',
      matriculaId: 'matricula-b',
      matricula: {
        id: 'matricula-b',
        contaId: 'conta-b',
        aluno: { contaId: 'conta-b' },
        alunoId: 'aluno-b',
        responsavelFinanceiroId: null,
        planoId: 'plano-b',
        comboId: null,
        vencimentoDia: 5,
        plano: { id: 'plano-b', nome: 'Plano B', valor: 75 },
        combo: null,
      },
    } as never);

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-cross-tenant-subscription',
        status: 'PENDING',
        value: 75,
        subscription: 'sub-asaas-a',
        dueDate: '2026-04-05',
        externalReference: 'subscription:matricula-b',
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        asaasSubscriptionId: 'sub-asaas-a',
        matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
      },
    }));
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.standaloneSubscription.findFirst).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a',
      asaasId: 'pay-cross-tenant-subscription',
      issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
  });

  it('não materializa cobrança de InstallmentPlan ligado à matrícula de outro tenant', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'installment-plan-a',
      externalReference: 'installmentPlan:matricula-b',
      matriculaId: 'matricula-b',
      installmentCount: 10,
      value: 90,
      matricula: {
        id: 'matricula-b',
        contaId: 'conta-b',
        aluno: { contaId: 'conta-b' },
        alunoId: 'aluno-b',
        responsavelFinanceiroId: null,
        planoId: 'plano-b',
        comboId: null,
        plano: { id: 'plano-b', nome: 'Plano B' },
        combo: null,
      },
    } as never);

    const result = await handlePaymentWebhook('conta-a', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay-cross-tenant-installment',
        status: 'PENDING',
        value: 90,
        installment: 'asaas-installment-a',
        installmentNumber: 1,
        dueDate: '2026-04-05',
      },
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION',
    });
    expect(prisma.installmentPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        asaasInstallmentId: 'asaas-installment-a',
        matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
      },
      select: expect.objectContaining({
        matricula: expect.objectContaining({
          select: expect.objectContaining({
            contaId: true,
            aluno: { select: { contaId: true } },
          }),
        }),
      }),
    }));
    expect(prisma.cobranca.create).not.toHaveBeenCalled();
    expect(prisma.charge.upsert).not.toHaveBeenCalled();
    expect(prisma.standaloneInstallmentPlan.findFirst).not.toHaveBeenCalled();
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a',
      asaasId: 'pay-cross-tenant-installment',
      issueType: 'PAYMENT_MISSING_LOCAL_ENTITY',
    }));
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

  it('preserva o pagador explícito da charge quando o plano legado ainda é ambíguo', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.enrollmentCreationOperation.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findFirst).mockResolvedValueOnce({
      id: 'plan-ambiguous-1',
      externalReference: 'alusa:standalone-installment:plan-ambiguous-1',
      billingType: 'PIX',
      interestValue: null,
      fineValue: null,
      fineType: null,
      discountValue: null,
      discountType: null,
      discountDueDateLimitDays: null,
      customerId: 'customer-shared-1',
      familyGroupId: null,
      payerType: null,
      payerId: null,
    } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'charge-ambiguous-1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay-ambiguous-1',
        status: 'CONFIRMED',
        value: 90,
        netValue: 88,
        installment: 'asaas-installment-ambiguous-1',
        installmentNumber: 1,
        dueDate: '2026-08-01',
        billingType: 'PIX',
      },
    });

    expect(result).toMatchObject({ success: true, stateChanged: true });
    const upsert = vi.mocked(prisma.charge.upsert).mock.calls[0]?.[0];
    expect(upsert?.create).toEqual(expect.objectContaining({
      payerType: null,
      payerId: null,
    }));
    expect(upsert?.update).not.toHaveProperty('payerType');
    expect(upsert?.update).not.toHaveProperty('payerId');
  });

  it('deve atualizar charge standalone por asaasPaymentId mesmo sem externalReference', async () => {
    const { prisma } = await import('@alusa/database');
    const { sharedTelemetry } = await import('@alusa/observability');
    const metrics: Array<{ name: string; dimensions?: Record<string, unknown> }> = [];
    const restoreTelemetry = sharedTelemetry.replaceSink({
      metric: (metric) => metrics.push(metric),
    });
    const successLog = vi.spyOn(console, 'log');

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
    expect(metrics).toContainEqual({
      kind: 'counter',
      name: 'finance.payment_webhook.operation',
      value: 1,
      dimensions: {
        provider: 'asaas',
        'operation.name': 'standalone_charge_updated',
      },
    });
    expect(successLog).not.toHaveBeenCalled();
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
    restoreTelemetry();
    successLog.mockRestore();
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
        clientPaymentDate: '2026-06-20',
        billingType: 'RECEIVED_IN_CASH',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_cash_1' },
        data: expect.objectContaining({
          status: 'PAID',
          paidAt: new Date('2026-06-20'),
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
        data: expect.objectContaining({ status: 'OVERDUE', paidAt: null }),
      }),
    );
  });

  it('não inventa paidAt quando o webhook confirmado não informa data de pagamento', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_no_date',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_no_date',
      paidAt: null,
    } as never);
    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_no_date', status: 'PAID' } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_no_date',
        status: 'CONFIRMED',
        value: 150,
        netValue: 150,
      },
    });

    const call = vi.mocked(prisma.charge.update).mock.calls[0]?.[0];
    expect(call?.data).not.toHaveProperty('paidAt');
  });

  it('usa paymentDate como fallback quando clientPaymentDate não foi informado', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_payment_date',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_payment_date',
      paidAt: null,
    } as never);
    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_payment_date', status: 'PAID' } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_payment_date',
        status: 'CONFIRMED',
        value: 150,
        netValue: 150,
        paymentDate: '2026-06-21',
      },
    });

    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_payment_date' },
        data: expect.objectContaining({ paidAt: new Date('2026-06-21') }),
      }),
    );
  });

  it('preserva o primeiro paidAt canônico em retries confirmados', async () => {
    const { prisma } = await import('@alusa/database');
    const originalPaidAt = new Date('2026-06-20T00:00:00.000Z');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_retry',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_retry',
      paidAt: originalPaidAt,
    } as never);
    vi.mocked(prisma.charge.update).mockResolvedValueOnce({ id: 'ch_retry', status: 'PAID' } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_retry',
        status: 'CONFIRMED',
        value: 150,
        netValue: 150,
        paymentDate: '2026-06-21',
      },
    });

    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_retry' },
        data: expect.objectContaining({ paidAt: originalPaidAt }),
      }),
    );
  });

  it('preserva paidAt depois de CONFIRMED repetido com outra data', async () => {
    const { prisma } = await import('@alusa/database');
    const canonicalPaidAt = new Date('2026-06-20T00:00:00.000Z');
    vi.mocked(prisma.charge.findFirst)
      .mockResolvedValueOnce({
        id: 'ch_repeated_confirmation',
        cobrancaId: null,
        status: 'OPEN',
        asaasPaymentId: 'pay_repeated_confirmation',
        paidAt: null,
        asaasStatus: 'PENDING',
      } as never)
      .mockResolvedValueOnce({
        id: 'ch_repeated_confirmation',
        cobrancaId: null,
        status: 'PAID',
        asaasPaymentId: 'pay_repeated_confirmation',
        paidAt: canonicalPaidAt,
        asaasStatus: 'CONFIRMED',
      } as never);
    vi.mocked(prisma.charge.update).mockResolvedValue({ status: 'PAID' } as never);

    for (const paymentDate of ['2026-06-20', '2026-06-21']) {
      await handlePaymentWebhook('conta-1', {
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_repeated_confirmation',
          status: 'CONFIRMED',
          value: 150,
          netValue: 150,
          paymentDate,
        },
      });
    }

    const updates = vi.mocked(prisma.charge.update).mock.calls.map(([call]) => call.data);
    expect(updates[0]).toEqual(expect.objectContaining({ paidAt: canonicalPaidAt }));
    expect(updates[1]).not.toHaveProperty('paidAt');
  });

  it('não deixa evento de undo atrasado regredir confirmação mais nova no snapshot', async () => {
    const { prisma } = await import('@alusa/database');
    const canonicalPaidAt = new Date('2026-06-20T00:00:00.000Z');
    vi.mocked(prisma.charge.findFirst)
      .mockResolvedValueOnce({
        id: 'ch_late_undo',
        cobrancaId: null,
        status: 'OPEN',
        asaasPaymentId: 'pay_late_undo',
        paidAt: null,
        asaasStatus: 'PENDING',
      } as never)
      .mockResolvedValueOnce({
        id: 'ch_late_undo',
        cobrancaId: null,
        status: 'PAID',
        asaasPaymentId: 'pay_late_undo',
        paidAt: canonicalPaidAt,
        asaasStatus: 'RECEIVED_IN_CASH',
      } as never);
    vi.mocked(prisma.charge.update).mockResolvedValue({ status: 'PAID' } as never);

    await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_late_undo',
        status: 'RECEIVED_IN_CASH',
        value: 150,
        netValue: 150,
        paymentDate: '2026-06-20',
      },
    });
    const lateUndo = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      payment: {
        id: 'pay_late_undo',
        status: 'RECEIVED_IN_CASH',
        value: 150,
        netValue: 150,
      },
    });

    expect(lateUndo.stateChanged).toBe(false);
    const updates = vi.mocked(prisma.charge.update).mock.calls.map(([call]) => call.data);
    expect(updates[0]).toEqual(expect.objectContaining({ status: 'PAID', paidAt: canonicalPaidAt }));
    expect(updates[1]).not.toHaveProperty('paidAt');
    expect(updates[1]).toEqual(expect.objectContaining({ status: 'PAID' }));
  });

  it('limpa paidAt também ao desfazer recebimento de cobrança acadêmica', async () => {
    const { prisma } = await import('@alusa/database');
    const { isPaymentResolutionPolicyEnabled } = await import('../../foundation/payment-resolution-policy');
    vi.mocked(isPaymentResolutionPolicyEnabled).mockReturnValue(true);
    mockResolvePaymentToLocalEntity.mockResolvedValueOnce({
      type: 'charge',
      chargeId: 'charge_academic_undo',
      cobrancaId: 'c_academic_undo',
    });
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'charge_academic_undo',
      cobrancaId: 'c_academic_undo',
      status: 'PAID',
      asaasPaymentId: 'pay_academic_undo',
      paidAt: new Date('2026-06-20T00:00:00.000Z'),
      asaasStatus: 'RECEIVED_IN_CASH',
    } as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c_academic_undo',
      matriculaId: 'm_academic_undo',
      status: 'PAGO',
      asaasPaymentId: 'pay_academic_undo',
      tipo: 'MENSALIDADE',
      formaPagamento: 'RECEIVED_IN_CASH',
    } as never);
    vi.mocked(prisma.charge.update).mockResolvedValue({} as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      payment: {
        id: 'pay_academic_undo',
        status: 'OVERDUE',
        value: 150,
        netValue: 150,
        billingType: 'RECEIVED_IN_CASH',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c_academic_undo' },
        data: expect.objectContaining({ dataPagamento: null, pagoEm: null }),
      }),
    );
    expect(prisma.charge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'charge_academic_undo' },
        data: expect.objectContaining({ paidAt: null }),
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

  it('retorna falha para retry da inbox quando confirmação e reconciliação do pedido de assentos falham', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({ id: 'order-1', asaasPaymentId: null } as never);
    const sensitiveDiagnostic = 'DB unavailable token=sk_live_secret paymentId=pay_secret contaId=tenant_secret';
    mockConfirmEventMapOrderPayment.mockRejectedValueOnce(new Error('DB write failed token=sk_live_other'));
    mockReconcileEventMapOrder.mockRejectedValueOnce(new Error(sensitiveDiagnostic));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_event_map',
        status: 'RECEIVED',
        value: 60,
        netValue: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(mockConfirmEventMapOrderPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_event_map',
        externalReference: 'event-map-order:order-1',
        allowReleasedReservation: true,
      }),
    );
    expect(mockReconcileEventMapOrder).toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: sensitiveDiagnostic });
    const emittedLogs = [...consoleWarn.mock.calls, ...consoleError.mock.calls].flat().join(' ');
    expect(emittedLogs).toContain('finance.payment_webhook.public_order_confirmation.failed');
    expect(emittedLogs).toContain('finance.payment_webhook.processing.failed');
    expect(emittedLogs).toContain('"error.type":"error"');
    expect(emittedLogs).not.toContain('pay_event_map');
    expect(emittedLogs).not.toContain('paymentId');
    expect(emittedLogs).not.toContain('contaId');
    expect(emittedLogs).not.toContain('sk_live');
    expect(emittedLogs).not.toContain('DB unavailable');
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('registra issue e pede retry antes de qualquer efeito quando referência Event Map ainda não tem pedido local', async () => {
    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-event-map-order-race', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-being-created',
      },
    });

    expect(result).toMatchObject({ success: false, error: 'EVENT_MAP_ORDER_PAYMENT_REFERENCE_NOT_FOUND' });
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-event-map-order-race',
      metadata: expect.objectContaining({ reason: 'event_map_order_reference_not_found' }),
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).not.toHaveBeenCalled();
    expect(mockCancelEventMapOrder).not.toHaveBeenCalled();
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
    expect(fulfillReservedSaleOnPayment).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'Charge standalone', resolution: { type: 'charge', chargeId: 'charge-a' } },
    { label: 'cobrança acadêmica', resolution: { type: 'cobranca', cobrancaId: 'cobranca-a' } },
  ])('bloqueia referência Event Map vinculada a $label antes de qualquer efeito', async ({ resolution }) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({ id: 'order-1', asaasPaymentId: null } as never);
    mockResolvePaymentToLocalEntity.mockResolvedValueOnce(resolution as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-event-map-conflict',
        status: 'RECEIVED',
        value: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result).toMatchObject({ success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION' });
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-event-map-conflict',
      metadata: expect.objectContaining({ reason: 'event_map_payment_mapping_conflict' }),
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
  });

  it('bloqueia pedido Event Map já ligado a outro payment antes de confirmar comandos ou pagamento', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', asaasPaymentId: 'pay-already-bound',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-new', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result).toMatchObject({ success: true, skipped: true });
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
  });

  it('reconcilia sem efeitos quando payment ligado ao pedido A aponta para pedido Event Map B', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockImplementation(async (args: never) => {
      const query = args as unknown as { where?: { id?: string } };
      return (query.where?.id === 'order-B' ? { id: 'order-B', asaasPaymentId: null } : null) as never;
    });
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValue([
      { id: 'order-A', asaasPaymentId: 'pay-bound-A' },
    ] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-bound-A', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-B',
      },
    });

    expect(result).toMatchObject({ success: true, skipped: true });
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-bound-A',
      metadata: expect.objectContaining({ reason: 'event_map_payment_mapping_conflict' }),
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).not.toHaveBeenCalled();
    expect(mockCancelEventMapOrder).not.toHaveBeenCalled();
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'referência de cobrança', externalReference: 'charge:charge-B', resolution: { type: 'cobranca', cobrancaId: 'cobranca-B' } },
    { label: 'referência standalone', externalReference: 'standalone:charge-B', resolution: { type: 'charge', chargeId: 'charge-B' } },
  ])('reconcilia sem efeitos quando payment ligado ao pedido Event Map A aponta para $label', async ({ externalReference, resolution }) => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({ id: 'order-A', asaasPaymentId: 'pay-bound-A' } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValue([
      { id: 'order-A', asaasPaymentId: 'pay-bound-A' },
    ] as never);
    mockResolvePaymentToLocalEntity.mockResolvedValueOnce(resolution as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay-bound-A', status: 'RECEIVED', value: 60, externalReference },
    });

    expect(result).toMatchObject({ success: true, skipped: true });
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-bound-A',
      metadata: expect.objectContaining({ reason: 'event_map_payment_mapping_conflict' }),
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockSyncEventMapOrderPaymentCreated).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).not.toHaveBeenCalled();
    expect(mockCancelEventMapOrder).not.toHaveBeenCalled();
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
  });

  it('mantém o caminho normal para pedido Event Map válido e sem vínculo financeiro conflitante', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValue({
      id: 'order-1', asaasPaymentId: null,
    } as never);
    mockConfirmEventMapOrderPayment.mockResolvedValueOnce({ confirmed: true } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-event-map-valid', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result.success).toBe(true);
    expect(mockConfirmPaymentCommandsByProviderEvent).toHaveBeenCalled();
    expect(mockConfirmEventMapOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasPaymentId: 'pay-event-map-valid',
      externalReference: 'event-map-order:order-1',
    }));
  });

  it.each(['REQUESTED', 'IN_DISPUTE', 'DISPUTE_LOST', 'DONE'])(
    'prioriza chargeback %s presente em PAYMENT_RECEIVED e não emite ingressos',
    async (chargebackStatus) => {
      const { prisma } = await import('@alusa/database');
      vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
        id: 'order-1', status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-chargeback-mixed', paymentStatus: null,
      } as never);
      vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([] as never);

      const result = await handlePaymentWebhook('conta-1', {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay-chargeback-mixed', status: 'RECEIVED', value: 60,
          externalReference: 'event-map-order:order-1',
          chargeback: { status: chargebackStatus },
        },
      });

      expect(result.success).toBe(true);
      expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
      expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
      expect(mockMarkEventMapRefundProcessing).toHaveBeenCalledWith(expect.objectContaining({
        paymentStatus: chargebackStatus,
      }));
      expect(mockRefundTicketSales).not.toHaveBeenCalled();
    },
  );

  it('bloqueia e audita status de chargeback desconhecido mesmo em PAYMENT_RECEIVED', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-chargeback-unknown', paymentStatus: null,
    } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-chargeback-unknown', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-1',
        chargeback: { status: 'FUTURE_PROVIDER_STATE' },
      },
    });

    expect(result.success).toBe(true);
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).toHaveBeenCalledWith(expect.objectContaining({
      paymentStatus: 'CHARGEBACK_UNKNOWN', rawChargebackStatus: 'FUTURE_PROVIDER_STATE',
    }));
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
  });

  it('emite o pedido após o provedor confirmar a reversão do chargeback', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-chargeback-reversed', paymentStatus: 'IN_DISPUTE',
    } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([] as never);
    mockConfirmEventMapOrderPayment.mockResolvedValueOnce({ confirmed: true } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-chargeback-reversed', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-1',
        chargeback: { status: 'REVERSED' },
      },
    });

    expect(result.success).toBe(true);
    expect(mockConfirmEventMapOrderPayment).toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).toHaveBeenCalledWith(expect.objectContaining({
      paymentStatus: 'REVERSED',
    }));
  });

  it('um PAYMENT_RECEIVED atrasado não libera pedido que já está em disputa', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'PAYMENT_PENDING', asaasPaymentId: 'pay-order-replay', paymentStatus: 'IN_DISPUTE',
    } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay-order-replay', status: 'RECEIVED', value: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result.success).toBe(true);
    expect(mockConfirmEventMapOrderPayment).not.toHaveBeenCalled();
    expect(mockReconcileEventMapOrder).not.toHaveBeenCalled();
    expect(mockMarkEventMapRefundProcessing).not.toHaveBeenCalled();
  });

  it('ignora chargeback e recusa atrasados depois do estorno final', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'REFUNDED', asaasPaymentId: 'pay-already-refunded', paymentStatus: 'REFUNDED',
    } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_REFUND_DENIED',
      payment: {
        id: 'pay-already-refunded', status: 'REFUND_DENIED', value: 60,
        externalReference: 'event-map-order:order-1',
        chargeback: { status: 'DISPUTE_LOST' },
      },
    });

    expect(result.success).toBe(true);
    expect(mockMarkEventMapRefundProcessing).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
  });

  it('não marca o webhook como sucesso quando o pedido ainda não pôde ser reconciliado', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({ id: 'order-1', asaasPaymentId: null } as never);
    mockConfirmEventMapOrderPayment.mockResolvedValueOnce(null);
    mockReconcileEventMapOrder.mockResolvedValueOnce(null);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_event_map',
        status: 'RECEIVED',
        value: 60,
        netValue: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result).toMatchObject({ success: false, error: 'EVENT_MAP_PAID_PAYMENT_REQUIRES_RETRY' });
  });

  it('registra recusa de estorno sem marcar pedido ou venda como estornados', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'CONFIRMED', paymentStatus: 'REFUND_REQUESTED',
      asaasPaymentId: null,
    } as never);
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([
      { id: 'order-1', status: 'CONFIRMED', paymentStatus: 'REFUND_REQUESTED', asaasPaymentId: 'pay_event_map_refund_denied' },
    ] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_REFUND_DENIED',
      payment: {
        id: 'pay_event_map_refund_denied',
        status: 'REFUND_DENIED',
        value: 60,
        netValue: 60,
        externalReference: 'event-map-order:order-1',
      },
    });

    expect(result.success).toBe(true);
    expect(mockMarkEventMapRefundProcessing).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_event_map_refund_denied',
      externalReference: 'event-map-order:order-1',
      paymentStatus: 'REFUND_DENIED',
    });
    expect(mockRefundTicketSales).toHaveBeenCalledWith({
      contaId: 'conta-1',
      paymentId: 'pay_event_map_refund_denied',
      paymentStatus: 'REFUND_DENIED',
      isFinalRefund: false,
    });
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
  });

  it('roteia estorno pelo payment ID Event Map quando externalReference está ausente', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([
      { id: 'order-1', asaasPaymentId: 'pay1' },
    ] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_REFUNDED',
      payment: { id: 'pay1', status: 'REFUNDED', value: 60 },
    });

    expect(result.success).toBe(true);
    expect(prisma.eventMapOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1', asaasPaymentId: 'pay1' },
      take: 2,
    }));
    expect(mockRefundEventMapOrder).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasPaymentId: 'pay1', externalReference: undefined,
    }));
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
  });

  it('reconcilia sem mutações quando payment ID aponta para pedidos Event Map duplicados', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.eventMapOrder.findMany).mockResolvedValueOnce([
      { id: 'order-1', asaasPaymentId: 'pay-duplicate' },
      { id: 'order-2', asaasPaymentId: 'pay-duplicate' },
    ] as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_REFUNDED',
      payment: { id: 'pay-duplicate', status: 'REFUNDED', value: 60 },
    });

    expect(result).toMatchObject({ success: true, skipped: true, skipReason: 'UNMATCHED_PAYMENT_REQUIRES_RECONCILIATION' });
    expect(prisma.eventMapOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'conta-1', asaasPaymentId: 'pay-duplicate' },
      take: 2,
    }));
    expect(mockUpsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasId: 'pay-duplicate',
      metadata: expect.objectContaining({ reason: 'event_map_payment_mapping_conflict' }),
    }));
    expect(mockConfirmPaymentCommandsByProviderEvent).not.toHaveBeenCalled();
    expect(mockRefundEventMapOrder).not.toHaveBeenCalled();
    expect(mockRefundTicketSales).not.toHaveBeenCalled();
    expect(mockUpdateFinanceStatusFromPayment).not.toHaveBeenCalled();
  });
});
