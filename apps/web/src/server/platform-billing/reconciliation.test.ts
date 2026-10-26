import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); });

const { retrieveSubscriptionMock, retrieveCustomerMock, listPaidInvoicesMock } = vi.hoisted(() => ({
  retrieveSubscriptionMock: vi.fn(),
  retrieveCustomerMock: vi.fn(),
  listPaidInvoicesMock: vi.fn(),
}));

vi.mock('@alusa/platform-billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/platform-billing')>();
  return {
    ...actual,
    createDefaultPlatformBillingStripeGateway: () => ({ retrieveSubscription: retrieveSubscriptionMock }),
  };
});
vi.mock('@alusa/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/stripe')>();
  return {
    ...actual,
    retrieveStripeCustomer: retrieveCustomerMock,
    listStripePaidInvoices: listPaidInvoicesMock,
    getStripeClient: () => ({}),
  };
});

import {
  classifyStuckWebhookEventGroups,
  correctAccountFromStripeSubscription,
  reconcilePlatformBilling,
} from './reconciliation';

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
  it('scopes stale cancellation plan-change count and update by tenant, environment, and subscription', async () => {
    const account = buildReconciliationAccount();
    const canceledAt = new Date('2026-10-17T12:34:56.000Z');
    const planChangeCount = vi.fn(async ({ where }) => where.type === 'CANCEL_AT_PERIOD_END' ? 1 : 0);
    const planChangeUpdateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 1 })) },
      platformBillingPlanChange: { updateMany: planChangeUpdateMany },
      platformBillingAuditLog: { create: vi.fn(async () => ({})) },
      platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      platformBillingPlanChange: { count: planChangeCount },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;

    await correctAccountFromStripeSubscription(prisma, {
      account: account as never,
      subscription: buildCanceledSubscription('cus_deleted') as never,
      planCode: 'STARTER', environment: 'TEST', paymentMethod: null, paidInvoices: [],
    });

    const scopedWhere = {
      contaId: 'conta_a', billingAccountId: 'pba_a', environment: 'TEST', stripeSubscriptionId: 'sub_a',
      type: 'CANCEL_AT_PERIOD_END', status: 'PENDING_EFFECTIVE_DATE',
    };
    expect(planChangeCount).toHaveBeenCalledWith({ where: scopedWhere });
    expect(planChangeUpdateMany).toHaveBeenCalledWith({
      where: scopedWhere,
      data: { status: 'CANCELED', canceledAt },
    });
  });

  it('cancels orphaned pending plan changes for the canceled subscription within the scoped transaction', async () => {
    const canceledAt = new Date('2026-10-17T12:34:56.000Z');
    const account = buildReconciliationAccount();
    const pendingPlanChange = {
      id: 'change_a', contaId: 'conta_a', billingAccountId: 'pba_a', environment: 'TEST',
      stripeSubscriptionId: 'sub_a', type: 'DOWNGRADE', status: 'PENDING_EFFECTIVE_DATE',
      canceledAt: null,
    };
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    const planChangeUpdateMany = vi.fn(async ({ where, data }) => {
      const matches = where.contaId === pendingPlanChange.contaId
        && where.billingAccountId === pendingPlanChange.billingAccountId
        && where.environment === pendingPlanChange.environment
        && where.stripeSubscriptionId === pendingPlanChange.stripeSubscriptionId
        && where.type.in.includes(pendingPlanChange.type)
        && where.status.in.includes(pendingPlanChange.status);
      if (matches) Object.assign(pendingPlanChange, data);
      return { count: matches ? 1 : 0 };
    });
    const auditCreate = vi.fn(async () => ({}));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { updateMany: planChangeUpdateMany },
      platformBillingAuditLog: { create: auditCreate },
      platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      platformBillingPlanChange: {
        count: vi.fn(async ({ where }) => Array.isArray(where.type?.in) ? 1 : 0),
      },
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as never;
    const subscription = {
      id: 'sub_a', customerId: 'cus_deleted', status: 'canceled', priceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      canceledAt, pendingUpdateId: null,
    };

    await expect(correctAccountFromStripeSubscription(prisma, {
      account: { ...account, pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
        pendingChangeOperationId: null, pendingChangeClaimToken: null } as never,
      subscription: subscription as never,
      planCode: 'STARTER', environment: 'TEST', paymentMethod: null, paidInvoices: [],
    })).resolves.toBe(true);

    expect(planChangeUpdateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta_a', billingAccountId: 'pba_a', environment: 'TEST', stripeSubscriptionId: 'sub_a',
        type: { in: ['UPGRADE', 'DOWNGRADE'] }, status: { in: ['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE'] },
      },
      data: { status: 'CANCELED', canceledAt },
    });
    expect(pendingPlanChange).toMatchObject({ status: 'CANCELED', canceledAt });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'PLATFORM_BILLING_RECONCILIATION_CORRECTED',
        metadata: expect.objectContaining({ correctedFields: expect.arrayContaining(['pendingPlanChangesCanceled']) }),
      }),
    }));
    expect(pendingPlanChange.id).toBe('change_a');
  });

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

