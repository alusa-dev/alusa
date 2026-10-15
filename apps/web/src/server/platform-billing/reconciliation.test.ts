import { describe, expect, it, vi } from 'vitest';

import { classifyStuckWebhookEventGroups, correctAccountFromStripeSubscription } from './reconciliation';

describe('classifyStuckWebhookEventGroups', () => {
  it('mantém eventos presos associados ao tenant correto', () => {
    expect(
      classifyStuckWebhookEventGroups(
        [
          { contaId: 'conta-a', count: 2 },
          { contaId: 'conta-b', count: 3 },
        ],
        new Set(['conta-a', 'conta-b']),
      ),
    ).toEqual({
      tenantCounts: { 'conta-a': 2, 'conta-b': 3 },
      platformCount: 0,
    });
  });

  it('trata evento sem tenant ou com tenant inválido como problema da plataforma', () => {
    expect(
      classifyStuckWebhookEventGroups(
        [
          { contaId: null, count: 4 },
          { contaId: 'conta-removida', count: 1 },
        ],
        new Set(['conta-a']),
      ),
    ).toEqual({
      tenantCounts: {},
      platformCount: 5,
    });
  });

  it('não mistura contagens de tenants em uma issue global', () => {
    const result = classifyStuckWebhookEventGroups(
      [
        { contaId: 'conta-a', count: 1 },
        { contaId: null, count: 2 },
      ],
      new Set(['conta-a']),
    );

    expect(result.tenantCounts['conta-a']).toBe(1);
    expect(result.platformCount).toBe(2);
  });
});

