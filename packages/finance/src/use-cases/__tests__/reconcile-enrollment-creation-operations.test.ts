import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, compensateMock, upsertIssueMock, runWithTenantMock, tenantContexts } = vi.hoisted(() => ({
  prismaMock: {
    enrollmentCreationOperation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    matricula: { findFirst: vi.fn() },
    asaasIntegrationJob: { findFirst: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  compensateMock: vi.fn(),
  upsertIssueMock: vi.fn(),
  tenantContexts: [] as string[],
  runWithTenantMock: vi.fn(async (contaId: string, callback: (tx: unknown) => Promise<unknown>) => {
    tenantContexts.push(contaId);
    return callback(prismaMock);
  }),
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock, runWithTenant: runWithTenantMock }));
vi.mock('../stage-enrollment-financial-resources', () => ({
  compensateStagedEnrollmentFinancialResources: compensateMock,
}));
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: upsertIssueMock,
}));

import { reconcileEnrollmentCreationOperations } from '../reconcile-enrollment-creation-operations';

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    contaId: 'conta-1',
    uiRequestId: 'request-1',
    status: 'REMOTE_PROVISIONED',
    attempts: 1,
    version: 2,
    asaasSubscriptionId: 'sub-1',
    asaasFirstPaymentId: 'pay-monthly-1',
    asaasEnrollmentFeePaymentId: 'pay-fee-1',
    requestSnapshot: {
      gerarCobrancaTaxa: true,
      taxaIsenta: false,
      taxaMatricula: 80,
    },
    ...overrides,
  };
}

describe('reconcileEnrollmentCreationOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantContexts.length = 0;
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock));
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.enrollmentCreationOperation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.asaasIntegrationJob.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([]);
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-monthly-1', 'pay-fee-1'],
      deletedFirstSubscriptionPaymentId: 'pay-monthly-1',
      deletedEnrollmentFeePaymentId: 'pay-fee-1',
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });
  });

  it('converge para COMMITTED quando a matrícula local já foi gravada', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub-1',
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 1, compensated: 0, attention: 0, suspended: 0, waiting: 0 });
    expect(compensateMock).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMMITTED' }) }),
    );
  });

  it('compensa recursos remotos quando não existe matrícula local', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 1, attention: 0, suspended: 0, waiting: 0 });
    expect(compensateMock).toHaveBeenCalledWith({
      contaId: 'conta-1',
      operationId: 'op-1',
      asaasSubscriptionId: 'sub-1',
      firstSubscriptionPaymentId: 'pay-monthly-1',
      enrollmentFeePaymentId: 'pay-fee-1',
      discoverFeeByOperationId: true,
    });
  });

  it('persiste IDs remotos confirmados apenas no outbox ao finalizar compensação', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation({
      asaasSubscriptionId: null,
      asaasFirstPaymentId: null,
      asaasEnrollmentFeePaymentId: null,
      requestSnapshot: { gerarCobrancaTaxa: false, taxaIsenta: true },
    })]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([
      {
        payload: {
          state: 'REMOTE_CONFIRMED', resource: 'SUBSCRIPTION', remoteId: 'sub-outbox-only',
          externalReference: 'enrollment-op:op-1:subscription',
        },
      },
      {
        payload: {
          state: 'REMOTE_CONFIRMED', resource: 'PAYMENT', remoteId: 'pay-first-outbox-only',
          externalReference: 'enrollment-op:op-1:subscription',
        },
      },
    ]);
    compensateMock.mockResolvedValueOnce({
      complete: true,
      deletedPaymentIds: ['pay-first-outbox-only'],
      deletedFirstSubscriptionPaymentId: 'pay-first-outbox-only',
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: 'sub-outbox-only',
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(compensateMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', operationId: 'op-1', asaasSubscriptionId: 'sub-outbox-only',
      firstSubscriptionPaymentId: 'pay-first-outbox-only',
    }));
    expect(result).toMatchObject({ compensated: 1, attention: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'COMPENSATED',
        asaasSubscriptionId: 'sub-outbox-only',
        asaasFirstPaymentId: 'pay-first-outbox-only',
      }),
    }));
  });

  it('seleciona apenas exceções incertas dentro do limite e mantém backoff progressivo', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([]);

    await reconcileEnrollmentCreationOperations({ limit: 10 });

    const query = prismaMock.enrollmentCreationOperation.findMany.mock.calls[0]?.[0];
    expect(query.where.status.in).toContain('REQUIRES_RECONCILIATION');
    const eligibility = query.where.AND[0].OR;
    const uncertainException = eligibility.find((entry: Record<string, unknown>) =>
      entry.status === 'REQUIRES_RECONCILIATION',
    );
    expect(uncertainException).toEqual(expect.objectContaining({
      attempts: { lt: 8 },
      lastError: { in: ['REMOTE_CREATION_RESULT_STILL_UNCERTAIN', 'REMOTE_VERIFICATION_TRANSIENT'] },
    }));
    expect(uncertainException.OR).toHaveLength(8);
    expect(eligibility).toEqual(expect.arrayContaining([
      expect.objectContaining({ lastError: 'WEBHOOK_EVIDENCE' }),
    ]));
    expect(Object.keys(query.select)).toEqual(expect.arrayContaining([
      'id', 'contaId', 'uiRequestId', 'status', 'version', 'attempts', 'leaseExpiresAt',
      'requestSnapshot', 'asaasSubscriptionId', 'asaasFirstPaymentId', 'asaasEnrollmentFeePaymentId', 'result',
    ]));
    expect(query.select).not.toHaveProperty('student');
  });

  it('processa candidatos globais A e B em contexto tenant separado com filtros em cada leitura e write', async () => {
    const operationA = operation({
      id: 'op-tenant-a', contaId: 'conta-a', uiRequestId: 'shared-request',
      asaasSubscriptionId: 'shared-subscription', asaasFirstPaymentId: 'shared-first-payment',
      asaasEnrollmentFeePaymentId: null,
      requestSnapshot: { gerarCobrancaTaxa: false, taxaIsenta: true },
    });
    const operationB = operation({
      id: 'op-tenant-b', contaId: 'conta-b', uiRequestId: 'shared-request',
      asaasSubscriptionId: 'shared-subscription', asaasFirstPaymentId: 'shared-first-payment',
      asaasEnrollmentFeePaymentId: null,
      requestSnapshot: { gerarCobrancaTaxa: false, taxaIsenta: true },
    });
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operationA, operationB]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([]);

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toMatchObject({ inspected: 2, compensated: 2 });
    expect(prismaMock.enrollmentCreationOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ contaId: true }),
    }));
    expect(tenantContexts).toEqual(expect.arrayContaining(['conta-a', 'conta-b']));
    expect(prismaMock.matricula.findFirst.mock.calls.map(([args]) => args.where)).toEqual([
      { contaId: 'conta-a', uiRequestId: 'shared-request' },
      { contaId: 'conta-b', uiRequestId: 'shared-request' },
    ]);
    expect(prismaMock.asaasIntegrationJob.findMany.mock.calls.map(([args]) => args.where.contaId)).toEqual([
      'conta-a', 'conta-b',
    ]);
    expect(prismaMock.enrollmentCreationOperation.updateMany.mock.calls.map(([args]) => args.where.contaId))
      .toEqual(['conta-a', 'conta-a', 'conta-b', 'conta-b']);
    expect(compensateMock.mock.calls.map(([args]) => args.contaId)).toEqual(['conta-a', 'conta-b']);
  });

  it('não inclui a operação histórica fora do limite automático', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([]);

    await reconcileEnrollmentCreationOperations({ limit: 10 });

    const query = prismaMock.enrollmentCreationOperation.findMany.mock.calls[0]?.[0];
    const uncertainException = query.where.AND[0].OR.find(
      (entry: Record<string, unknown>) => entry.status === 'REQUIRES_RECONCILIATION',
    );
    expect(uncertainException.attempts).toEqual({ lt: 8 });
  });

  it('retoma operação incerta nova em REQUIRES_RECONCILIATION dentro do limite', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([
      operation({ status: 'REQUIRES_RECONCILIATION', attempts: 2, lastError: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN' }),
    ]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    const result = await reconcileEnrollmentCreationOperations({ contaId: 'conta-1', limit: 10 });

    expect(result).toMatchObject({ inspected: 1, compensated: 1, attention: 0 });
    expect(compensateMock).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-1', operationId: 'op-1' }));
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'COMPENSATING', version: 3 }),
    }));
  });

  it('não executa recuperação quando outra execução vence o lease/CAS', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.enrollmentCreationOperation.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result.inspected).toBe(1);
    expect(prismaMock.matricula.findFirst).not.toHaveBeenCalled();
    expect(compensateMock).not.toHaveBeenCalled();
  });

  it('não descobre taxa remota quando o snapshot prova isenção', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([
      operation({
        asaasSubscriptionId: null,
        asaasFirstPaymentId: null,
        asaasEnrollmentFeePaymentId: null,
        requestSnapshot: { gerarCobrancaTaxa: true, taxaIsenta: true, taxaMatricula: 0 },
      }),
    ]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(compensateMock).toHaveBeenCalledWith(expect.objectContaining({ discoverFeeByOperationId: false }));
  });

  it('mantém em reconciliação quando a taxa esperada ainda não foi localizada', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-monthly-1'],
      deletedFirstSubscriptionPaymentId: 'pay-monthly-1',
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
          lastError: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN',
        }),
      }),
    );
  });

  it('mantém em reconciliação quando a primeira mensalidade ainda não foi localizada', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-fee-1'],
      deletedFirstSubscriptionPaymentId: null,
      deletedEnrollmentFeePaymentId: 'pay-fee-1',
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
          lastError: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN',
        }),
      }),
    );
  });

  it('suspende compensação quando há evidência persistida de pagamento recebido', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation({
      result: {
        terminalPaymentEvidence: [{
          paymentId: 'pay-monthly-1', status: 'RECEIVED', event: 'PAYMENT_RECEIVED', eventId: 'evt-paid',
        }],
      },
    })]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 });
    expect(compensateMock).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'COMPENSATING', version: 3 }),
      data: expect.objectContaining({
        status: 'REQUIRES_RECONCILIATION',
        lastError: 'TERMINAL_PAYMENT_WEBHOOK_EVIDENCE',
      }),
    }));
    expect(upsertIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', entityType: 'PAYMENT', entityId: 'op-1', asaasId: 'pay-monthly-1',
      issueType: 'BILLING_OPERATION_UNCERTAIN', severity: 'CRITICAL',
      remoteStatus: 'RECEIVED', causeId: 'evt-paid',
    }));
  });

  it('bloqueia compensação com evidência AWAITING_CHARGEBACK_REVERSAL reconhecida pelo classifier comum', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation({
      asaasFirstPaymentId: 'pay-chargeback-reversal',
      result: {
        terminalPaymentEvidence: [{
          paymentId: 'pay-chargeback-reversal',
          status: 'AWAITING_CHARGEBACK_REVERSAL',
          event: 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
          eventId: 'evt-chargeback-reversal',
        }],
      },
    })]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toMatchObject({ compensated: 0, suspended: 1, attention: 1 });
    expect(compensateMock).not.toHaveBeenCalled();
    expect(upsertIssueMock).toHaveBeenCalledWith(expect.objectContaining({
      asaasId: 'pay-chargeback-reversal',
      issueType: 'BILLING_OPERATION_UNCERTAIN', severity: 'CRITICAL',
      remoteStatus: 'AWAITING_CHARGEBACK_REVERSAL', causeId: 'evt-chargeback-reversal',
    }));
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION', lastError: 'TERMINAL_PAYMENT_WEBHOOK_EVIDENCE' }),
    }));
  });

  it('agenda nova busca após falha transitória sem compensar nem ultrapassar o limite', async () => {
    prismaMock.enrollmentCreationOperation.findMany
      .mockResolvedValueOnce([operation({ attempts: 2 })])
      .mockResolvedValueOnce([operation({
        status: 'REQUIRES_RECONCILIATION',
        lastError: 'REMOTE_VERIFICATION_TRANSIENT',
        attempts: 3,
        version: 4,
      })]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    compensateMock.mockResolvedValue({
      discovery: {
        complete: false,
        retryable: true,
        subscriptionFound: false,
        enrollmentFeeSearchPerformed: true,
        enrollmentFeeFound: false,
      },
      complete: false,
      deletedPaymentIds: [],
      deletedFirstSubscriptionPaymentId: null,
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: null,
      errors: [{ resource: 'SUBSCRIPTION', id: 'op-1', message: 'DISCOVERY_FAILED:TIMEOUT' }],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 0, suspended: 0, waiting: 1 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION', lastError: 'REMOTE_VERIFICATION_TRANSIENT' }),
    }));
    expect(prismaMock.enrollmentCreationOperation.updateMany.mock.calls[0]?.[0].data).toEqual(expect.objectContaining({
      attempts: { increment: 1 },
    }));
    expect(prismaMock.enrollmentCreationOperation.updateMany.mock.calls[1]?.[0].data).not.toHaveProperty('attempts');

    await reconcileEnrollmentCreationOperations({ limit: 10 });

    const retryQuery = prismaMock.enrollmentCreationOperation.findMany.mock.calls[1]?.[0];
    const retryException = retryQuery.where.AND[0].OR.find((entry: Record<string, unknown>) =>
      entry.status === 'REQUIRES_RECONCILIATION',
    );
    expect(retryException).toEqual(expect.objectContaining({
      attempts: { lt: 8 },
      lastError: { in: ['REMOTE_CREATION_RESULT_STILL_UNCERTAIN', 'REMOTE_VERIFICATION_TRANSIENT'] },
    }));
    expect(retryException.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ attempts: { gte: 3, lt: 4 }, updatedAt: { lte: expect.any(Date) } }),
    ]));
    expect(prismaMock.enrollmentCreationOperation.updateMany.mock.calls[2]?.[0].where).toEqual(expect.objectContaining({
      version: 4,
      status: 'REQUIRES_RECONCILIATION',
    }));
    expect(prismaMock.enrollmentCreationOperation.updateMany.mock.calls[2]?.[0].data).toEqual(expect.objectContaining({
      attempts: { increment: 1 },
    }));
  });

  it('suspende falha de verificação transitória ao atingir a oitava inspeção', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation({ attempts: 7 })]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    compensateMock.mockResolvedValue({
      discovery: {
        complete: false,
        retryable: true,
        subscriptionFound: false,
        enrollmentFeeSearchPerformed: false,
        enrollmentFeeFound: false,
      },
      complete: false,
      deletedPaymentIds: [],
      deletedFirstSubscriptionPaymentId: null,
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: null,
      errors: [{ resource: 'SUBSCRIPTION', id: 'op-1', message: 'DISCOVERY_FAILED:HTTP_503' }],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION', lastError: 'REMOTE_VERIFICATION_TRANSIENT' }),
    }));
  });

  it('não trata job FAILED sem recurso como prova de ausência da taxa', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findFirst.mockResolvedValue({
      payload: { state: 'FAILED', entityId: 'op-1' },
    });
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([{
      payload: {
        state: 'FAILED', resource: 'PAYMENT', remoteId: null,
        externalReference: 'enrollment-op:op-1:fee',
      },
    }]);
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-monthly-1'],
      deletedFirstSubscriptionPaymentId: 'pay-monthly-1',
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1, suspended: 1, waiting: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION', lastError: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN' }),
      }),
    );
  });

  it('não compensa por busca vazia uma taxa isenta com tentativa outbound FAILED', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([
      operation({
        asaasSubscriptionId: null,
        asaasFirstPaymentId: null,
        asaasEnrollmentFeePaymentId: null,
        requestSnapshot: { gerarCobrancaTaxa: true, taxaIsenta: true, taxaMatricula: 0 },
      }),
    ]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([{
      payload: {
        state: 'FAILED', resource: 'PAYMENT', remoteId: null,
        externalReference: 'enrollment-op:op-1:fee',
      },
    }]);
    compensateMock.mockResolvedValue({
      discovery: { complete: true, retryable: false, subscriptionFound: false, enrollmentFeeSearchPerformed: true, enrollmentFeeFound: false },
      complete: true,
      deletedPaymentIds: [],
      deletedFirstSubscriptionPaymentId: null,
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: null,
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(compensateMock).toHaveBeenCalledWith(expect.objectContaining({ discoverFeeByOperationId: true }));
    expect(result).toMatchObject({ compensated: 0, attention: 1, suspended: 1 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION' }),
    }));
  });

  it('usa ID remoto confirmado pelo outbox como evidência para a compensação tenant-scoped', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([
      operation({ asaasSubscriptionId: null, asaasFirstPaymentId: null, asaasEnrollmentFeePaymentId: null }),
    ]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findMany.mockResolvedValue([{
      payload: {
        state: 'REMOTE_CONFIRMED', resource: 'SUBSCRIPTION', remoteId: 'sub-from-outbox',
        externalReference: 'enrollment-op:op-1:subscription',
      },
    }]);

    await reconcileEnrollmentCreationOperations({ limit: 10, contaId: 'conta-1' });

    expect(prismaMock.asaasIntegrationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1', payload: { path: ['entityId'], equals: 'op-1' } }),
    }));
    expect(compensateMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', asaasSubscriptionId: 'sub-from-outbox',
    }));
  });
});