describe('reconcilePlatformBilling for canceled subscriptions with a missing Stripe customer', () => {
  it('retains the local customer/card and four invoices when Stripe confirms the customer exists', async () => {
    vi.stubEnv('STRIPE_PRICE_STARTER_MONTHLY', 'price_starter_test');
    const account = { ...buildReconciliationAccount(), stripePriceId: 'price_starter_test' };
    const accountCas = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const invoiceUpsert = vi.fn();
    const prisma = buildReconciliationPrisma(account, accountCas, invoiceUpsert);
    retrieveSubscriptionMock.mockResolvedValue({
      ...buildCanceledSubscription('cus_deleted'), priceId: 'price_starter_test',
    });
    retrieveCustomerMock.mockResolvedValue({ id: 'cus_deleted', deleted: false });
    listPaidInvoicesMock.mockResolvedValue(buildPaidInvoices('cus_deleted'));

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    expect(listPaidInvoicesMock).toHaveBeenCalledWith(expect.anything(), 'cus_deleted');
    expect(invoiceUpsert).toHaveBeenCalledTimes(4);
    expect(accountCas).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({
        stripeCustomerId: null,
        paymentMethodStatus: 'MISSING',
      }),
    }));
  });

  it('converges canceled state and clears only invalid customer/card snapshots after the specific invoice error', async () => {
    const canceledAt = new Date('2026-10-17T12:34:56.000Z');
    const account = buildReconciliationAccount();
    const accountUpdateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const invoiceUpsert = vi.fn();
    const auditCreate = vi.fn(async () => ({}));
    const issueUpsert = vi.fn(async () => ({}));
    const transaction = vi.fn(async (callback) => callback(tx as never));
    const tx = {
      platformBillingAccount: { updateMany: accountUpdateMany },
      platformBillingPlanChange: { count: vi.fn(async () => 0), updateMany: vi.fn(async () => ({ count: 0 })) },
      platformBillingInvoice: { upsert: invoiceUpsert },
      platformBillingAuditLog: { create: auditCreate },
      platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      platformBillingAccount: {
        findMany: vi.fn(async () => [account]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => account),
        findFirst: vi.fn(async () => ({ accessStatus: 'CANCELED' })),
      },
      platformBillingWebhookEvent: { groupBy: vi.fn(async () => []) },
      platformBillingIssue: { upsert: issueUpsert },
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: transaction,
    } as never;
    retrieveSubscriptionMock.mockResolvedValue({
      id: 'sub_a', customerId: 'cus_deleted', status: 'canceled', priceId: null,
      currentPeriodEnd: new Date('2026-10-17T00:00:00.000Z'), cancelAtPeriodEnd: false,
      trialEndsAt: null, canceledAt, pendingUpdateId: null,
    });
    retrieveCustomerMock.mockRejectedValue(makeMissingCustomerError('cus_deleted'));
    listPaidInvoicesMock.mockResolvedValue(buildPaidInvoices('cus_deleted'));

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    expect(retrieveSubscriptionMock).toHaveBeenCalledWith('sub_a');
    expect(listPaidInvoicesMock).toHaveBeenCalledWith(expect.anything(), 'cus_deleted');
    expect(transaction).toHaveBeenCalled();
    expect(accountUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'pba_a', contaId: 'conta_a', environment: 'TEST' }),
      data: expect.objectContaining({
        status: 'CANCELED', accessStatus: 'CANCELED', stripeCustomerId: null,
        canceledAt, paymentMethodStatus: 'MISSING', paymentMethodType: null,
        paymentMethodBrand: null, paymentMethodLast4: null,
        paymentMethodExpMonth: null, paymentMethodExpYear: null,
      }),
    }));
    const updateData = (accountUpdateMany.mock.calls.at(-1)?.[0] as { data?: Record<string, unknown> } | undefined)?.data;
    expect(updateData).not.toHaveProperty('planCode');
    expect(invoiceUpsert).toHaveBeenCalledTimes(4);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta_a', billingAccountId: 'pba_a',
        action: 'PLATFORM_BILLING_RECONCILIATION_CORRECTED', entityId: 'sub_a',
      }),
    }));
    expect(issueUpsert).not.toHaveBeenCalled();
  });

  it('converges canceled status and customer snapshot without a local or resolved plan code', async () => {
    const account = { ...buildReconciliationAccount(), planCode: null };
    const accountCas = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const invoiceUpsert = vi.fn();
    const prisma = buildReconciliationPrisma(account, accountCas, invoiceUpsert);
    retrieveSubscriptionMock.mockResolvedValue({ ...buildCanceledSubscription('cus_deleted'), priceId: null });
    retrieveCustomerMock.mockRejectedValue(makeMissingCustomerError('cus_deleted'));
    listPaidInvoicesMock.mockRejectedValue(makeMissingCustomerError('cus_deleted'));

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    const updateData = (accountCas.mock.calls.at(-1)?.[0] as { data?: Record<string, unknown> } | undefined)?.data;
    expect(updateData).toMatchObject({
      status: 'CANCELED', accessStatus: 'CANCELED', stripeCustomerId: null,
      paymentMethodStatus: 'MISSING', paymentMethodType: null, paymentMethodBrand: null,
      paymentMethodLast4: null, paymentMethodExpMonth: null, paymentMethodExpYear: null,
    });
    expect(updateData).not.toHaveProperty('planCode');
  });

  it('stops on conflicting local and subscription customer IDs before invoices or correction', async () => {
    const account = { ...buildReconciliationAccount(), stripeCustomerId: 'cus_local' };
    const issueUpsert = vi.fn(async () => ({}));
    const transaction = vi.fn();
    const prisma = {
      platformBillingAccount: {
        findMany: vi.fn(async () => [account]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => account),
      },
      platformBillingWebhookEvent: { groupBy: vi.fn(async () => []) },
      platformBillingIssue: { upsert: issueUpsert },
      $transaction: transaction,
    } as never;
    retrieveCustomerMock.mockClear();
    listPaidInvoicesMock.mockClear();
    retrieveSubscriptionMock.mockResolvedValue(buildCanceledSubscription('cus_other'));

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    expect(retrieveCustomerMock).not.toHaveBeenCalled();
    expect(listPaidInvoicesMock).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contaId: 'conta_a', billingAccountId: 'pba_a', environment: 'TEST',
        code: 'CUSTOMER_ID_DIVERGENT',
        title: 'Customer Stripe divergente',
        message: 'A assinatura e a conta de billing referenciam customers diferentes.',
      }),
    }));
    expect(JSON.stringify(issueUpsert.mock.calls)).not.toContain('cus_local');
    expect(JSON.stringify(issueUpsert.mock.calls)).not.toContain('cus_other');
  });

  it('keeps the divergence issue open when the correction CAS loses', async () => {
    const account = buildReconciliationAccount();
    const issueUpsert = vi.fn(async () => ({}));
    const findFirst = vi.fn(async () => ({ accessStatus: 'ACTIVE' }));
    const prisma = {
      platformBillingAccount: {
        findMany: vi.fn(async () => [account]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => account),
        findFirst,
      },
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      platformBillingWebhookEvent: { groupBy: vi.fn(async () => []) },
      platformBillingIssue: { upsert: issueUpsert },
      $transaction: vi.fn(async (callback) => callback({
        platformBillingAccount: { updateMany: vi.fn(async () => ({ count: 0 })) },
        platformBillingPlanChange: { count: vi.fn(async () => 0) },
      } as never)),
    } as never;
    retrieveSubscriptionMock.mockResolvedValue({
      id: 'sub_a', customerId: 'cus_deleted', status: 'canceled', priceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      canceledAt: null, pendingUpdateId: null,
    });
    retrieveCustomerMock.mockRejectedValue(makeMissingCustomerError('cus_deleted'));
    listPaidInvoicesMock.mockResolvedValue([]);

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'pba_a', contaId: 'conta_a', environment: 'TEST' },
      select: { accessStatus: true },
    });
    expect(issueUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contaId: 'conta_a', environment: 'TEST', code: 'ACTIVE_LOCAL_CANCELED_ON_STRIPE',
      }),
    }));
  });

  it('does not apply cancellation correction for a generic customer validation failure', async () => {
    const account = buildReconciliationAccount();
    const transaction = vi.fn();
    const prisma = {
      platformBillingAccount: {
        findMany: vi.fn(async () => [account]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUnique: vi.fn(async () => account),
        findFirst: vi.fn(async () => ({ accessStatus: 'ACTIVE' })),
      },
      platformBillingWebhookEvent: { groupBy: vi.fn(async () => []) },
      platformBillingIssue: { upsert: vi.fn(async () => ({})) },
      platformBillingPlanChange: { count: vi.fn(async () => 0) },
      $transaction: transaction,
    } as never;
    retrieveSubscriptionMock.mockResolvedValue({
      id: 'sub_a', customerId: 'cus_deleted', status: 'canceled', priceId: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      canceledAt: null, pendingUpdateId: null,
    });
    retrieveCustomerMock.mockRejectedValue(new Error('Stripe API temporarily unavailable'));

    await reconcilePlatformBilling({ prisma, contaId: 'conta_a', environment: 'TEST' });

    expect(transaction).not.toHaveBeenCalled();
  });
});

