import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  operationFindMany: vi.fn(),
  operationUpdateMany: vi.fn(),
  operationCount: vi.fn(),
  agreementFindMany: vi.fn(),
  agreementFindFirst: vi.fn(),
  directAgreementUpdateMany: vi.fn(),
  agreementCount: vi.fn(),
  allocationUpdateMany: vi.fn(),
  agreementUpdateMany: vi.fn(),
  transactionOperationUpdateMany: vi.fn(),
  getSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    billingChangeOperation: {
      findMany: mocks.operationFindMany,
      updateMany: mocks.operationUpdateMany,
      count: mocks.operationCount,
    },
    billingAgreement: {
      findMany: mocks.agreementFindMany,
      findFirst: mocks.agreementFindFirst,
      updateMany: mocks.directAgreementUpdateMany,
      count: mocks.agreementCount,
    },
    $transaction: vi.fn(async (run) =>
      run({
        billingAllocation: { updateMany: mocks.allocationUpdateMany },
        billingAgreement: { updateMany: mocks.agreementUpdateMany },
        billingChangeOperation: { updateMany: mocks.transactionOperationUpdateMany },
      }),
    ),
  },
}));

vi.mock('./asaas-subscription.adapter', () => ({
  createAsaasBillingAgreementPort: () => ({
    getSubscription: mocks.getSubscription,
    updateSubscription: mocks.updateSubscription,
    deleteSubscription: mocks.deleteSubscription,
  }),
}));

import { processDueBillingAgreementChanges, processExpiredBillingAllocations } from './scheduled-processor';