describe('correctAccountFromStripeSubscription claim fencing', () => {
  it('does not clear a newer pending plan operation when the snapshot CAS loses', async () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_premium_test';
    const accountUpdateMany = vi.fn(async () => ({ count: 0 }));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
    };
    const prisma = {
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;
    const account = {
      id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
      gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      accessStateVersion: 0, pendingPlanCode: 'PREMIUM', pendingChangeType: 'DOWNGRADE',
      pendingChangeEffectiveAt: new Date('2026-12-01T00:00:00Z'), pendingChangeOperationId: 'op_a',
      pendingChangeClaimToken: null, lastReconciledAt: null,
    };
    const subscription = {
      id: 'sub_a', customerId: 'cus_a', status: 'active', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    };

    await expect(correctAccountFromStripeSubscription(prisma, {
      account: account as never, subscription: subscription as never, planCode: 'PREMIUM',
      environment: 'TEST', paymentMethod: null, paidInvoices: [],
    })).resolves.toBe(false);
    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'pba_a', contaId: 'conta_a', environment: 'TEST', stripeSubscriptionId: 'sub_a',
        pendingChangeOperationId: 'op_a', pendingChangeClaimToken: null,
      }),
    }));
  });

  it('converges the pending plan change with the account when reconciliation sees the exact target price', async () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_premium_test';
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: {
        count: vi.fn(async () => 0),
        updateMany: planChangeUpdateMany,
      },
      platformBillingAuditLog: { create: vi.fn(async () => ({})) },
      platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;
    const account = {
      id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
      gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      accessStateVersion: 0, pendingPlanCode: 'PREMIUM', pendingChangeType: 'DOWNGRADE',
      pendingChangeEffectiveAt: new Date('2026-12-01T00:00:00Z'), pendingChangeOperationId: 'op_a',
      pendingChangeClaimToken: 'claim_a', lastReconciledAt: null,
    };
    const subscription = {
      id: 'sub_a', customerId: 'cus_a', status: 'active', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    };

    await expect(correctAccountFromStripeSubscription(prisma, {
      account: account as never, subscription: subscription as never, planCode: 'PREMIUM',
      environment: 'TEST', paymentMethod: null, paidInvoices: [],
    })).resolves.toBe(true);

    expect(planChangeUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'op_a', contaId: 'conta_a', billingAccountId: 'pba_a', environment: 'TEST',
        stripeSubscriptionId: 'sub_a', stripePriceId: 'price_premium_test', toPlanCode: 'PREMIUM',
        type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      },
      data: expect.objectContaining({ status: 'APPLIED', stripePriceId: 'price_premium_test' }),
    });
    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ pendingChangeOperationId: 'op_a', pendingChangeClaimToken: 'claim_a' }),
      data: expect.objectContaining({ pendingChangeOperationId: null, pendingChangeClaimToken: null }),
    }));
  });

  it('does not finalize a pending change when the canonical Stripe price differs from its target', async () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_premium_test';
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingPlanChange: { count: vi.fn(async () => 0), updateMany: planChangeUpdateMany },
      platformBillingAuditLog: { create: vi.fn(async () => ({})) },
      platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      platformBillingAccount: { update: vi.fn(async () => ({})) },
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;
    const account = {
      id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
      gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      accessStateVersion: 0, pendingPlanCode: 'PREMIUM', pendingChangeType: 'UPGRADE',
      pendingChangeEffectiveAt: null, pendingChangeOperationId: 'op_a',
      pendingChangeClaimToken: null, lastReconciledAt: null,
    };
    const subscription = {
      id: 'sub_a', customerId: 'cus_a', status: 'active', priceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    };

    await correctAccountFromStripeSubscription(prisma, {
      account: account as never, subscription: subscription as never, planCode: 'STARTER',
      environment: 'TEST', paymentMethod: null, paidInvoices: [],
    });

    expect(planChangeUpdateMany).not.toHaveBeenCalled();
  });

  it('rolls back the account correction when the exact pending operation no longer matches', async () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_premium_test';
    const planChangeUpdateMany = vi.fn(async () => ({ count: 0 }));
    const committedAccount: Record<string, unknown> = {
      planCode: 'STARTER', pendingPlanCode: 'PREMIUM', pendingChangeType: 'DOWNGRADE',
      pendingChangeOperationId: 'op_a', pendingChangeClaimToken: 'claim_a',
    };
    const accountUpdateMany = vi.fn();
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { count: vi.fn(async () => 0), updateMany: planChangeUpdateMany },
    };
    const prisma = {
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback) => {
        const stagedAccount = structuredClone(committedAccount);
        const stagedUpdateMany = vi.fn(async ({ data }) => {
          Object.assign(stagedAccount, data);
          return { count: 1 };
        });
        accountUpdateMany.mockImplementation(stagedUpdateMany.getMockImplementation()!);
        const stagedTx = {
          ...tx,
          platformBillingAccount: {
            updateMany: stagedUpdateMany,
          },
        };
        const result = await callback(stagedTx as never);
        Object.assign(committedAccount, stagedAccount);
        return result;
      }),
    } as never;
    const account = {
      id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
      gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      accessStateVersion: 0, pendingPlanCode: 'PREMIUM', pendingChangeType: 'DOWNGRADE',
      pendingChangeEffectiveAt: new Date('2026-12-01T00:00:00Z'), pendingChangeOperationId: 'op_a',
      pendingChangeClaimToken: 'claim_a', lastReconciledAt: null,
    };
    const subscription = {
      id: 'sub_a', customerId: 'cus_a', status: 'active', priceId: 'price_premium_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
    };

    await expect(correctAccountFromStripeSubscription(prisma, {
      account: account as never, subscription: subscription as never, planCode: 'PREMIUM',
      environment: 'TEST', paymentMethod: null, paidInvoices: [],
    })).resolves.toBe(false);
    expect(planChangeUpdateMany).toHaveBeenCalledTimes(1);
    expect(accountUpdateMany).not.toHaveBeenCalled();
    expect(committedAccount).toMatchObject({
      planCode: 'STARTER', pendingPlanCode: 'PREMIUM', pendingChangeOperationId: 'op_a',
      pendingChangeClaimToken: 'claim_a',
    });
  });

  it('does not overwrite a newer webhook state after retrieving an older Stripe snapshot', async () => {
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = 'price_premium_test';
    const snapshotVersion = new Date('2026-10-01T00:00:00Z');
    const webhookVersion = new Date('2026-10-02T00:00:00Z');
    const committed = {
      status: 'CANCELED', accessStatus: 'CANCELED', updatedAt: webhookVersion,
      lastProviderEventCreatedAt: webhookVersion, lastStripeEventId: 'evt_newer',
    };
    const accountUpdateMany = vi.fn(async ({ where }) => ({
      count: where.updatedAt.getTime() === committed.updatedAt.getTime()
        && where.lastProviderEventCreatedAt.getTime() === committed.lastProviderEventCreatedAt.getTime()
        && where.lastStripeEventId === committed.lastStripeEventId ? 1 : 0,
    }));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;
    const account = {
      id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
      planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
      gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null, firstPaidAt: null,
      lastSuccessfulPaymentAt: null, paymentMethodStatus: 'PRESENT', paymentMethodType: null,
      paymentMethodBrand: null, paymentMethodLast4: null, paymentMethodExpMonth: null,
      paymentMethodExpYear: null, restrictionReason: null, gracePeriodStartedAt: null,
      accessStateVersion: 0, pendingPlanCode: null, pendingChangeType: null,
      pendingChangeEffectiveAt: null, pendingChangeOperationId: null, pendingChangeClaimToken: null,
      lastReconciledAt: null, updatedAt: snapshotVersion,
      lastProviderEventCreatedAt: snapshotVersion, lastStripeEventId: 'evt_old',
    };
    const subscription = {
      id: 'sub_a', customerId: 'cus_a', status: 'active', priceId: 'price_starter_test',
      currentPeriodEnd: new Date('2026-11-01T00:00:00Z'), cancelAtPeriodEnd: false, trialEndsAt: null,
    };

    await expect(correctAccountFromStripeSubscription(prisma, {
      account: account as never, subscription: subscription as never, planCode: 'STARTER',
      environment: 'TEST', paymentMethod: null, paidInvoices: [],
    })).resolves.toBe(false);
    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updatedAt: snapshotVersion, lastProviderEventCreatedAt: snapshotVersion, lastStripeEventId: 'evt_old',
      }),
    }));
    expect(committed).toEqual({
      status: 'CANCELED', accessStatus: 'CANCELED', updatedAt: webhookVersion,
      lastProviderEventCreatedAt: webhookVersion, lastStripeEventId: 'evt_newer',
    });
  });
});