function buildReconciliationAccount() {
  const now = new Date('2026-10-25T00:00:00.000Z');
  return {
    id: 'pba_a', contaId: 'conta_a', environment: 'TEST', status: 'ACTIVE', accessStatus: 'ACTIVE',
    planCode: 'STARTER', stripeCustomerId: 'cus_deleted', stripeSubscriptionId: 'sub_a', stripePriceId: null,
    currentPeriodEnd: new Date('2026-10-17T00:00:00.000Z'), cancelAtPeriodEnd: false, trialEndsAt: null,
    canceledAt: null, gracePeriodEndsAt: null, restrictedAt: null, lastPaymentFailedAt: null,
    firstPaidAt: new Date('2026-01-01T00:00:00.000Z'), lastSuccessfulPaymentAt: new Date('2026-10-01T00:00:00.000Z'),
    paymentMethodStatus: 'PRESENT', paymentMethodType: 'card', paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242', paymentMethodExpMonth: 12, paymentMethodExpYear: 2030,
    restrictionReason: null, gracePeriodStartedAt: null, accessStateVersion: 1,
    pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
    pendingChangeOperationId: null, pendingChangeClaimToken: null, lastProviderEventCreatedAt: null,
    lastStripeEventId: null, lastReconciledAt: null, updatedAt: now, createdAt: now,
  };
}

