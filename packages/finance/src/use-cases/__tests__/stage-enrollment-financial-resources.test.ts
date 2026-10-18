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
    listSubscriptions: vi.fn(async (filters: { externalReference?: string; offset?: number; limit?: number }, _options?: { contaId: string }) => ({
      object: 'list',
      hasMore: false,
      totalCount: 0,
      limit: 100,
      offset: filters.offset ?? 0,
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
    listPayments: vi.fn(async (filters: { subscription?: string; externalReference?: string; offset?: number; limit?: number }, _options?: { contaId: string }) => ({
      object: 'list',
      hasMore: false,
      totalCount: filters.subscription ? 1 : 0,
      limit: 100,
      offset: filters.offset ?? 0,
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
    recordCompensationIssue: vi.fn(async () => ({})),
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
      limit: 100,
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
    let feeLookups = 0;
    deps.createPayment.mockResolvedValue({
      success: false as const,
      error: { code: 'RESULT_UNKNOWN' as const, message: 'ASAAS_REJECTED', resultUnknown: true },
    });
    deps.listPayments.mockImplementation(
      async (filters: { subscription?: string; externalReference?: string }) => {
        if (filters.externalReference?.endsWith(':fee')) {
          feeLookups += 1;
          return {
            object: 'list', hasMore: false, totalCount: feeLookups === 1 ? 0 : 1, limit: 100, offset: 0,
            data: feeLookups === 1 ? [] : [paymentFixture({
              id: 'pay_fee_1', subscription: null, externalReference: 'enrollment-op:operation-1:fee',
            })],
          };
        }
        if (filters.externalReference) {
          return {
            object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
            data: [subscriptionFixture()],
          };
        }
        return {
          object: 'list', hasMore: false, totalCount: 1, limit: 100, offset: 0,
          data: [paymentFixture()],
        };
      },
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
      limit: 100,
      offset: 0,
      data: [subscriptionFixture()],
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result.success).toBe(true);
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.markRemoteRequested).not.toHaveBeenCalled();
  });

  it('bloqueia POST quando existem assinaturas ativas duplicadas com a referência exata', async () => {
    const deps = dependencies();
    deps.listSubscriptions.mockResolvedValue({
      object: 'list', hasMore: false, totalCount: 2, limit: 100, offset: 0,
      data: [subscriptionFixture({ id: 'sub-a' }), subscriptionFixture({ id: 'sub-b' })],
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({ success: false, resultUnknown: true });
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.markRemoteRequested).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.deletePayment).not.toHaveBeenCalled();
    expect(deps.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('não compensa nem remove recurso de execução concorrente sem claim outbound', async () => {
    const deps = dependencies();
    deps.listSubscriptions.mockResolvedValueOnce({
      object: 'list', hasMore: false, totalCount: 0, limit: 100, offset: 0, data: [],
    });
    deps.markRemoteRequested.mockResolvedValue(false);

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({
      success: false,
      error: 'SUBSCRIPTION_OPERATION_ALREADY_IN_PROGRESS',
      resultUnknown: true,
    });
    expect(deps.markRemoteRequested).toHaveBeenCalledTimes(1);
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.deletePayment).not.toHaveBeenCalled();
  });

  it('encontra assinatura na segunda página antes de criar outra', async () => {
    const deps = dependencies();
    deps.listSubscriptions
      .mockResolvedValueOnce({
        object: 'list', hasMore: true, totalCount: 101, limit: 100, offset: 0,
        data: Array.from({ length: 100 }, (_, index) => subscriptionFixture({ id: `deleted-${index}`, deleted: true })),
      })
      .mockResolvedValueOnce({
        object: 'list', hasMore: false, totalCount: 101, limit: 100, offset: 100,
        data: [subscriptionFixture()],
      });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({ success: true });
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.listSubscriptions.mock.calls.map(([filters, options]) => [filters.offset, options?.contaId]))
      .toEqual([[0, 'conta-1'], [100, 'conta-1']]);
  });

  it.each([
    ['offset', { offset: 1, limit: 100 }],
    ['limit', { offset: 0, limit: 99 }],
  ])('bloqueia criação quando lookup de assinatura responde com %s inconsistente', async (_field, pagination) => {
    const deps = dependencies();
    deps.listSubscriptions.mockResolvedValueOnce({
      object: 'list', hasMore: false, totalCount: 0, ...pagination, data: [],
    } as never);

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('SUBSCRIPTION_REFERENCE_LOOKUP_INCOMPLETE') });
    expect(deps.markRemoteRequested).not.toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it('bloqueia criação quando a paginação da busca de assinatura excede o limite seguro', async () => {
    const deps = dependencies();
    deps.listSubscriptions.mockImplementation(async (filters) => ({
      object: 'list', hasMore: true, totalCount: 10_001, limit: 100,
      offset: filters.offset ?? 0,
      data: Array.from({ length: 100 }, (_, index) => subscriptionFixture({
        id: `sub-${filters.offset ?? 0}-${index}`, deleted: true,
      })),
    }));

    const result = await stageEnrollmentFinancialResources(
      request({ claimCompensation: async () => false }),
      deps,
    );

    expect(result).toMatchObject({ success: false, error: 'ENROLLMENT_OPERATION_LEASE_LOST' });
    expect(deps.listSubscriptions).toHaveBeenCalledTimes(100);
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it('confirma a primeira mensalidade encontrada somente após paginar completamente', async () => {
    const deps = dependencies();
    deps.listPayments.mockImplementation(async (filters) => {
      if (filters.subscription) {
        return filters.offset === 0
          ? { object: 'list', hasMore: true, totalCount: 101, limit: 100, offset: 0,
              data: Array.from({ length: 100 }, (_, index) => paymentFixture({ id: `pay-first-${index}`, dueDate: '2026-08-06' })) }
          : { object: 'list', hasMore: false, totalCount: 101, limit: 100, offset: 100,
              data: [paymentFixture({ id: 'pay_monthly_later' })] };
      }
      return { object: 'list', hasMore: false, totalCount: 0, limit: 100,
        offset: filters.offset ?? 0, data: [] };
    });

    const result = await stageEnrollmentFinancialResources(request(), deps);

    expect(result).toMatchObject({ success: true, data: { subscription: { firstPayment: { asaasPaymentId: 'pay_monthly_later' } } } });
    expect(deps.listPayments.mock.calls.map(([filters, options]) => [filters.offset, options?.contaId]))
      .toEqual([[0, 'conta-1'], [100, 'conta-1']]);
  });

  it('não cria taxa de matrícula se a busca pela referência não termina', async () => {
    const deps = dependencies();
    deps.listPayments.mockImplementation(async (filters) => {
      if (filters.externalReference) {
        return {
          object: 'list', hasMore: true, totalCount: 10_001, limit: 100,
          offset: filters.offset ?? 0,
          data: Array.from({ length: 100 }, (_, index) => paymentFixture({
            id: `pay-fee-${filters.offset ?? 0}-${index}`, externalReference: filters.externalReference,
          })),
        };
      }
      return { object: 'list', hasMore: false, totalCount: 1, limit: 100,
        offset: filters.offset ?? 0, data: [paymentFixture()] };
    });

    await stageEnrollmentFinancialResources(
      request({
        enrollmentFee: { value: 75, dueDate: '2026-08-01', billingType: 'PIX' },
        claimCompensation: async () => false,
      }),
      deps,
    );

    expect(deps.createPayment).not.toHaveBeenCalled();
    const feeLookupCalls = deps.listPayments.mock.calls.filter(([filters]) => Boolean(filters.externalReference));
    expect(feeLookupCalls).toHaveLength(100);
    expect(feeLookupCalls.every(([, options]) => options?.contaId === 'conta-1')).toBe(true);
  });

  it('encontra taxa de matrícula na segunda página sem repetir POST', async () => {
    const deps = dependencies();
    deps.listPayments.mockImplementation(async (filters) => {
      if (filters.externalReference) {
        return filters.offset === 0
          ? { object: 'list', hasMore: true, totalCount: 101, limit: 100, offset: 0,
              data: Array.from({ length: 100 }, (_, index) => paymentFixture({
                id: `deleted-fee-${index}`, deleted: true, externalReference: filters.externalReference,
              })) }
          : { object: 'list', hasMore: false, totalCount: 101, limit: 100, offset: 100,
              data: [paymentFixture({ id: 'pay_fee_1', subscription: null, value: 75,
                dueDate: '2026-08-01', externalReference: filters.externalReference })] };
      }
      return { object: 'list', hasMore: false, totalCount: 1, limit: 100,
        offset: filters.offset ?? 0, data: [paymentFixture()] };
    });

    const result = await stageEnrollmentFinancialResources(
      request({ enrollmentFee: { value: 75, dueDate: '2026-08-01', billingType: 'PIX' } }),
      deps,
    );

    expect(result).toMatchObject({ success: true, data: { enrollmentFee: { asaasPaymentId: 'pay_fee_1' } } });
    expect(deps.createPayment).not.toHaveBeenCalled();
    const feeLookupCalls = deps.listPayments.mock.calls.filter(([filters]) => Boolean(filters.externalReference));
    expect(feeLookupCalls.map(([filters, options]) => [filters.offset, options?.contaId]))
      .toEqual([[0, 'conta-1'], [100, 'conta-1']]);
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
      limit: 100,
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
      limit: 100,
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
      limit: 100,
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
      limit: 100,
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
        limit: 100,
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

  it('não apaga assinatura se a busca paginada de pagamentos dela fica incompleta', async () => {
    const deps = dependencies();
    deps.listPayments
      .mockResolvedValueOnce({
        object: 'list', hasMore: true, totalCount: 101, limit: 100, offset: 0,
        data: Array.from({ length: 100 }, (_, index) => index === 0
          ? paymentFixture({ id: 'pay_monthly_1' })
          : paymentFixture({ id: `already-deleted-${index}`, deleted: true })),
      })
      .mockRejectedValueOnce(new Error('temporary provider failure'));

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result.complete).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ resource: 'SUBSCRIPTION', id: 'sub_remote_1', message: expect.stringContaining('SUBSCRIPTION_PAYMENT_CLEANUP_LOOKUP_INCOMPLETE') }),
    ]);
    expect(deps.listPayments.mock.calls.map(([filters, options]) => [filters.offset, options?.contaId]))
      .toEqual([[0, 'conta-1'], [100, 'conta-1']]);
    expect(result.deletedPaymentIds).toEqual(['pay_monthly_1']);
    expect(deps.deletePayment).toHaveBeenCalledWith('pay_monthly_1', { contaId: 'conta-1' });
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
  });

  it('preserva pagamento terminal, registra divergência e não remove assinatura', async () => {
    const deps = dependencies();
    deps.getPayment.mockResolvedValue(paymentFixture({ status: 'RECEIVED' }));

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', operationId: 'operation-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result.complete).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resource: 'PAYMENT',
        id: 'pay_monthly_1',
        message: 'PAYMENT_PRESERVED_FOR_RECONCILIATION:RECEIVED',
      }),
    ]));
    expect(deps.getPayment).toHaveBeenCalledWith('pay_monthly_1', { contaId: 'conta-1' });
    expect(deps.deletePayment).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.recordCompensationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      entityType: 'SUBSCRIPTION',
      entityId: 'operation-1',
      asaasId: 'sub_remote_1',
      localStatus: 'COMPENSATION_INCOMPLETE',
      remoteStatus: 'PAYMENT_TERMINAL_PRESERVED',
      metadata: expect.objectContaining({
        preservedPayments: [{ id: 'pay_monthly_1', status: 'RECEIVED' }],
      }),
    }));
  });

  it.each([
    ['status ausente', undefined],
    ['status desconhecido', 'CUSTOM_PROVIDER_STATE'],
  ])('preserva payment com %s e bloqueia exclusão da assinatura', async (_label, status) => {
    const deps = dependencies();
    deps.getPayment.mockResolvedValue(paymentFixture({ status }));

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result.complete).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resource: 'PAYMENT',
        id: 'pay_monthly_1',
        message: `PAYMENT_PRESERVED_FOR_RECONCILIATION:${status ?? 'UNKNOWN'}`,
      }),
    ]));
    expect(result.deletedPaymentIds).not.toContain('pay_monthly_1');
    expect(deps.deletePayment).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.recordCompensationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      asaasId: 'sub_remote_1',
      localStatus: 'COMPENSATION_INCOMPLETE',
    }));
  });

  it('bloqueia cleanup e subscription quando GET retorna ID divergente mesmo com status DELETED', async () => {
    const deps = dependencies();
    deps.getPayment.mockResolvedValue(paymentFixture({ id: 'different-payment', status: 'DELETED', deleted: true }));

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result.complete).toBe(false);
    expect(result.errors).toContainEqual({
      resource: 'PAYMENT',
      id: 'pay_monthly_1',
      message: 'PAYMENT_IDENTITY_NOT_CONFIRMED',
    });
    expect(result.deletedPaymentIds).not.toContain('pay_monthly_1');
    expect(deps.deletePayment).not.toHaveBeenCalled();
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.recordCompensationIssue).toHaveBeenCalled();
  });

  it('não remove assinatura se falha não-404 ao excluir payment', async () => {
    const deps = dependencies();
    deps.deletePayment.mockRejectedValue(new Error('provider unavailable'));

    const result = await compensateStagedEnrollmentFinancialResources(
      { contaId: 'conta-1', asaasSubscriptionId: 'sub_remote_1' },
      deps,
    );

    expect(result.complete).toBe(false);
    expect(result.errors).toContainEqual({
      resource: 'PAYMENT',
      id: 'pay_monthly_1',
      message: 'provider unavailable',
    });
    expect(result.deletedPaymentIds).not.toContain('pay_monthly_1');
    expect(deps.deleteSubscription).not.toHaveBeenCalled();
    expect(deps.recordCompensationIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      asaasId: 'sub_remote_1',
      remoteStatus: 'PAYMENT_CLEANUP_FAILED',
      metadata: expect.objectContaining({
        paymentCleanupBlockers: [{ id: 'pay_monthly_1', reason: 'PAYMENT_DELETE_FAILED:provider unavailable' }],
      }),
    }));
  });
});
