import { describe, expect, it, vi } from 'vitest';

import {
  compensateStagedEnrollmentFinancialResources,
  stageEnrollmentFinancialResources,
  type StageEnrollmentFinancialResourcesInput,
} from '../stage-enrollment-financial-resources';

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_remote_1',
    customer: 'cus_1',
    billingType: 'BOLETO',
    cycle: 'MONTHLY',
    value: 150,
    nextDueDate: '2026-09-05',
    endDate: '2027-08-05',
    externalReference: 'enrollment-op:operation-1:subscription',
    status: 'ACTIVE',
    deleted: false,
    ...overrides,
  };
}

function paymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_monthly_1',
    customer: 'cus_1',
    subscription: 'sub_remote_1',
    billingType: 'BOLETO',
    value: 150,
    netValue: 147,
    dueDate: '2026-08-05',
    externalReference: null,
    status: 'PENDING',
    deleted: false,
    invoiceUrl: 'https://example.test/invoice',
    bankSlipUrl: 'https://example.test/bank-slip',
    ...overrides,
  };
}

function request(overrides: Partial<StageEnrollmentFinancialResourcesInput> = {}) {
  return {
    contaId: 'conta-1',
    operationId: 'operation-1',
    idempotencyKey: 'ui-request-1',
    payer: { type: 'RESPONSAVEL' as const, id: 'responsavel-1' },
    subscription: {
      value: 150,
      nextDueDate: '2026-08-05',
      billingType: 'BOLETO' as const,
      cycle: 'MONTHLY' as const,
      endDate: '2027-08-05',
      description: 'Mensalidade',
    },
    confirmationAttempts: 1,
    confirmationDelayMs: 0,
    ...overrides,
  } satisfies StageEnrollmentFinancialResourcesInput;
}

function dependencies() {
  return {
    ensureCustomer: vi.fn(async () => ({
      success: true as const,
      data: {
        customerId: 'cus_1',
        localCustomerId: 'customer-local-1',
        externalReference: 'customer:conta-1:RESPONSAVEL:responsavel-1',
      },
    })),
    requireKycApproved: vi.fn(async () => ({ success: true as const, data: undefined })),
    assertAsaasTenantOperational: vi.fn(async () => undefined),
    ensureWebhookConfigOperational: vi.fn(async () => ({ success: true })),
    loadAsaasCredentials: vi.fn(async () => ({ apiKey: 'test-key', source: 'database' as const })),
    createSubscription: vi.fn(async () => subscriptionFixture()),
    createPayment: vi.fn(async () => ({
      success: true as const,
      data: {
        id: 'pay_fee_1',
        externalReference: 'enrollment-op:operation-1:fee',
      },
    })),
    getSubscription: vi.fn(async () => subscriptionFixture()),
    listSubscriptions: vi.fn(async () => ({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 10,
      offset: 0,
      data: [],
    })),
    getPayment: vi.fn(async (paymentId: string) =>
      paymentId === 'pay_fee_1'
        ? paymentFixture({
            id: 'pay_fee_1',
            subscription: null,
            value: 75,
            dueDate: '2026-08-01',
            externalReference: 'enrollment-op:operation-1:fee',
          })
        : paymentFixture(),
    ),
    listPayments: vi.fn(async (filters: { subscription?: string; externalReference?: string }) => ({
      object: 'list',
      hasMore: false,
      totalCount: filters.subscription ? 1 : 0,
      limit: 20,
      offset: 0,
      data: filters.subscription ? [paymentFixture()] : [],
    })),
    deleteSubscription: vi.fn(async () => subscriptionFixture({ deleted: true })),
    deletePayment: vi.fn(async (paymentId: string) => paymentFixture({ id: paymentId, deleted: true })),
    reserveOperation: vi.fn(async (input: { type: string }) => ({
      job: { id: input.type === 'CREATE_SUBSCRIPTION' ? 'job-sub' : 'job-fee' },
      payload: {
        version: 1 as const,
        state: 'INTENT_CREATED' as const,
        resource: input.type === 'CREATE_SUBSCRIPTION' ? ('SUBSCRIPTION' as const) : ('PAYMENT' as const),
        entityId: 'operation-1',
        externalReference: 'external-ref',
        correlationId: 'correlation-id',
        requestFingerprint: 'fingerprint',
      },
    })),
    markRemoteRequested: vi.fn(async () => true),
    markRemoteConfirmed: vi.fn(async () => ({})),
    markFailed: vi.fn(async () => ({})),
    markResultUnknown: vi.fn(async () => ({})),
    wait: vi.fn(async () => undefined),
  };
}

