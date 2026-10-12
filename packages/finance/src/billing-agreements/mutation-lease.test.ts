import { describe, expect, it, vi } from 'vitest';

import { withBillingAgreementMutationLease } from './mutation-lease';

describe('withBillingAgreementMutationLease', () => {
  it('não permite projetar localmente quando a lease é perdida após sucesso remoto', async () => {
    let remoteSucceeded = false;
    let localProjectionApplied = false;
    const db = {
      $transaction: vi.fn(async (run) => run({ billingAgreement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } })),
      billingAgreement: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    await expect(withBillingAgreementMutationLease({
      db: db as never,
      contaId: 'conta-a',
      agreementIds: ['agreement-a'],
      leaseToken: 'attempt-a',
      run: async (assertOwned) => {
        remoteSucceeded = true;
        await assertOwned();
        localProjectionApplied = true;
      },
    })).rejects.toThrow('BILLING_AGREEMENT_MUTATION_LEASE_LOST');

    expect(remoteSucceeded).toBe(true);
    expect(localProjectionApplied).toBe(false);
    expect(db.billingAgreement.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', id: { in: ['agreement-a'] }, mutationLeaseToken: 'attempt-a' }),
    }));
  });
});
