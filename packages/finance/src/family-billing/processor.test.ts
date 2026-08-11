import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  outboxFindUnique: vi.fn(), outboxUpdateMany: vi.fn(), standaloneFindFirst: vi.fn(),
  standaloneUpdateMany: vi.fn(), rematriculaUpdateMany: vi.fn(), operationFindFirst: vi.fn(),
  adjustmentFindFirst: vi.fn(), allocationFindMany: vi.fn(), materialize: vi.fn(),
  preview: vi.fn(), commit: vi.fn(), processAdjustments: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    familyBillingOutbox: { findUnique: mocks.outboxFindUnique, updateMany: mocks.outboxUpdateMany },
    standaloneSubscription: { findFirst: mocks.standaloneFindFirst, updateMany: mocks.standaloneUpdateMany },
    rematriculaFamiliar: { updateMany: mocks.rematriculaUpdateMany },
    billingChangeOperation: { findFirst: mocks.operationFindFirst },
    billingAdjustment: { findFirst: mocks.adjustmentFindFirst },
    billingAllocation: { findMany: mocks.allocationFindMany },
  },
}));
vi.mock('../billing-agreements/materialize.js', () => ({ materializeBillingAgreement: mocks.materialize }));
vi.mock('../billing-agreements/runtime.js', () => ({
  previewBillingAgreementChange: mocks.preview,
  commitBillingAgreementChange: mocks.commit,
}));
vi.mock('../billing-agreements/adjustment-processor.js', () => ({
  processPendingBillingAdjustments: mocks.processAdjustments,
}));

import { processFamilyBillingOutboxEvent } from './processor';

describe('REQUEST_SOURCE_SUBSCRIPTION_CLOSURE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-1', contaId: 'conta-1', aggregateId: 'renewal-1',
      eventType: 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE', status: 'PENDING', attempts: 0,
      payload: {
        contaId: 'conta-1', aggregateId: 'renewal-1', sourceFinancialAgreementId: 'standalone-1',
        sourceAsaasSubscriptionId: 'asaas-1', effectiveDate: '2026-08-31',
      },
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.standaloneFindFirst.mockResolvedValue({
      id: 'standalone-1', asaasSubscriptionId: 'asaas-1', familyGroupId: 'family-1',
    });
    mocks.standaloneUpdateMany.mockResolvedValue({ count: 1 });
    mocks.rematriculaUpdateMany.mockResolvedValue({ count: 1 });
    mocks.operationFindFirst.mockResolvedValue(null);
    mocks.adjustmentFindFirst.mockResolvedValue(null);
    mocks.materialize.mockResolvedValue({ id: 'agreement-1' });
    mocks.allocationFindMany.mockResolvedValue([{
      id: 'allocation-1', baseAmount: 150, discountAmount: 0, netAmount: 150,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    }]);
    mocks.preview.mockResolvedValue({
      blockers: [], adjustments: [], previewHash: 'hash-1',
      expiresAt: '2099-01-01T00:00:00.000Z', sourceVersion: 3,
    });
    mocks.commit.mockResolvedValue({ status: 'COMPLETED', operationId: 'operation-1' });
  });

  it('atualiza somente a vigência e recupera commit concluído sem duplicar a operação', async () => {
    await expect(processFamilyBillingOutboxEvent('outbox-1')).resolves.toEqual({ processed: true });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'UPDATE_ALLOCATION',
      allocations: [expect.objectContaining({
        allocationId: 'allocation-1',
        validUntil: '2026-09-01',
        validFrom: expect.not.stringContaining('2026-01-01'),
      })],
    }));
    expect(mocks.commit).toHaveBeenCalledTimes(1);

    mocks.operationFindFirst.mockResolvedValue({ id: 'operation-1' });
    await expect(processFamilyBillingOutboxEvent('outbox-1')).resolves.toEqual({ processed: true });
    expect(mocks.materialize).toHaveBeenCalledTimes(1);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it('permite reconciliação explícita de evento que teve resultado incerto', async () => {
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'outbox-1',
      contaId: 'conta-1',
      aggregateId: 'renewal-1',
      eventType: 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE',
      status: 'REQUIRES_RECONCILIATION',
      attempts: 1,
      payload: {
        contaId: 'conta-1',
        aggregateId: 'renewal-1',
        sourceFinancialAgreementId: 'standalone-1',
        sourceAsaasSubscriptionId: 'asaas-1',
        effectiveDate: '2026-08-31',
      },
    });

    await expect(
      processFamilyBillingOutboxEvent('outbox-1', { allowReconciliation: true }),
    ).resolves.toEqual({ processed: true });
    expect(mocks.outboxUpdateMany).toHaveBeenCalled();
  });
});