describe('processDueBillingAgreementChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.operationCount.mockResolvedValue(1);
    mocks.agreementCount.mockImplementation(async ({ where }: { where?: { id?: { in?: string[] } } } = {}) => where?.id?.in?.length ?? 1);
    mocks.allocationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.agreementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.directAgreementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transactionOperationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('aplica uma transferência no próximo ciclo em origem e destino sem alterar cobranças anteriores', async () => {
    const effectiveAt = new Date('2026-08-01T00:00:00.000Z');
    mocks.operationFindMany.mockResolvedValue([
      {
        id: 'operation-1',
        contaId: 'conta-1',
        sourceAgreementId: 'source-1',
        targetAgreementId: 'target-1',
        type: 'TRANSFER',
        effectiveAt,
      },
    ]);
    mocks.agreementFindMany.mockResolvedValue([
      {
        id: 'source-1',
        contaId: 'conta-1',
        version: 2,
        asaasSubscriptionId: 'sub-source',
        remoteStatus: 'ACTIVE',
        nextDueDate: effectiveAt,
        allocations: [
          {
            recurring: true,
            status: 'ACTIVE',
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validUntil: effectiveAt,
            netAmount: 100,
          },
        ],
      },
      {
        id: 'target-1',
        contaId: 'conta-1',
        version: 4,
        asaasSubscriptionId: 'sub-target',
        remoteStatus: 'ACTIVE',
        nextDueDate: effectiveAt,
        allocations: [
          {
            recurring: true,
            status: 'ACTIVE',
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validUntil: null,
            netAmount: 250,
          },
          {
            recurring: true,
            status: 'SCHEDULED',
            validFrom: effectiveAt,
            validUntil: null,
            netAmount: 100,
          },
        ],
      },
    ]);
    const remoteState = new Map([
      ['sub-source', { status: 'ACTIVE', valueCents: 10_000 }],
      ['sub-target', { status: 'ACTIVE', valueCents: 25_000 }],
    ]);
    mocks.getSubscription.mockImplementation(async ({ subscriptionId }) => ({
      id: subscriptionId,
      deleted: false,
      ...remoteState.get(subscriptionId),
    }));
    mocks.updateSubscription.mockImplementation(async ({ subscriptionId, status, valueCents }) => {
      const previous = remoteState.get(subscriptionId)!;
      remoteState.set(subscriptionId, {
        status,
        valueCents: valueCents ?? previous.valueCents,
      });
    });

    const result = await processDueBillingAgreementChanges({
      contaId: 'conta-1',
      now: effectiveAt,
    });

    expect(result).toEqual({ found: 1, applied: 1, uncertain: 0 });
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(2);
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        subscriptionId: 'sub-target',
        valueCents: 35_000,
        updatePendingPayments: false,
      }),
    );
    expect(mocks.updateSubscription.mock.calls.every(([payload]) => payload.nextDueDate === undefined)).toBe(true);
    expect(mocks.transactionOperationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledAppliedAt: effectiveAt }) }),
    );
  });

  it('fenceia a reconciliação de falha agendada pela posse e versão observadas', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    mocks.operationFindMany.mockResolvedValue([{
      id: 'operation-stale',
      contaId: 'conta-1',
      sourceAgreementId: 'agreement-stale',
      targetAgreementId: null,
      type: 'PAUSE_AGREEMENT',
      effectiveAt: now,
    }]);
    mocks.agreementFindMany.mockResolvedValue([{
      id: 'agreement-stale',
      contaId: 'conta-1',
      version: 7,
      asaasSubscriptionId: 'sub-stale',
      remoteStatus: 'ACTIVE',
      nextDueDate: now,
      allocations: [],
    }]);
    mocks.getSubscription.mockRejectedValue(new Error('provider timeout'));

    const result = await processDueBillingAgreementChanges({ contaId: 'conta-1', now });

    expect(result).toEqual({ found: 1, applied: 0, uncertain: 1 });
    expect(mocks.operationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'operation-stale', contaId: 'conta-1', status: 'COMPLETED',
        claimToken: expect.any(String), leaseExpiresAt: { gt: expect.any(Date) },
      }),
      data: expect.objectContaining({ status: 'REQUIRES_RECONCILIATION' }),
    }));
    expect(mocks.directAgreementUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'agreement-stale', contaId: 'conta-1', version: 7,
        mutationLeaseToken: expect.stringContaining('billing-scheduled:operation-stale:'),
      }),
    }));
  });

  it('reduz a assinatura antes de encerrar localmente uma alocação expirada', async () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    const agreement = {
        id: 'agreement-1',
        contaId: 'conta-1',
        version: 3,
        status: 'ACTIVE',
        asaasSubscriptionId: 'sub-shared',
        allocations: [
          { id: 'allocation-jazz', recurring: true, kind: 'TUITION', status: 'ACTIVE', validFrom: new Date('2026-01-01'), validUntil: new Date('2026-11-01'), netAmount: 150 },
          { id: 'allocation-ballet', recurring: true, kind: 'TUITION', status: 'ACTIVE', validFrom: new Date('2026-01-01'), validUntil: new Date('2026-12-06'), netAmount: 150 },
        ],
      };
    mocks.agreementFindMany.mockResolvedValue([{ id: agreement.id, contaId: agreement.contaId }]);
    mocks.agreementFindFirst.mockResolvedValue(agreement);
    const remote = { status: 'ACTIVE', valueCents: 30_000, endDate: '2026-12-05' };
    mocks.getSubscription.mockImplementation(async () => ({ id: 'sub-shared', deleted: false, ...remote }));
    mocks.updateSubscription.mockImplementation(async ({ valueCents, status }) => {
      remote.valueCents = valueCents;
      remote.status = status;
    });

    const result = await processExpiredBillingAllocations({ contaId: 'conta-1', now });

    expect(result).toEqual({ found: 1, applied: 1, uncertain: 0 });
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub-shared', valueCents: 15_000, status: 'ACTIVE' }),
    );
    expect(mocks.allocationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ENDED' } }),
    );
    expect(mocks.agreementUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'agreement-1',
        contaId: 'conta-1',
        version: 3,
        mutationLeaseToken: expect.stringMatching(/^billing-expiry:agreement-1:/),
      }),
    }));
  });

  it('relê o acordo após adquirir a lease e pula snapshot antigo sem chamada remota', async () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    mocks.agreementFindMany.mockResolvedValue([{ id: 'agreement-1', contaId: 'conta-1' }]);
    mocks.agreementFindFirst.mockResolvedValue({
      id: 'agreement-1',
      contaId: 'conta-1',
      version: 4,
      status: 'ACTIVE',
      asaasSubscriptionId: 'sub-shared',
      allocations: [
        { id: 'allocation-current', recurring: true, kind: 'TUITION', status: 'ACTIVE', validFrom: new Date('2026-01-01'), validUntil: null, netAmount: 150 },
      ],
    });

    const result = await processExpiredBillingAllocations({ contaId: 'conta-1', now });

    expect(result).toEqual({ found: 1, applied: 0, uncertain: 0 });
    expect(mocks.agreementFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'agreement-1', contaId: 'conta-1' }),
      include: { allocations: true },
    }));
    expect(mocks.getSubscription).not.toHaveBeenCalled();
    expect(mocks.updateSubscription).not.toHaveBeenCalled();
  });
});
