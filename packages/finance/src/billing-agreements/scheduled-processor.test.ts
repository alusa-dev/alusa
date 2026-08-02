import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  operationFindMany: vi.fn(),
  operationUpdateMany: vi.fn(),
  agreementFindMany: vi.fn(),
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
    },
    billingAgreement: {
      findMany: mocks.agreementFindMany,
      updateMany: vi.fn(),
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

import { processDueBillingAgreementChanges } from './scheduled-processor';

describe('processDueBillingAgreementChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.allocationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.agreementUpdateMany.mockResolvedValue({ count: 1 });
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
});