describe('stageEnrollmentFinancialResources', () => {
  it('aceita nextDueDate remoto avançado quando a primeira mensalidade exata existe', async () => {
    const deps = dependencies();

    const result = await stageEnrollmentFinancialResources(
      request({
        enrollmentFee: {
          value: 75,
          dueDate: '2026-08-01',
          billingType: 'BOLETO',
          description: 'Taxa de matrícula',
        },
      }),
      deps,
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.subscription.asaasSubscriptionId).toBe('sub_remote_1');
    expect(result.data.subscription.firstPayment.asaasPaymentId).toBe('pay_monthly_1');
    expect(result.data.enrollmentFee?.asaasPaymentId).toBe('pay_fee_1');
    expect(deps.createSubscription).toHaveBeenCalledTimes(1);
    expect(deps.createPayment).toHaveBeenCalledTimes(1);
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
  });

  it('compensa a assinatura quando a primeira mensalidade não é confirmada', async () => {
    const deps = dependencies();
    deps.listPayments.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 20,
      offset: 0,
      data: [],
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({
      success: false,
      error: 'FIRST_SUBSCRIPTION_PAYMENT_NOT_CONFIRMED',
      resultUnknown: true,
      compensation: { complete: true, deletedSubscriptionId: 'sub_remote_1' },
    });
    expect(deps.deleteSubscription).toHaveBeenCalledWith('sub_remote_1', {
      contaId: 'conta-1',
    });
  });

  it('compensa quando o Asaas não confirma o término da assinatura', async () => {
    const deps = dependencies();
    deps.getSubscription.mockResolvedValue(subscriptionFixture({ endDate: null }));

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({
      success: false,
      error: 'REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH',
      resultUnknown: true,
    });
    expect(deps.deleteSubscription).toHaveBeenCalledWith('sub_remote_1', {
      contaId: 'conta-1',
    });
  });

  it('remove primeira mensalidade e assinatura quando a taxa falha', async () => {
    const deps = dependencies();
    deps.createPayment.mockResolvedValue({
      success: false as const,
      error: { code: 'RESULT_UNKNOWN' as const, message: 'ASAAS_REJECTED', resultUnknown: true },
    });

    const result = await stageEnrollmentFinancialResources(
      request({
        enrollmentFee: { value: 75, dueDate: '2026-08-01', billingType: 'PIX' },
      }),
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      error: 'ENROLLMENT_FEE_RESULT_UNKNOWN',
      resultUnknown: true,
      compensation: {
        complete: true,
        deletedPaymentIds: ['pay_monthly_1'],
        deletedSubscriptionId: 'sub_remote_1',
      },
    });
    expect(deps.deletePayment).toHaveBeenCalledWith('pay_monthly_1', { contaId: 'conta-1' });
  });

  it('encerra a incerteza quando encontra e remove todos os recursos após resposta perdida', async () => {
    const deps = dependencies();
    deps.createPayment.mockResolvedValue({
      success: false as const,
      error: { code: 'RESULT_UNKNOWN' as const, message: 'ASAAS_REJECTED', resultUnknown: true },
    });
    deps.listPayments.mockImplementation(
      async (filters: { subscription?: string; externalReference?: string }) => ({
        object: 'list',
        hasMore: false,
        totalCount: 1,
        limit: 20,
        offset: 0,
        data: filters.externalReference
          ? [
              paymentFixture({
                id: 'pay_fee_1',
                subscription: null,
                externalReference: 'enrollment-op:operation-1:fee',
              }),
            ]
          : [paymentFixture()],
      }),
    );

    const result = await stageEnrollmentFinancialResources(
      request({ enrollmentFee: { value: 75, dueDate: '2026-08-01', billingType: 'PIX' } }),
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      resultUnknown: false,
      compensation: {
        complete: true,
        deletedSubscriptionId: 'sub_remote_1',
        deletedFirstSubscriptionPaymentId: 'pay_monthly_1',
        deletedEnrollmentFeePaymentId: 'pay_fee_1',
      },
    });
  });

  it('trata rejeição HTTP da taxa como falha conhecida e compensa sem reconciliação', async () => {
    const deps = dependencies();
    deps.createPayment.mockResolvedValue({
      success: false as const,
      error: {
        code: 'PROVIDER_REJECTED' as const,
        message: 'Não é permitido data de vencimento inferior a hoje.',
        resultUnknown: false,
        httpStatus: 400,
      },
    });

    const result = await stageEnrollmentFinancialResources(
      request({ enrollmentFee: { value: 75, dueDate: '2026-08-01', billingType: 'PIX' } }),
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      error: 'ENROLLMENT_FEE_DUE_DATE_INVALID',
      resultUnknown: false,
      compensation: {
        complete: true,
        deletedSubscriptionId: 'sub_remote_1',
        deletedFirstSubscriptionPaymentId: 'pay_monthly_1',
      },
    });
    expect(deps.markFailed).toHaveBeenCalledWith(
      'job-fee',
      'Não é permitido data de vencimento inferior a hoje.',
      expect.objectContaining({ providerHttpStatus: 400 }),
    );
  });

  it('reutiliza recursos remotos encontrados pela referência sem repetir POST', async () => {
    const deps = dependencies();
    deps.listSubscriptions.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 1,
      limit: 10,
      offset: 0,
      data: [subscriptionFixture()],
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result.success).toBe(true);
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.markRemoteRequested).not.toHaveBeenCalled();
  });

  it('compensa assinatura conhecida quando a confirmação remota diverge', async () => {
    const deps = dependencies();
    deps.createSubscription.mockResolvedValue(
      subscriptionFixture({ customer: 'cus_wrong' }),
    );
    deps.getSubscription.mockResolvedValue(
      subscriptionFixture({ customer: 'cus_wrong' }),
    );
    deps.listPayments.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 20,
      offset: 0,
      data: [],
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({
      success: false,
      error: 'REMOTE_SUBSCRIPTION_CONFIRMATION_MISMATCH',
      resultUnknown: true,
      compensation: { complete: true, deletedSubscriptionId: 'sub_remote_1' },
    });
    expect(deps.deleteSubscription).toHaveBeenCalledWith('sub_remote_1', {
      contaId: 'conta-1',
    });
  });

  it('mantém resultado incerto quando a compensação não pode remover a assinatura', async () => {
    const deps = dependencies();
    deps.listPayments.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 20,
      offset: 0,
      data: [],
    });
    deps.deleteSubscription.mockRejectedValue(new Error('provider unavailable'));

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({
      success: false,
      resultUnknown: true,
      compensation: {
        complete: false,
        errors: [{ resource: 'SUBSCRIPTION', id: 'sub_remote_1' }],
      },
    });
  });

  it('não apaga recursos quando outra execução possui o fencing da compensação', async () => {
    const deps = dependencies();
    deps.listPayments.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 20,
      offset: 0,
      data: [],
    });

    const result = await stageEnrollmentFinancialResources(
      request({ claimCompensation: async () => false }),
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      error: 'ENROLLMENT_OPERATION_LEASE_LOST',
      resultUnknown: true,
      compensation: { complete: false },
    });
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.deletePayment).not.toHaveBeenCalled();
  });
});