type ReconciliationTestAccount = Omit<ReturnType<typeof buildReconciliationAccount>, 'stripePriceId' | 'stripeCustomerId' | 'planCode'> & {
  stripePriceId: string | null;
  stripeCustomerId: string | null;
  planCode: ReturnType<typeof buildReconciliationAccount>['planCode'] | null;
};

function buildReconciliationPrisma(account: ReconciliationTestAccount, accountCas: unknown, invoiceUpsert: unknown) {
  const tx = {
    platformBillingAccount: { updateMany: accountCas as never },
    platformBillingPlanChange: {
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    platformBillingInvoice: { upsert: invoiceUpsert as never },
    platformBillingAuditLog: { create: vi.fn(async () => ({})) },
    platformBillingIssue: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  return {
    platformBillingAccount: {
      findMany: vi.fn(async () => [account]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => account),
      findFirst: vi.fn(async () => ({ accessStatus: 'CANCELED' })),
    },
    platformBillingWebhookEvent: { groupBy: vi.fn(async () => []) },
    platformBillingIssue: { upsert: vi.fn(async () => ({})) },
    platformBillingPlanChange: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (callback) => callback(tx as never)),
  } as never;
}

function buildCanceledSubscription(customerId: string) {
  return {
    id: 'sub_a', customerId, status: 'canceled', priceId: null,
    currentPeriodEnd: new Date('2026-10-17T00:00:00.000Z'), cancelAtPeriodEnd: false,
    trialEndsAt: null, canceledAt: new Date('2026-10-17T12:34:56.000Z'), pendingUpdateId: null,
  };
}

function makeMissingCustomerError(customerId: string) {
  return Object.assign(new Error(`No such customer: '${customerId}'`), {
    type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'customer', statusCode: 400,
  });
}

function buildPaidInvoices(customerId: string) {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `in_${index + 1}`, customerId, subscriptionId: 'sub_a', priceId: null,
    number: `INV-${index + 1}`, status: 'paid', amountDue: 1000, amountPaid: 1000,
    currency: 'brl', hostedInvoiceUrl: null, invoicePdf: null,
    periodStart: null, periodEnd: null, dueDate: null,
    paidAt: new Date(`2026-0${index + 1}-01T00:00:00.000Z`),
    createdAt: new Date(`2026-0${index + 1}-01T00:00:00.000Z`),
    attempted: true, attemptCount: 1, nextPaymentAttempt: null,
    lastPaymentErrorCode: null, lastPaymentErrorMessage: null, raw: {},
  }));
}
