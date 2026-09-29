import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, compensateMock } = vi.hoisted(() => ({
  prismaMock: {
    enrollmentCreationOperation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    matricula: { findFirst: vi.fn() },
    asaasIntegrationJob: { findFirst: vi.fn() },
  },
  compensateMock: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: (tx: unknown) => Promise<unknown>) =>
    callback(prismaMock),
  ),
}));
vi.mock('@alusa/finance', () => ({
  compensateStagedEnrollmentFinancialResources: compensateMock,
}));

import { reconcileEnrollmentCreationOperations } from './reconcile-enrollment-creation-operations';

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    contaId: 'conta-1',
    uiRequestId: 'request-1',
    status: 'REMOTE_PROVISIONED',
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
    prismaMock.enrollmentCreationOperation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.asaasIntegrationJob.findFirst.mockResolvedValue(null);
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

    expect(result).toEqual({ inspected: 1, committed: 1, compensated: 0, attention: 0 });
    expect(compensateMock).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMMITTED' }) }),
    );
  });

  it('compensa recursos remotos quando não existe matrícula local', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 1, attention: 0 });
    expect(compensateMock).toHaveBeenCalledWith({
      contaId: 'conta-1',
      operationId: 'op-1',
      asaasSubscriptionId: 'sub-1',
      firstSubscriptionPaymentId: 'pay-monthly-1',
      enrollmentFeePaymentId: 'pay-fee-1',
    });
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

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1 });
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

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 0, attention: 1 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUIRES_RECONCILIATION',
          lastError: 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN',
        }),
      }),
    );
  });

  it('conclui a compensação quando o comando prova que a taxa foi rejeitada', async () => {
    prismaMock.enrollmentCreationOperation.findMany.mockResolvedValue([operation()]);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.asaasIntegrationJob.findFirst.mockResolvedValue({
      payload: { state: 'FAILED', entityId: 'op-1' },
    });
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-monthly-1'],
      deletedFirstSubscriptionPaymentId: 'pay-monthly-1',
      deletedEnrollmentFeePaymentId: null,
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });

    const result = await reconcileEnrollmentCreationOperations({ limit: 10 });

    expect(result).toEqual({ inspected: 1, committed: 0, compensated: 1, attention: 0 });
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPENSATED', lastError: null }),
      }),
    );
  });
});