describe('compensateStagedEnrollmentFinancialResources', () => {
  it('descobre e remove recursos por operationId após perda da resposta HTTP', async () => {
    const deps = dependencies();
    deps.listSubscriptions.mockResolvedValue({
      object: 'list',
      hasMore: false,
      totalCount: 1,
      limit: 10,
      offset: 0,
      data: [subscriptionFixture()],
    });

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', operationId: 'operation-1' },
      deps,
    );

    expect(result).toMatchObject({
      complete: true,
      deletedSubscriptionId: 'sub_remote_1',
      deletedPaymentIds: ['pay_monthly_1'],
    });
  });

  it('trata recurso já removido como compensação idempotente', async () => {
    const deps = dependencies();
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    deps.deletePayment.mockRejectedValue(notFound);
    deps.deleteSubscription.mockRejectedValue(notFound);

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result).toEqual({
      complete: true,
      deletedPaymentIds: ['pay_monthly_1'],
      deletedFirstSubscriptionPaymentId: null,
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: 'sub_remote_1',
      errors: [],
    });
  });

  it('comprova separadamente a remoção da taxa descoberta pela referência', async () => {
    const deps = dependencies();
    deps.listPayments
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 1,
        limit: 10,
        offset: 0,
        data: [
          paymentFixture({
            id: 'pay_fee_1',
            subscription: null,
            externalReference: 'enrollment-op:operation-1:fee',
          }),
        ],
      })
      .mockResolvedValueOnce({
        object: 'list',
        hasMore: false,
        totalCount: 1,
        limit: 100,
        offset: 0,
        data: [paymentFixture()],
      });

    const result = await compensateStagedEnrollmentFinancialResources(
      {
        contaId: 'conta-1',
        operationId: 'operation-1',
        asaasSubscriptionId: 'sub_remote_1',
        firstSubscriptionPaymentId: 'pay_monthly_1',
      },
      deps,
    );

    expect(result).toMatchObject({
      complete: true,
      deletedSubscriptionId: 'sub_remote_1',
      deletedFirstSubscriptionPaymentId: 'pay_monthly_1',
      deletedEnrollmentFeePaymentId: 'pay_fee_1',
      deletedPaymentIds: expect.arrayContaining(['pay_fee_1', 'pay_monthly_1']),
    });
  });
});
