import { describe, expect, it } from 'vitest';
import type { StripeWebhookEvent } from '@alusa/stripe';
import {
  processPlatformBillingWebhookEvent,
  derivePlatformAccessStatus,
  processPersistedPlatformBillingWebhookEvent,
  type PlatformBillingAccountRecord,
  type PlatformBillingAuditLogInput,
  type PlatformBillingCheckoutSessionRecord,
  type PlatformBillingInvoiceRecord,
  type PlatformBillingStore,
  type PlatformBillingWebhookEventRecord,
} from '../src';

const envSource = {
  STRIPE_ENVIRONMENT: 'TEST',
  STRIPE_SECRET_KEY: 'sk_test_foundation',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
  STRIPE_PRICE_BAND_026_050_MONTHLY: 'price_band_026_050',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
};
let nextStripeEventCreated = 1_800_000_001;

describe('@alusa/platform-billing webhooks', () => {
  it('ignores optional trial-card Setup Checkout without binding a subscription or granting access', async () => {
    const store = createMemoryStore([buildAccount({
      id: 'pba_setup', contaId: 'conta_1', status: 'TRIALING', accessStatus: 'TRIALING',
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_trial',
    })]);
    const result = await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_setup_trial_card', 'checkout.session.completed', {
        id: 'cs_setup', mode: 'setup', customer: 'cus_1', subscription: null,
        metadata: { contaId: 'conta_1', billingContext: 'platform', checkoutPurpose: 'optional_trial_payment_method' },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(result.status).toBe('ignored');
    expect(store.accounts[0]).toMatchObject({ status: 'TRIALING', accessStatus: 'TRIALING', stripeSubscriptionId: 'sub_trial' });
    expect(store.paidIssueResolutions).toEqual([]);
  });

  it('rejects cross-Conta subscription metadata and leaves both tenant accounts unchanged', async () => {
    const store = createMemoryStore([
      buildAccount({ id: 'pba_a', contaId: 'conta_a', status: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test' }),
      buildAccount({ id: 'pba_b', contaId: 'conta_b', status: 'PAST_DUE', planCode: 'PREMIUM', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b', stripePriceId: 'price_premium_test' }),
    ]);
    const before = structuredClone(store.accounts);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_cross_conta_subscription', 'customer.subscription.updated', {
        id: 'sub_a', customer: 'cus_a', status: 'active', cancel_at_period_end: false,
        metadata: { contaId: 'conta_b' }, items: { data: [{ price: { id: 'price_pro_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(store.accounts).toEqual(before);
  });

  it('accepts a custom invitation Price only when it matches the account bound Price', async () => {
    const custom = 'price_custom_invitation';
    const store = createMemoryStore([buildAccount({
      status: 'TRIALING', accessStatus: 'ACTIVE', planCode: 'CUSTOM', stripeCustomerId: 'cus_custom',
      stripeSubscriptionId: 'sub_custom', stripePriceId: custom,
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_custom_trial_update', 'customer.subscription.updated', {
        id: 'sub_custom', customer: 'cus_custom', status: 'trialing', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'CUSTOM', conditionType: 'custom' },
        items: { data: [{ price: { id: custom } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ planCode: 'CUSTOM', stripePriceId: custom, status: 'TRIALING', accessStatus: 'ACTIVE' });

    const unrelated = createMemoryStore([buildAccount({
      status: 'TRIALING', accessStatus: 'ACTIVE', planCode: 'CUSTOM', stripeCustomerId: 'cus_custom',
      stripeSubscriptionId: 'sub_custom', stripePriceId: custom,
    })]);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_custom_wrong_price', 'customer.subscription.updated', {
        id: 'sub_custom', customer: 'cus_custom', status: 'trialing', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'CUSTOM' },
        items: { data: [{ price: { id: 'price_other_custom' } }] },
      }),
      environment: 'TEST', envSource,
    }, unrelated)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(unrelated.accounts[0]?.stripePriceId).toBe(custom);
  });

  it('rejects cross-Conta checkout metadata without changing either account', async () => {
    const store = createMemoryStore([
      buildAccount({ id: 'pba_a', contaId: 'conta_a', status: 'PAST_DUE', accessStatus: 'RESTRICTED', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a' }),
      buildAccount({ id: 'pba_b', contaId: 'conta_b', status: 'ACTIVE', accessStatus: 'ACTIVE', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b' }),
    ]);
    const before = structuredClone(store.accounts);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_cross_conta_checkout', 'checkout.session.completed', {
        id: 'cs_cross', customer: 'cus_a', subscription: 'sub_a', payment_status: 'paid',
        metadata: { contaId: 'conta_b' },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(store.accounts).toEqual(before);
  });

  it('rejects cross-Conta invoice metadata without changing either account or invoice history', async () => {
    const store = createMemoryStore([
      buildAccount({ id: 'pba_a', contaId: 'conta_a', status: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test' }),
      buildAccount({ id: 'pba_b', contaId: 'conta_b', status: 'PAST_DUE', planCode: 'PREMIUM', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b', stripePriceId: 'price_premium_test' }),
    ]);
    const before = structuredClone(store.accounts);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_cross_conta_invoice', 'invoice.paid', {
        id: 'in_cross', customer: 'cus_a', subscription: 'sub_a', status: 'paid',
        amount_due: 1000, amount_paid: 1000, currency: 'brl',
        metadata: { contaId: 'conta_b' },
        lines: { data: [{ pricing: { price_details: { price: 'price_starter_test' } } }] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(store.accounts).toEqual(before);
    expect(store.invoices).toEqual([]);
  });

  it('rejects invoice customer mismatch from bound subscription even without metadata before any persistence', async () => {
    const store = createMemoryStore([
      buildAccount({ id: 'pba_a', contaId: 'conta_a', status: 'PAST_DUE', accessStatus: 'RESTRICTED', stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test' }),
      buildAccount({ id: 'pba_b', contaId: 'conta_b', status: 'ACTIVE', accessStatus: 'ACTIVE', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_b' }),
    ]);
    const before = structuredClone(store.accounts);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invoice_customer_mismatch', 'invoice.payment_failed', {
        id: 'in_wrong_customer', customer: 'cus_b', subscription: 'sub_a', status: 'open',
        amount_due: 22900, amount_paid: 0, currency: 'brl',
        lines: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });

    expect(store.accounts).toEqual(before);
    expect(store.invoices).toEqual([]);
    expect(store.auditLogs).toEqual([]);
  });

  it('rejects invoice with id and subscription but missing customer before persistence or account changes', async () => {
    const store = createMemoryStore([buildAccount({
      id: 'pba_a', contaId: 'conta_a', status: 'PAST_DUE', accessStatus: 'RESTRICTED',
      stripeCustomerId: 'cus_a', stripeSubscriptionId: 'sub_a', stripePriceId: 'price_starter_test',
    })]);
    const before = structuredClone(store.accounts);

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invoice_missing_customer', 'invoice.payment_failed', {
        id: 'in_missing_customer', subscription: 'sub_a', status: 'open',
        amount_due: 22900, amount_paid: 0, currency: 'brl',
        lines: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });

    expect(store.accounts).toEqual(before);
    expect(store.invoices).toEqual([]);
    expect(store.auditLogs).toEqual([]);
  });

  it('finalizes a plan change when a canonical subscription update confirms the target price', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'pbc_owner',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_subscription_target_confirmed', 'customer.subscription.updated', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1' },
        items: { data: [{ price: { id: 'price_premium_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ planCode: 'PREMIUM', stripePriceId: 'price_premium_test', pendingPlanCode: null });
    expect(store.planChangeFinalizations).toEqual([expect.objectContaining({
      planChangeId: 'pbc_owner', contaId: 'conta_1', billingAccountId: 'pba_1',
      environment: 'TEST', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium_test', applied: true,
    })]);
  });

  it('uses Stripe canonical subscription state for equal-second events in either delivery order', async () => {
    const created = 1_800_000_000;
    const eventA = stripeEvent('evt_same_a', 'customer.subscription.updated', {
      id: 'sub_tie', customer: 'cus_tie', status: 'canceled', cancel_at_period_end: false,
      canceled_at: created, metadata: { contaId: 'conta_1' },
      items: { data: [{ price: { id: 'price_starter_test' } }] },
    }, created);
    const eventZ = stripeEvent('evt_same_z', 'customer.subscription.updated', {
      id: 'sub_tie', customer: 'cus_tie', status: 'active', cancel_at_period_end: false,
      canceled_at: null, metadata: { contaId: 'conta_1' },
      items: { data: [{ price: { id: 'price_premium_test' } }] },
    }, created);
    let retrievals = 0;
    const stripeGateway = {
      retrieveSubscription: async () => {
        retrievals += 1;
        return {
        id: 'sub_tie', customerId: 'cus_tie', status: 'active', priceId: 'price_premium_test',
        currentPeriodEnd: new Date(created * 1000 + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null, pendingUpdateId: null,
        };
      },
      retrieveSubscriptionSnapshot: async () => ({
        id: 'sub_tie', customerId: 'cus_tie', status: 'active', livemode: false,
        metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'PREMIUM' },
        priceIds: ['price_premium_test'],
        currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
      }),
    };

    for (const events of [[eventA, eventZ], [eventZ, eventA]]) {
      const store = createMemoryStore([buildAccount({
        id: 'pba_tie', contaId: 'conta_1', status: 'ACTIVE', accessStatus: 'ACTIVE',
        planCode: 'STARTER', stripeCustomerId: 'cus_tie', stripeSubscriptionId: 'sub_tie',
        stripePriceId: 'price_starter_test',
      })]);
      for (const event of events) {
        await processPlatformBillingWebhookEvent({
          event, environment: 'TEST', envSource, stripeGateway,
        }, store);
      }
      expect(store.accounts[0]).toMatchObject({
        status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'PREMIUM',
        stripePriceId: 'price_premium_test', cancelAtPeriodEnd: false,
      });
    }
    expect(retrievals).toBe(2);
  });

  it('finalizes only the operation that owns the account when two changes target the same price', async () => {
    const store = createMemoryStore([buildAccount({
      id: 'pba_1', contaId: 'conta_1', status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER',
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
      pendingPlanCode: 'PREMIUM', pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'pbc_winner',
    })]);
    const losingOperationId = 'pbc_loser';

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_two_same_target', 'customer.subscription.pending_update_applied', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1', planChangeId: 'pbc_winner' },
        items: { data: [{ price: { id: 'price_premium_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);

    expect(store.accounts[0]).toMatchObject({ planCode: 'PREMIUM', pendingPlanCode: null });
    expect(store.planChangeFinalizations).toEqual([expect.objectContaining({
      planChangeId: 'pbc_winner', contaId: 'conta_1', billingAccountId: 'pba_1',
      stripeSubscriptionId: 'sub_1', applied: true,
    })]);
    expect(store.planChangeFinalizations.some((operation) => operation.planChangeId === losingOperationId)).toBe(false);
  });

  it('retries atomically when plan-change finalization fails before commit', async () => {
    const store = createMemoryStore([buildAccount({
      id: 'pba_1', contaId: 'conta_1', status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER',
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
      pendingPlanCode: 'PREMIUM', pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'pbc_retry',
    })]);
    const account = store.accounts[0]!;
    const update = store.updateAccountFromStripeSubscription.bind(store);
    let failOnce = true;
    store.updateAccountFromStripeSubscription = async (input) => {
      if (input.planChangeFinalization && failOnce) {
        failOnce = false;
        throw new Error('plan-change transaction failed');
      }
      return update(input);
    };
    const event = stripeEvent('evt_atomic_finalize_retry', 'customer.subscription.updated', {
      id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
      pending_update: null, metadata: { contaId: 'conta_1', planChangeId: 'pbc_retry' },
      items: { data: [{ price: { id: 'price_premium_test' } }] },
    });

    await expect(processPlatformBillingWebhookEvent({ event, environment: 'TEST', envSource }, store))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED' });
    expect(account).toMatchObject({
      planCode: 'STARTER', pendingPlanCode: 'PREMIUM', pendingChangeOperationId: 'pbc_retry',
    });
    expect(store.planChangeFinalizations).toEqual([]);

    const inboxId = store.webhookEvents[0]!.id;
    await store.markWebhookEventProcessing({ id: inboxId, contaId: 'conta_1' });
    await processPersistedPlatformBillingWebhookEvent({
      event, environment: 'TEST', envSource, inboxId,
    }, store);
    expect(account).toMatchObject({ planCode: 'PREMIUM', pendingPlanCode: null, pendingChangeOperationId: null });
    expect(store.planChangeFinalizations).toEqual([expect.objectContaining({ planChangeId: 'pbc_retry', applied: true })]);
  });

  it('keeps the pending downgrade claim when the subscription price is not the configured target price', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'DOWNGRADE', pendingChangeOperationId: 'pbc_1',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_wrong_target_price', 'customer.subscription.updated', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1' },
        items: { data: [{ price: { id: 'price_pro_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ pendingPlanCode: 'PREMIUM', pendingChangeOperationId: 'pbc_1' });
    expect(store.planChangeFinalizations).toEqual([]);
  });

  it('does not let an old subscription snapshot clear a newer plan-change claim', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'DOWNGRADE', pendingChangeOperationId: 'pbc_old',
    })]);
    const account = store.accounts[0]!;
    const update = store.updateAccountFromStripeSubscription.bind(store);
    store.updateAccountFromStripeSubscription = async (input) => {
      account.pendingPlanCode = 'PRO';
      account.pendingChangeOperationId = 'pbc_new';
      account.pendingChangeClaimToken = 'claim_new';
      return update(input);
    };
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_old_plan_snapshot', 'customer.subscription.updated', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1' },
        items: { data: [{ price: { id: 'price_premium_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED' });
    expect(account).toMatchObject({ pendingPlanCode: 'PRO', pendingChangeOperationId: 'pbc_new', pendingChangeClaimToken: 'claim_new' });
    expect(store.planChangeFinalizations).toEqual([]);
  });

  it('does not finalize a plan change from a stale pending_update_applied event rejected by account CAS', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'UPGRADE', lastProviderEventCreatedAt: new Date(1_800_000_000 * 1000),
    })]);
    const account = store.accounts[0]!;
    const originalUpdate = store.updateAccountFromStripeSubscription.bind(store);
    store.updateAccountFromStripeSubscription = async (input) => {
      if (input.lastProviderEventCreatedAt && account.lastProviderEventCreatedAt
        && account.lastProviderEventCreatedAt > input.lastProviderEventCreatedAt) return account;
      return originalUpdate(input);
    };
    await processPlatformBillingWebhookEvent({
      event: {
        ...stripeEvent('evt_old_pending_applied', 'customer.subscription.pending_update_applied', {
          id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
          pending_update: null, metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_starter_test' } }] },
        }),
        created: 1_700_000_000,
      } as StripeWebhookEvent,
      environment: 'TEST', envSource,
    }, store);
    expect(account).toMatchObject({ planCode: 'STARTER', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM' });
    expect(store.planChangeFinalizations).toEqual([]);
  });

  it.each(['unpaid', 'no_payment_required'])('checkout completion with payment_status=%s does not resolve payment issues', async (paymentStatus) => {
    const store = createMemoryStore([buildAccount({
      status: 'PAST_DUE', accessStatus: 'RESTRICTED', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_checkout_trial', 'checkout.session.completed', {
        id: 'cs_trial', customer: 'cus_1', subscription: 'sub_1', payment_status: paymentStatus,
        metadata: { contaId: 'conta_1' },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]?.accessStatus).toBe('RESTRICTED');
    expect(store.paidIssueResolutions).toEqual([]);
  });

  it('binds the Checkout subscription for reconciliation without granting access', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null, pendingPlanCode: 'STARTER', checkoutClaimKey: 'checkout-key',
    })]);
    addCheckoutSession(store, { idempotencyKey: 'checkout-key', planCode: 'STARTER', stripeCustomerId: 'cus_1', stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_bind' });
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_checkout_bind', 'checkout.session.completed', {
        id: 'cs_bind', customer: 'cus_1', subscription: 'sub_checkout', payment_status: 'unpaid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'checkout-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_bind', requestKey: 'checkout-key', customerId: 'cus_1', subscriptionId: 'sub_checkout', contaId: 'conta_1',
        planCode: 'STARTER', priceId: 'price_starter_test', subscriptionStatus: 'incomplete', invoice: null,
      }),
    }, store);
    expect(store.accounts[0]).toMatchObject({
      stripeSubscriptionId: 'sub_checkout', status: 'CHECKOUT_PENDING', accessStatus: 'PENDING',
    });
    expect(store.checkoutSessions[0]?.status).toBe('COMPLETED');

    // A distinct Stripe event can redeliver the same completed Checkout; the
    // local status remains completed and the webhook can finish idempotently.
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_checkout_bind_redelivery', 'checkout.session.completed', {
        id: 'cs_bind', customer: 'cus_1', subscription: 'sub_checkout', payment_status: 'unpaid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'checkout-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_bind', requestKey: 'checkout-key', customerId: 'cus_1', subscriptionId: 'sub_checkout', contaId: 'conta_1',
        planCode: 'STARTER', priceId: 'price_starter_test', subscriptionStatus: 'incomplete', invoice: null,
      }),
    }, store);
    expect(store.checkoutSessions[0]?.status).toBe('COMPLETED');
  });

  it('keeps checkout completion retryable when its metadata request key has no local session', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeCustomerId: 'cus_missing_local',
      stripeSubscriptionId: null, pendingPlanCode: 'STARTER', checkoutClaimKey: 'missing-local-key',
    })]);

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_checkout_missing_local', 'checkout.session.completed', {
        id: 'cs_missing_local', customer: 'cus_missing_local', subscription: 'sub_missing_local',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'missing-local-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_missing_local', requestKey: 'missing-local-key', customerId: 'cus_missing_local',
        subscriptionId: 'sub_missing_local', contaId: 'conta_1', planCode: 'STARTER',
        priceId: 'price_starter_test', subscriptionStatus: 'incomplete', invoice: null,
      }),
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED' });

    expect(store.webhookEvents[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(store.accounts[0]).toMatchObject({ status: 'CHECKOUT_PENDING', stripeSubscriptionId: null });
    expect(store.checkoutSessions).toEqual([]);
  });

  it('keeps a new price-band checkout pending until a paid invoice webhook confirms activation', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeCustomerId: 'cus_band',
      stripeSubscriptionId: null, stripePriceId: null, planCode: null, pendingPlanCode: 'BAND_026_050', checkoutClaimKey: 'checkout_band_key',
    })]);
    addCheckoutSession(store, { idempotencyKey: 'checkout_band_key', planCode: 'BAND_026_050', stripeCustomerId: 'cus_band', stripePriceId: 'price_band_026_050', stripeCheckoutSessionId: 'cs_band' });
    const bandPrices = { ...envSource, STRIPE_PRICE_BAND_026_050_MONTHLY: 'price_band_026_050' };

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_band_checkout_unpaid', 'checkout.session.completed', {
        id: 'cs_band', customer: 'cus_band', subscription: 'sub_band', payment_status: 'unpaid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'checkout_band_key' },
      }),
      environment: 'TEST', envSource: bandPrices,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_band', requestKey: 'checkout_band_key', customerId: 'cus_band', subscriptionId: 'sub_band', contaId: 'conta_1',
        planCode: 'BAND_026_050', priceId: 'price_band_026_050', subscriptionStatus: 'incomplete', invoice: null,
      }),
    }, store);
    expect(store.accounts[0]).toMatchObject({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: null,
      pendingPlanCode: 'BAND_026_050', stripeSubscriptionId: 'sub_band',
    });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_band_invoice_paid', 'invoice.paid', {
        id: 'in_band', customer: 'cus_band', subscription: 'sub_band', status: 'paid',
        amount_due: 22900, amount_paid: 22900, currency: 'brl',
        status_transitions: { paid_at: 1_800_000_100 },
        lines: { data: [{ price: { id: 'price_band_026_050' } }] },
      }),
      environment: 'TEST', envSource: bandPrices,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_band', requestKey: 'checkout_band_key', customerId: 'cus_band', subscriptionId: 'sub_band',
        contaId: 'conta_1', planCode: 'BAND_026_050', priceId: 'price_band_026_050', subscriptionStatus: 'active', invoice: null,
      }),
    }, store);

    expect(store.accounts[0]).toMatchObject({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'BAND_026_050',
      stripePriceId: 'price_band_026_050', firstPaidAt: expect.any(Date),
    });
  });

  it('keeps a reactivation with prior paid history restricted until its new invoice is paid', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CANCELED', accessStatus: 'CANCELED', planCode: 'STARTER',
      stripeCustomerId: 'cus_reactivation_history', stripeSubscriptionId: 'sub_reactivation_history',
      stripePriceId: 'price_band_026_050', pendingPlanCode: 'BAND_026_050', pendingChangeType: 'REACTIVATE',
      firstPaidAt: new Date('2025-10-01T00:00:00.000Z'),
      lastSuccessfulPaymentAt: new Date('2026-10-01T00:00:00.000Z'),
    })]);

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_history_active', 'customer.subscription.updated', {
        id: 'sub_reactivation_history', customer: 'cus_reactivation_history', status: 'active', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', planCode: 'BAND_026_050', billingContext: 'platform', flow: 'reactivation' },
        items: { data: [{ price: { id: 'price_band_026_050' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);

    expect(store.accounts[0]).toMatchObject({
      status: 'CANCELED', accessStatus: 'CANCELED', pendingChangeType: 'REACTIVATE',
      firstPaidAt: new Date('2025-10-01T00:00:00.000Z'),
      lastSuccessfulPaymentAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('reactivates an expired paused unpaid trial only after Checkout binds the new subscription and its invoice is paid', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'PAUSED', accessStatus: 'RESTRICTED', planCode: 'STARTER',
      stripeCustomerId: 'cus_reactivated', stripeSubscriptionId: 'sub_old', stripePriceId: 'price_starter_test',
      trialEndsAt: new Date('2026-10-25T00:00:00.000Z'),
      canceledAt: null, restrictedAt: new Date('2026-10-25T00:00:00.000Z'),
      pendingPlanCode: 'BAND_026_050', pendingChangeType: 'REACTIVATE',
      pendingChangeEffectiveAt: new Date('2026-10-26T00:00:00.000Z'), pendingChangeOperationId: 'reactivation-operation',
      checkoutClaimKey: 'request-reactivation', checkoutClaimPhase: 'REQUESTING',
    })]);
    addCheckoutSession(store, { idempotencyKey: 'request-reactivation', planCode: 'BAND_026_050', stripeCustomerId: 'cus_reactivated', stripePriceId: 'price_band_026_050', stripeCheckoutSessionId: 'cs_reactivation' });
    const earlyPaidInvoice = stripeEvent('evt_reactivation_invoice_paid', 'invoice.paid', paidInvoice({
      id: 'in_reactivation', customer: 'cus_reactivated', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 22900,
    }));
    await expect(processPlatformBillingWebhookEvent({ event: earlyPaidInvoice, environment: 'TEST', envSource }, store))
      .rejects.toMatchObject({ code: 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND' });
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_subscription_first', 'customer.subscription.created', {
        id: 'sub_new', customer: 'cus_reactivated', status: 'active', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', planCode: 'BAND_026_050', billingContext: 'platform', flow: 'reactivation', checkoutRequestKey: 'request-reactivation', reactivationFromSubscriptionId: 'sub_old', reactivationFromPlanCode: 'STARTER', reactivationFromPriceId: 'price_starter_test' },
        items: { data: [{ price: { id: 'price_band_026_050' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'PAUSED', stripeSubscriptionId: 'sub_old' });

    let oldSubscriptionStatus = 'paused';
    const reactivationGateway = checkoutGateway({
      sessionId: 'cs_reactivation', requestKey: 'request-reactivation', customerId: 'cus_reactivated', subscriptionId: 'sub_new', contaId: 'conta_1',
      planCode: 'BAND_026_050', priceId: 'price_band_026_050', subscriptionStatus: 'active', invoice: null,
      reactivationOrigin: { subscriptionId: 'sub_old', planCode: 'STARTER', priceId: 'price_starter_test' },
    });
    const cancelOldSubscription = vi.fn(async (id: string) => {
      if (id === 'sub_old') oldSubscriptionStatus = 'canceled';
    });
    reactivationGateway.listCustomerSubscriptions = async (customerId: string) => ({
      complete: true,
      subscriptions: [
        {
          id: 'sub_old', customerId, status: oldSubscriptionStatus, livemode: false,
          metadata: { contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform' }, priceIds: ['price_starter_test'],
        },
        {
          id: 'sub_new', customerId, status: 'active', livemode: false,
          metadata: {
            contaId: 'conta_1', planCode: 'BAND_026_050', billingContext: 'platform', flow: 'reactivation',
            checkoutRequestKey: 'request-reactivation', reactivationFromSubscriptionId: 'sub_old',
            reactivationFromPlanCode: 'STARTER', reactivationFromPriceId: 'price_starter_test',
          }, priceIds: ['price_band_026_050'],
        },
        {
          id: 'sub_other_tenant', customerId, status: 'paused', livemode: false,
          metadata: { contaId: 'conta_2', planCode: 'STARTER', billingContext: 'platform' }, priceIds: ['price_starter_test'],
        },
        {
          id: 'sub_other_environment', customerId, status: 'paused', livemode: true,
          metadata: { contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform' }, priceIds: ['price_starter_test'],
        },
      ],
    });
    reactivationGateway.cancelSubscription = cancelOldSubscription;

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_checkout_bound', 'checkout.session.completed', {
        id: 'cs_reactivation', customer: 'cus_reactivated', subscription: 'sub_new', payment_status: 'paid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'request-reactivation' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: reactivationGateway,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'PAUSED', stripeSubscriptionId: 'sub_new', pendingChangeType: 'REACTIVATE' });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_subscription_active_before_invoice', 'customer.subscription.updated', {
        id: 'sub_new', customer: 'cus_reactivated', status: 'active', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', planCode: 'BAND_026_050', billingContext: 'platform', flow: 'reactivation', checkoutRequestKey: 'request-reactivation', reactivationFromSubscriptionId: 'sub_old', reactivationFromPlanCode: 'STARTER', reactivationFromPriceId: 'price_starter_test' },
        items: { data: [{ price: { id: 'price_band_026_050' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'PAUSED', accessStatus: 'RESTRICTED', planCode: 'STARTER', pendingChangeType: 'REACTIVATE' });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_zero_invoice', 'invoice.paid', {
        ...paidInvoice({ id: 'in_reactivation_zero', customer: 'cus_reactivated', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 0 }),
        status: 'paid',
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'PAUSED', accessStatus: 'RESTRICTED', firstPaidAt: null, pendingChangeType: 'REACTIVATE' });

    const failedReactivationInvoice = paidInvoice({ id: 'in_reactivation_failed', customer: 'cus_reactivated', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 0 });
    failedReactivationInvoice.status = 'open';
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_failed_invoice', 'invoice.payment_failed', failedReactivationInvoice),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'PAUSED', accessStatus: 'RESTRICTED', firstPaidAt: null, pendingChangeType: 'REACTIVATE' });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_paid_after_active', 'invoice.paid', paidInvoice({
        id: 'in_reactivation', customer: 'cus_reactivated', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 22900,
      })),
      environment: 'TEST', envSource,
      stripeGateway: reactivationGateway,
    }, store);

    expect(store.accounts[0]).toMatchObject({
      status: 'ACTIVE', accessStatus: 'ACTIVE', stripeSubscriptionId: 'sub_new', planCode: 'BAND_026_050',
      pendingPlanCode: null, pendingChangeType: null, pendingChangeEffectiveAt: null,
      pendingChangeOperationId: null, pendingChangeClaimToken: null, checkoutClaimKey: null,
      checkoutClaimPhase: null, canceledAt: null, restrictedAt: null,
      currentPeriodEnd: new Date('2026-11-26T00:00:00.000Z'), cancelAtPeriodEnd: false,
    });
    expect(store.accounts[0]?.firstPaidAt).toBeInstanceOf(Date);
    expect(store.accounts[0]?.lastSuccessfulPaymentAt).toBeInstanceOf(Date);
    expect(store.invoices.find((invoice) => invoice.stripeInvoiceId === 'in_reactivation'))
      .toMatchObject({ status: 'PAID', amountPaid: 22900, stripeSubscriptionId: 'sub_new' });
    expect(cancelOldSubscription).toHaveBeenCalledWith('sub_old', 'platform-reactivation-cleanup:pba_1:sub_old');
    expect(cancelOldSubscription).not.toHaveBeenCalledWith('sub_other_tenant', expect.anything());
    expect(cancelOldSubscription).not.toHaveBeenCalledWith('sub_other_environment', expect.anything());
    expect(oldSubscriptionStatus).toBe('canceled');

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_old_trial_pause_late', 'customer.subscription.updated', {
        id: 'sub_old', customer: 'cus_reactivated', status: 'paused', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform' },
        items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', accessStatus: 'ACTIVE', stripeSubscriptionId: 'sub_new' });

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_reactivation_checkout_bound', 'checkout.session.completed', {
        id: 'cs_reactivation', customer: 'cus_reactivated', subscription: 'sub_new', payment_status: 'paid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'request-reactivation' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_reactivation', customerId: 'cus_reactivated', subscriptionId: 'sub_new', contaId: 'conta_1',
        planCode: 'BAND_026_050', priceId: 'price_band_026_050', subscriptionStatus: 'active', invoice: null,
        reactivationOrigin: { subscriptionId: 'sub_old', planCode: 'STARTER', priceId: 'price_starter_test' },
      }),
    }, store)).resolves.toMatchObject({ status: 'duplicate' });
    expect(store.invoices).toHaveLength(3);

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_old_subscription_late_cancel', 'customer.subscription.deleted', {
        id: 'sub_old', customer: 'cus_reactivated', status: 'canceled', canceled_at: 1_800_000_000,
        metadata: { contaId: 'conta_1', billingContext: 'platform' },
        items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', stripeSubscriptionId: 'sub_new' });
  });

  it('keeps reactivation restricted when the paid subscription has no persisted lineage metadata', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'PAUSED', accessStatus: 'RESTRICTED', planCode: 'STARTER',
      stripeCustomerId: 'cus_missing_lineage', stripeSubscriptionId: 'sub_new', stripePriceId: 'price_starter_test',
      pendingPlanCode: 'BAND_026_050', pendingChangeType: 'REACTIVATE',
    })]);
    addCheckoutSession(store, {
      idempotencyKey: 'missing-lineage-key', planCode: 'BAND_026_050', stripeCustomerId: 'cus_missing_lineage',
      stripePriceId: 'price_band_026_050', stripeCheckoutSessionId: 'cs_missing_lineage',
    });
    const gateway = checkoutGateway({
      sessionId: 'cs_missing_lineage', requestKey: 'missing-lineage-key', customerId: 'cus_missing_lineage',
      subscriptionId: 'sub_new', contaId: 'conta_1', planCode: 'BAND_026_050', priceId: 'price_band_026_050',
      subscriptionStatus: 'active', invoice: null,
    });
    const cancel = vi.fn(async () => undefined);
    gateway.cancelSubscription = cancel;

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_missing_lineage_paid', 'invoice.paid', paidInvoice({
        id: 'in_missing_lineage', customer: 'cus_missing_lineage', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 22900,
      })),
      environment: 'TEST', envSource, stripeGateway: gateway,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED' });

    expect(store.accounts[0]).toMatchObject({
      status: 'PAUSED', accessStatus: 'RESTRICTED', pendingChangeType: 'REACTIVATE', firstPaidAt: null,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not clear reactivation when lineage points to a different old subscription', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'PAUSED', accessStatus: 'RESTRICTED', planCode: 'STARTER',
      stripeCustomerId: 'cus_invalid_lineage', stripeSubscriptionId: 'sub_new', stripePriceId: 'price_starter_test',
      pendingPlanCode: 'BAND_026_050', pendingChangeType: 'REACTIVATE',
    })]);
    addCheckoutSession(store, {
      idempotencyKey: 'invalid-lineage-key', planCode: 'BAND_026_050', stripeCustomerId: 'cus_invalid_lineage',
      stripePriceId: 'price_band_026_050', stripeCheckoutSessionId: 'cs_invalid_lineage',
    });
    const gateway = checkoutGateway({
      sessionId: 'cs_invalid_lineage', requestKey: 'invalid-lineage-key', customerId: 'cus_invalid_lineage',
      subscriptionId: 'sub_new', contaId: 'conta_1', planCode: 'BAND_026_050', priceId: 'price_band_026_050',
      subscriptionStatus: 'active', invoice: null,
      reactivationOrigin: { subscriptionId: 'sub_wrong', planCode: 'STARTER', priceId: 'price_starter_test' },
    });
    const cancel = vi.fn(async () => undefined);
    gateway.cancelSubscription = cancel;
    gateway.listCustomerSubscriptions = async (customerId: string) => ({
      complete: true,
      subscriptions: [
        { id: 'sub_old', customerId, status: 'paused', livemode: false, metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'STARTER' }, priceIds: ['price_starter_test'] },
        { id: 'sub_new', customerId, status: 'active', livemode: false, metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'BAND_026_050', flow: 'reactivation', checkoutRequestKey: 'invalid-lineage-key', reactivationFromSubscriptionId: 'sub_wrong', reactivationFromPlanCode: 'STARTER', reactivationFromPriceId: 'price_starter_test' }, priceIds: ['price_band_026_050'] },
      ],
    });

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invalid_lineage_paid', 'invoice.paid', paidInvoice({
        id: 'in_invalid_lineage', customer: 'cus_invalid_lineage', subscription: 'sub_new', priceId: 'price_band_026_050', amountPaid: 22900,
      })),
      environment: 'TEST', envSource, stripeGateway: gateway,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });

    expect(store.accounts[0]).toMatchObject({
      status: 'PAUSED', accessStatus: 'RESTRICTED', pendingChangeType: 'REACTIVATE', firstPaidAt: null,
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps a canceled current subscription canceled when a delayed invoice is paid', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CANCELED', accessStatus: 'CANCELED', planCode: 'STARTER',
      stripeCustomerId: 'cus_canceled', stripeSubscriptionId: 'sub_canceled', stripePriceId: 'price_starter_test',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_late_paid_after_cancel', 'invoice.paid', {
        id: 'in_late_paid', customer: 'cus_canceled', subscription: 'sub_canceled', status: 'paid',
        amount_due: 14900, amount_paid: 14900, currency: 'brl',
        lines: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
      stripeGateway: {
        retrieveSubscription: async () => ({
          id: 'sub_canceled', customerId: 'cus_canceled', status: 'canceled', priceId: 'price_starter_test',
          currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
        }),
        retrieveSubscriptionSnapshot: async () => ({
          id: 'sub_canceled', customerId: 'cus_canceled', status: 'canceled', livemode: false,
          metadata: { contaId: 'conta_1', billingContext: 'platform', planCode: 'STARTER' },
          priceIds: ['price_starter_test'],
          currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: null,
        }),
      },
    }, store);

    expect(store.accounts[0]).toMatchObject({ status: 'CANCELED', accessStatus: 'CANCELED' });
  });

  it('does not let a late completion for an old Checkout replace a current active subscription', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'PREMIUM', stripeCustomerId: 'cus_late',
      stripeSubscriptionId: 'sub_current', stripePriceId: 'price_premium_test', checkoutClaimKey: null,
    })]);
    addCheckoutSession(store, { idempotencyKey: 'old-checkout-key', planCode: 'STARTER', stripeCustomerId: 'cus_late', stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_old' });
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_old_checkout_late', 'checkout.session.completed', {
        id: 'cs_old', customer: 'cus_late', subscription: 'sub_old',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'old-checkout-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_old', requestKey: 'old-checkout-key', customerId: 'cus_late', subscriptionId: 'sub_old', contaId: 'conta_1',
        planCode: 'STARTER', priceId: 'price_starter_test', subscriptionStatus: 'active', invoice: null,
      }),
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', planCode: 'PREMIUM', stripeSubscriptionId: 'sub_current' });
  });

  it('does not activate a canceled account from Checkout completion when the canonical latest invoice is unpaid', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CANCELED', accessStatus: 'CANCELED', planCode: 'STARTER', stripeCustomerId: 'cus_unpaid_checkout',
      stripeSubscriptionId: 'sub_old_unpaid', stripePriceId: 'price_starter_test', pendingPlanCode: 'STARTER',
      pendingChangeType: 'REACTIVATE', checkoutClaimKey: 'unpaid-checkout-key',
    })]);
    addCheckoutSession(store, { idempotencyKey: 'unpaid-checkout-key', planCode: 'STARTER', stripeCustomerId: 'cus_unpaid_checkout', stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_unpaid' });
    const unpaid = paidInvoice({ id: 'in_unpaid', customer: 'cus_unpaid_checkout', subscription: 'sub_unpaid', priceId: 'price_starter_test' });
    unpaid.status = 'open';
    unpaid.amount_paid = 0;
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_unpaid_checkout_completion', 'checkout.session.completed', {
        id: 'cs_unpaid', customer: 'cus_unpaid_checkout', subscription: 'sub_unpaid', payment_status: 'paid',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'unpaid-checkout-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_unpaid', requestKey: 'unpaid-checkout-key', customerId: 'cus_unpaid_checkout',
        subscriptionId: 'sub_unpaid', contaId: 'conta_1', planCode: 'STARTER', priceId: 'price_starter_test',
        subscriptionStatus: 'active', invoice: unpaid,
        reactivationOrigin: { subscriptionId: 'sub_old_unpaid', planCode: 'STARTER', priceId: 'price_starter_test' },
      }),
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'CANCELED', stripeSubscriptionId: 'sub_unpaid' });
    expect(store.invoices).toEqual([]);
  });

  it('keeps a new bound active subscription pending until a positive paid invoice confirms access', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: 'STARTER', pendingPlanCode: 'STARTER',
      stripeCustomerId: 'cus_sub_first', stripeSubscriptionId: 'sub_current_checkout', stripePriceId: 'price_starter_test',
      checkoutClaimKey: null,
    })]);
    addCheckoutSession(store, { idempotencyKey: 'sub-first-checkout', planCode: 'STARTER', stripeCustomerId: 'cus_sub_first', stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_sub_first' });
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_sub_first_checkout_completed', 'checkout.session.completed', {
        id: 'cs_sub_first', customer: 'cus_sub_first', subscription: 'sub_current_checkout',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'sub-first-checkout' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_sub_first', requestKey: 'sub-first-checkout', customerId: 'cus_sub_first',
        subscriptionId: 'sub_current_checkout', contaId: 'conta_1', planCode: 'STARTER', priceId: 'price_starter_test',
        subscriptionStatus: 'active', invoice: null,
      }),
    }, store);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_sub_first_active_before_invoice', 'customer.subscription.updated', {
        id: 'sub_current_checkout', customer: 'cus_sub_first', status: 'active', cancel_at_period_end: false,
        metadata: { contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform' },
        items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeSubscriptionId: 'sub_current_checkout', firstPaidAt: null,
    });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_sub_first_invoice_paid', 'invoice.paid', paidInvoice({
        id: 'in_sub_first', customer: 'cus_sub_first', subscription: 'sub_current_checkout', priceId: 'price_starter_test',
      })),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_sub_first', requestKey: 'sub-first-checkout', customerId: 'cus_sub_first',
        subscriptionId: 'sub_current_checkout', contaId: 'conta_1', planCode: 'STARTER', priceId: 'price_starter_test',
        subscriptionStatus: 'active', invoice: null,
      }),
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', accessStatus: 'ACTIVE', stripeSubscriptionId: 'sub_current_checkout' });
    expect(store.accounts[0]?.firstPaidAt).toEqual(new Date(1_798_000_000 * 1000));
    expect(store.accounts[0]?.lastSuccessfulPaymentAt).toEqual(new Date(1_798_000_000 * 1000));
    expect(store.invoices[0]).toMatchObject({ stripeInvoiceId: 'in_sub_first', status: 'PAID', amountPaid: 14900 });
  });

  it('processes a valid paid Checkout when subscription.created bound first, while rejecting divergent checkout lineage', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: 'STARTER', pendingPlanCode: 'STARTER',
      stripeCustomerId: 'cus_ordered_checkout', stripeSubscriptionId: null, stripePriceId: 'price_starter_test',
      checkoutClaimKey: 'ordered-checkout-key', checkoutClaimPhase: 'REQUESTING',
    })]);
    addCheckoutSession(store, {
      idempotencyKey: 'ordered-checkout-key', planCode: 'STARTER', stripeCustomerId: 'cus_ordered_checkout',
      stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_ordered_checkout',
    });
    const metadata = {
      contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform', flow: 'subscription',
      checkoutRequestKey: 'ordered-checkout-key',
    };
    const gateway = checkoutGateway({
      sessionId: 'cs_ordered_checkout', requestKey: 'ordered-checkout-key', customerId: 'cus_ordered_checkout',
      subscriptionId: 'sub_ordered_checkout', contaId: 'conta_1', planCode: 'STARTER',
      priceId: 'price_starter_test', subscriptionStatus: 'active', invoice: null,
    });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_ordered_subscription_created', 'customer.subscription.created', {
        id: 'sub_ordered_checkout', customer: 'cus_ordered_checkout', status: 'active', cancel_at_period_end: false,
        metadata, items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeSubscriptionId: 'sub_ordered_checkout',
      checkoutClaimKey: 'ordered-checkout-key',
    });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_ordered_checkout_completed', 'checkout.session.completed', {
        id: 'cs_ordered_checkout', customer: 'cus_ordered_checkout', subscription: 'sub_ordered_checkout',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'ordered-checkout-key' },
      }),
      environment: 'TEST', envSource, stripeGateway: gateway,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', stripeSubscriptionId: 'sub_ordered_checkout' });
    expect(store.accounts[0]?.checkoutClaimKey).toBeNull();
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_ordered_invoice_paid', 'invoice.paid', paidInvoice({
        id: 'in_ordered_checkout', customer: 'cus_ordered_checkout', subscription: 'sub_ordered_checkout', priceId: 'price_starter_test',
      })),
      environment: 'TEST', envSource, stripeGateway: gateway,
    }, store);
    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', accessStatus: 'ACTIVE', stripeSubscriptionId: 'sub_ordered_checkout' });
    expect(store.accounts[0]?.firstPaidAt).toBeInstanceOf(Date);

    const newerClaimStore = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: 'STARTER', pendingPlanCode: 'STARTER',
      stripeCustomerId: 'cus_newer_claim', stripeSubscriptionId: 'sub_newer_claim', stripePriceId: 'price_starter_test',
      checkoutClaimKey: 'verified-key', checkoutClaimPhase: 'REQUESTING',
    })]);
    addCheckoutSession(newerClaimStore, {
      idempotencyKey: 'verified-key', planCode: 'STARTER', stripeCustomerId: 'cus_newer_claim',
      stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_verified_claim',
    });
    const persistCheckoutCompleted = newerClaimStore.markCheckoutSessionCompleted;
    newerClaimStore.markCheckoutSessionCompleted = async (input) => {
      await persistCheckoutCompleted(input);
      newerClaimStore.accounts[0]!.checkoutClaimKey = 'newer-attempt-key';
    };
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_newer_claim_preserved', 'checkout.session.completed', {
        id: 'cs_verified_claim', customer: 'cus_newer_claim', subscription: 'sub_newer_claim',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'verified-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_verified_claim', requestKey: 'verified-key', customerId: 'cus_newer_claim',
        subscriptionId: 'sub_newer_claim', contaId: 'conta_1', planCode: 'STARTER',
        priceId: 'price_starter_test', subscriptionStatus: 'incomplete', invoice: null,
      }),
    }, newerClaimStore);
    expect(newerClaimStore.accounts[0]?.checkoutClaimKey).toBe('newer-attempt-key');

    const invalidCheckoutStore = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: 'STARTER', pendingPlanCode: 'STARTER',
      stripeCustomerId: 'cus_invalid_checkout', stripeSubscriptionId: 'sub_invalid_checkout',
      stripePriceId: 'price_starter_test', checkoutClaimKey: 'verified-key', checkoutClaimPhase: 'REQUESTING',
    })]);
    addCheckoutSession(invalidCheckoutStore, {
      idempotencyKey: 'verified-key', planCode: 'STARTER', stripeCustomerId: 'cus_invalid_checkout',
      stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_invalid_checkout',
    });
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invalid_checkout_claim', 'checkout.session.completed', {
        id: 'cs_invalid_checkout', customer: 'cus_invalid_checkout', subscription: 'sub_invalid_checkout',
        metadata: { contaId: 'conta_1', checkoutRequestKey: 'verified-key' },
      }),
      environment: 'TEST', envSource,
      stripeGateway: checkoutGateway({
        sessionId: 'cs_invalid_checkout', requestKey: 'wrong-key', customerId: 'cus_invalid_checkout',
        subscriptionId: 'sub_invalid_checkout', contaId: 'conta_1', planCode: 'STARTER',
        priceId: 'price_starter_test', subscriptionStatus: 'active', invoice: null,
      }),
    }, invalidCheckoutStore)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(invalidCheckoutStore.accounts[0]?.checkoutClaimKey).toBe('verified-key');

    const divergentStore = createMemoryStore([buildAccount({
      status: 'CHECKOUT_PENDING', accessStatus: 'PENDING', planCode: 'STARTER', pendingPlanCode: 'STARTER',
      stripeCustomerId: 'cus_divergent_checkout', stripeSubscriptionId: 'sub_divergent_checkout',
      stripePriceId: 'price_starter_test',
    })]);
    addCheckoutSession(divergentStore, {
      idempotencyKey: 'expected-checkout-key', planCode: 'STARTER', stripeCustomerId: 'cus_divergent_checkout',
      stripePriceId: 'price_starter_test', stripeCheckoutSessionId: 'cs_expected_checkout',
    });
    const divergentGateway = checkoutGateway({
      sessionId: 'cs_expected_checkout', requestKey: 'wrong-request-key', customerId: 'cus_divergent_checkout',
      subscriptionId: 'sub_divergent_checkout', contaId: 'conta_1', planCode: 'STARTER',
      priceId: 'price_starter_test', subscriptionStatus: 'active', invoice: null,
    });
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_divergent_checkout_paid', 'invoice.paid', paidInvoice({
        id: 'in_divergent_checkout', customer: 'cus_divergent_checkout', subscription: 'sub_divergent_checkout', priceId: 'price_starter_test',
      })),
      environment: 'TEST', envSource, stripeGateway: divergentGateway,
    }, divergentStore)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED' });
    expect(divergentStore.accounts[0]).toMatchObject({ status: 'CHECKOUT_PENDING', accessStatus: 'PENDING' });
  });

  it('does not fail a plan change from stale pending_update_expired after the account CAS rejects it', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'pbc_upgrade_old',
      lastProviderEventCreatedAt: new Date(1_800_000_000 * 1000),
    })]);
    const account = store.accounts[0]!;
    store.updateAccountFromStripeSubscription = async () => account;
    await processPlatformBillingWebhookEvent({
      event: {
        ...stripeEvent('evt_old_pending_expired', 'customer.subscription.pending_update_expired', {
          id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
          pending_update: null, metadata: { contaId: 'conta_1', planChangeId: 'pbc_upgrade_old' },
          items: { data: [{ price: { id: 'price_starter_test' } }] },
        }),
        created: 1_700_000_001,
      } as StripeWebhookEvent,
      environment: 'TEST', envSource,
    }, store);
    expect(account).toMatchObject({ planCode: 'STARTER', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM' });
    expect(store.planChangeFinalizations).toEqual([]);
  });

  it('ignores an old upgrade expiration after a new downgrade claim is reserved', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PRO',
      pendingChangeType: 'DOWNGRADE', pendingChangeOperationId: 'pbc_downgrade_new',
      pendingChangeClaimToken: 'claim_downgrade_new',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_expired_old_upgrade', 'customer.subscription.pending_update_expired', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1', planChangeId: 'pbc_upgrade_old' },
        items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({
      pendingPlanCode: 'PRO', pendingChangeType: 'DOWNGRADE',
      pendingChangeOperationId: 'pbc_downgrade_new', pendingChangeClaimToken: 'claim_downgrade_new',
    });
    expect(store.planChangeFinalizations).toEqual([]);
  });

  it('expires only the matching pending upgrade operation', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test', pendingPlanCode: 'PREMIUM',
      pendingChangeType: 'UPGRADE', pendingChangeOperationId: 'pbc_upgrade_current',
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_expired_current_upgrade', 'customer.subscription.pending_update_expired', {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false,
        pending_update: null, metadata: { contaId: 'conta_1', planChangeId: 'pbc_upgrade_current' },
        items: { data: [{ price: { id: 'price_starter_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.accounts[0]).toMatchObject({ pendingPlanCode: null, pendingChangeOperationId: null });
    expect(store.planChangeFinalizations).toEqual([expect.objectContaining({
      stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium_test', applied: false,
    })]);
  });

  it('resolves current invoice price from pricing.price_details and ignores proration lines', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
      firstPaidAt: new Date('2026-01-01T00:00:00.000Z'), lastSuccessfulPaymentAt: new Date('2026-10-01T00:00:00.000Z'),
    })]);
    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invoice_nested_price', 'invoice.paid', {
        id: 'in_nested', customer: 'cus_1', subscription: 'sub_1', status: 'paid', amount_due: 1000,
        amount_paid: 1000, currency: 'brl', lines: { data: [
          { proration: true, pricing: { price_details: { price: 'price_pro_test' } } },
          { pricing: { price_details: { price: 'price_premium_test' } } },
        ] },
      }),
      environment: 'TEST', envSource,
    }, store);
    expect(store.invoices[0]?.stripePriceId).toBe('price_premium_test');
  });

  it('rejects an invoice with multiple distinct non-proration prices instead of guessing', async () => {
    const store = createMemoryStore([buildAccount({
      status: 'ACTIVE', planCode: 'STARTER', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
    })]);
    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invoice_ambiguous_prices', 'invoice.paid', {
        id: 'in_ambiguous', customer: 'cus_1', subscription: 'sub_1', status: 'paid', amount_due: 1000,
        amount_paid: 1000, currency: 'brl', lines: { data: [
          { pricing: { price_details: { price: 'price_starter_test' } } },
          { pricing: { price_details: { price: 'price_premium_test' } } },
        ] },
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_WEBHOOK_INVALID' });
    expect(store.invoices).toEqual([]);
    expect(store.accounts[0]?.lastSuccessfulPaymentAt).toBeNull();
  });

  it('sincroniza assinatura Stripe para account comercial da plataforma', async () => {
    const store = createMemoryStore([
      buildAccount({
        stripeCustomerId: 'cus_1',
      }),
    ]);

    const result = await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_subscription_1', 'customer.subscription.updated', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: 1_798_000_000,
          trial_end: null,
          metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(result.status).toBe('processed');
    expect(store.accounts[0]?.status).toBe('ACTIVE');
    expect(store.accounts[0]?.planCode).toBe('PREMIUM');
    expect(store.accounts[0]?.stripeSubscriptionId).toBe('sub_1');
    expect(store.webhookEvents[0]?.status).toBe('PROCESSED');
  });

  it('limpa cancelamento pendente quando Stripe retorna cancel_at_period_end falso', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'PRESENT',
        cancelAtPeriodEnd: true,
        pendingChangeType: 'CANCEL_AT_PERIOD_END',
        pendingChangeEffectiveAt: new Date('2026-07-15T22:55:35.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_subscription_uncanceled_1', 'customer.subscription.updated', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: 1_798_000_000,
          trial_end: null,
          metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'ACTIVE',
      accessStatus: 'ACTIVE',
      cancelAtPeriodEnd: false,
      pendingChangeType: null,
      pendingChangeEffectiveAt: null,
    });
  });

  it('persiste invoice Stripe conhecida para histÃ³rico de faturamento', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        planCode: 'STARTER',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_starter_test',
        firstPaidAt: new Date('2026-01-01T00:00:00.000Z'),
        lastSuccessfulPaymentAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_invoice_1', 'invoice.paid', {
          id: 'in_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          number: 'INV-001',
          status: 'paid',
          amount_due: 14_900,
          amount_paid: 14_900,
          currency: 'brl',
          hosted_invoice_url: 'https://stripe.test/invoice/in_1',
          invoice_pdf: 'https://stripe.test/invoice/in_1.pdf',
          period_start: 1_780_000_000,
          period_end: 1_782_592_000,
          status_transitions: { paid_at: 1_780_000_100 },
          lines: { data: [{ price: { id: 'price_starter_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.invoices).toHaveLength(1);
    expect(store.invoices[0]).toMatchObject({
      contaId: 'conta_1',
      stripeInvoiceId: 'in_1',
      planCode: 'STARTER',
      status: 'PAID',
      amountPaid: 14_900,
    });
    expect(store.paidIssueResolutions).toEqual([
      { billingAccountId: 'pba_1', correlationId: 'evt_invoice_1' },
    ]);
  });

  it('does not resolve paid issues when a concurrent newer Stripe event won the account CAS', async () => {
    const account = buildAccount({
      status: 'PAST_DUE', accessStatus: 'GRACE_PERIOD', planCode: 'STARTER',
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_starter_test',
      lastProviderEventCreatedAt: new Date('2026-10-12T00:00:10.000Z'),
    });
    const store = createMemoryStore([account]);
    store.updateAccountFromStripeSubscription = async () => ({
      ...account,
      status: 'CANCELED', accessStatus: 'RESTRICTED',
      lastProviderEventCreatedAt: new Date('2026-10-12T00:00:30.000Z'),
      lastStripeEventId: 'evt_newer_canceled',
    });

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_old_paid', 'invoice.paid', {
        id: 'in_paid_old', customer: 'cus_1', subscription: 'sub_1', status: 'paid',
        amount_due: 14900, amount_paid: 14900, currency: 'brl',
        lines: { data: [{ pricing: { price_details: { price: 'price_starter_test' } } }] },
      }),
      environment: 'TEST', envSource,
    }, store);

    expect(store.paidIssueResolutions).toEqual([]);
  });

  it('preserva status TRIALING quando invoice paid chega durante teste gratis', async () => {
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const store = createMemoryStore([
      buildAccount({
        status: 'TRIALING',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'PRESENT',
        currentPeriodEnd: trialEndsAt,
        trialEndsAt,
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_invoice_trial_paid_1', 'invoice.paid', {
          id: 'in_trial_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'paid',
          amount_due: 0,
          amount_paid: 0,
          currency: 'brl',
          period_start: 1_780_000_000,
          period_end: 1_782_592_000,
          status_transitions: { paid_at: 1_780_000_100 },
          lines: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      planCode: 'PREMIUM',
      stripePriceId: 'price_premium_test',
      trialEndsAt,
    });
    expect(store.accounts[0]?.lastSuccessfulPaymentAt).toBeNull();
    expect(store.paidIssueResolutions).toEqual([]);
  });

  it('não associa invoice a uma conta apenas pelo customer quando a subscription diverge', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_current',
      }),
    ]);

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_invoice_wrong_subscription', 'invoice.paid', {
        id: 'in_wrong_subscription', customer: 'cus_1', subscription: 'sub_old',
        status: 'paid', amount_due: 27900, amount_paid: 27900,
      }),
      environment: 'TEST', envSource,
    }, store)).rejects.toMatchObject({ code: 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND' });
    expect(store.invoices).toHaveLength(0);
    expect(store.accounts[0]?.stripeSubscriptionId).toBe('sub_current');
  });

  it('não desliza o início do período de regularização em falhas repetidas mesmo sem método de pagamento', async () => {
    const startedAt = new Date('2026-10-01T12:00:00.000Z');
    const gracePeriodEndsAt = new Date('2026-10-08T12:00:00.000Z');
    const store = createMemoryStore([
      buildAccount({
        status: 'PAST_DUE', accessStatus: 'GRACE_PERIOD', stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1', firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'MISSING', gracePeriodStartedAt: startedAt, gracePeriodEndsAt,
      }),
    ]);

    for (const [eventId, created] of [['evt_failed_again_1', 1_791_000_000], ['evt_failed_again_2', 1_791_086_400]] as const) {
      await processPlatformBillingWebhookEvent({
        event: { ...stripeEvent(eventId, 'invoice.payment_failed', {
          id: 'in_retry', customer: 'cus_1', subscription: 'sub_1', status: 'open',
          amount_due: 27900, amount_paid: 0,
        }), created },
        environment: 'TEST', envSource,
      }, store);
    }

    expect(store.accounts[0]?.gracePeriodStartedAt).toEqual(startedAt);
    expect(store.accounts[0]?.gracePeriodEndsAt).toEqual(gracePeriodEndsAt);
  });

  it('deriva o prazo legado ausente do início original da regularização, sem estender em nova falha', async () => {
    const startedAt = new Date('2026-10-01T12:00:00.000Z');
    const expectedEnd = new Date('2026-10-08T12:00:00.000Z');
    const store = createMemoryStore([
      buildAccount({
        status: 'PAST_DUE', accessStatus: 'GRACE_PERIOD', stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1', firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'MISSING', gracePeriodStartedAt: startedAt, gracePeriodEndsAt: null,
      }),
    ]);

    await processPlatformBillingWebhookEvent({
      event: { ...stripeEvent('evt_legacy_grace_retry', 'invoice.payment_failed', {
        id: 'in_legacy_grace', customer: 'cus_1', subscription: 'sub_1', status: 'open',
        amount_due: 27900, amount_paid: 0,
      }), created: Math.floor(new Date('2026-10-05T12:00:00.000Z').getTime() / 1000) },
      environment: 'TEST', envSource,
    }, store);

    expect(store.accounts[0]?.gracePeriodStartedAt).toEqual(startedAt);
    expect(store.accounts[0]?.gracePeriodEndsAt).toEqual(expectedEnd);
  });

  it('abre periodo de regularizacao quando a cobranca da assinatura falha', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'PRESENT',
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_invoice_failed_1', 'invoice.payment_failed', {
          id: 'in_failed_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'open',
          amount_due: 27_900,
          amount_paid: 0,
          currency: 'brl',
          attempted: true,
          attempt_count: 2,
          next_payment_attempt: 1_780_086_400,
          payment_intent: {
            last_payment_error: {
              code: 'card_declined',
              message: 'Your card was declined.',
            },
          },
          period_start: 1_780_000_000,
          period_end: 1_782_592_000,
          lines: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'PAST_DUE',
      accessStatus: 'GRACE_PERIOD',
      pendingChangeType: 'PAYMENT_RECOVERY',
      pendingChangeEffectiveAt: new Date(1_780_086_400 * 1000),
    });
    expect(store.accounts[0]?.gracePeriodEndsAt).toBeInstanceOf(Date);
    expect(store.accounts[0]?.lastPaymentFailedAt).toBeInstanceOf(Date);
    expect(store.invoices[0]).toMatchObject({
      status: 'OPEN',
      attempted: true,
      attemptCount: 2,
      nextPaymentAttempt: new Date(1_780_086_400 * 1000),
      lastPaymentErrorCode: 'card_declined',
      lastPaymentErrorMessage: 'Your card was declined.',
    });
    expect(store.invoices[0]?.failedAt).toBeInstanceOf(Date);
  });

  it('concede grace a assinante previamente pago sem método e restaura acesso quando o pagamento é confirmado', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE', accessStatus: 'ACTIVE', planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_premium_test',
        firstPaidAt: new Date('2026-05-01T00:00:00.000Z'), paymentMethodStatus: 'MISSING',
      }),
    ]);

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_failed_missing_method', 'invoice.payment_failed', {
        id: 'in_missing_method', customer: 'cus_1', subscription: 'sub_1', status: 'open',
        amount_due: 27_900, amount_paid: 0, currency: 'brl', attempted: true, attempt_count: 1,
        lines: { data: [{ price: { id: 'price_premium_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);

    expect(store.accounts[0]).toMatchObject({ status: 'PAST_DUE', accessStatus: 'GRACE_PERIOD' });
    expect(store.accounts[0]?.gracePeriodEndsAt).toBeInstanceOf(Date);

    const expiredAt = new Date(Date.now() + 1);
    store.accounts[0]!.gracePeriodEndsAt = new Date(expiredAt.getTime() - 1);
    store.accounts[0]!.accessStatus = 'RESTRICTED';
    expect(derivePlatformAccessStatus({ account: store.accounts[0]!, now: expiredAt })).toBe('RESTRICTED');

    await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_recovered_missing_method', 'invoice.paid', {
        id: 'in_recovered_missing_method', customer: 'cus_1', subscription: 'sub_1', status: 'paid',
        amount_due: 27_900, amount_paid: 27_900, currency: 'brl', attempted: true, attempt_count: 2,
        status_transitions: { paid_at: 1_780_000_100 },
        lines: { data: [{ price: { id: 'price_premium_test' } }] },
      }),
      environment: 'TEST', envSource,
    }, store);

    expect(store.accounts[0]).toMatchObject({ status: 'ACTIVE', accessStatus: 'ACTIVE', gracePeriodEndsAt: null });
  });

  it('nao concede grace period quando uma fatura falha durante o trial', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'TRIALING',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_trial_invoice_failed_1', 'invoice.payment_failed', {
          id: 'in_trial_failed_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'open',
          amount_due: 27_900,
          amount_paid: 0,
          currency: 'brl',
          attempted: true,
          attempt_count: 1,
          lines: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'TRIALING',
      accessStatus: 'RESTRICTED',
      gracePeriodEndsAt: null,
      pendingChangeType: null,
    });
    expect(store.accounts[0]?.restrictedAt).toBeInstanceOf(Date);
  });

  it('trata autenticacao pendente como regularizacao de pagamento', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        firstPaidAt: new Date('2026-05-01T00:00:00.000Z'),
        paymentMethodStatus: 'PRESENT',
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_invoice_action_required_1', 'invoice.payment_action_required', {
          id: 'in_action_required_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'open',
          amount_due: 27_900,
          amount_paid: 0,
          currency: 'brl',
          attempted: true,
          attempt_count: 1,
          payment_intent: {
            last_payment_error: {
              code: 'authentication_required',
              message: 'Authentication is required.',
            },
          },
          lines: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'PAST_DUE',
      accessStatus: 'GRACE_PERIOD',
      pendingChangeType: 'PAYMENT_RECOVERY',
    });
    expect(store.invoices[0]).toMatchObject({
      status: 'OPEN',
      lastPaymentErrorCode: 'authentication_required',
    });
  });

  it('limpa recuperacao de pagamento quando a fatura e paga', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'PAST_DUE',
        accessStatus: 'GRACE_PERIOD',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        gracePeriodEndsAt: new Date('2026-07-10T00:00:00.000Z'),
        lastPaymentFailedAt: new Date('2026-07-03T00:00:00.000Z'),
        pendingChangeType: 'PAYMENT_RECOVERY',
        pendingChangeEffectiveAt: new Date('2026-07-04T00:00:00.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_invoice_recovered_1', 'invoice.paid', {
          id: 'in_recovered_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'paid',
          amount_due: 27_900,
          amount_paid: 27_900,
          currency: 'brl',
          attempted: true,
          attempt_count: 3,
          status_transitions: { paid_at: 1_780_000_100 },
          lines: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'ACTIVE',
      accessStatus: 'ACTIVE',
      gracePeriodEndsAt: null,
      lastPaymentFailedAt: null,
      pendingChangeType: null,
      pendingChangeEffectiveAt: null,
    });
  });

  it('marca aviso recebido quando a Stripe informa fim proximo do trial', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'TRIALING',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_trial_will_end_1', 'customer.subscription.trial_will_end', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'trialing',
          cancel_at_period_end: false,
          current_period_end: 1_783_555_200,
          trial_end: 1_783_555_200,
          metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      planCode: 'PREMIUM',
    });
    expect(store.accounts[0]?.trialWillEndNotifiedAt).toBeInstanceOf(Date);
  });

  it('nÃ£o reprocessa evento jÃ¡ processado', async () => {
    const store = createMemoryStore([
      buildAccount({
        stripeCustomerId: 'cus_1',
      }),
    ]);
    const event = stripeEvent('evt_duplicate_1', 'customer.subscription.updated', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { contaId: 'conta_1' },
      items: { data: [{ price: { id: 'price_pro_test' } }] },
    });

    await processPlatformBillingWebhookEvent({ event, environment: 'TEST', envSource }, store);
    const duplicate = await processPlatformBillingWebhookEvent({ event, environment: 'TEST', envSource }, store);

    expect(duplicate.status).toBe('duplicate');
    expect(store.webhookEvents[0]?.attempts).toBe(1);
  });

  it('restringe acesso quando trial sem forma de pagamento pausa no Stripe', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'TRIALING',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_subscription_paused_1', 'customer.subscription.paused', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'paused',
          cancel_at_period_end: false,
          current_period_end: null,
          trial_end: 1_783_555_200,
          metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'PAUSED',
      accessStatus: 'RESTRICTED',
      planCode: 'PREMIUM',
    });
    expect(store.accounts[0]?.restrictedAt).toBeInstanceOf(Date);
  });

  it('finaliza cancelamento no fim do test clock sem manter reverter cancelamento', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'TRIALING',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
        currentPeriodEnd: new Date('2026-07-15T22:55:35.000Z'),
        trialEndsAt: new Date('2026-07-15T22:55:35.000Z'),
        cancelAtPeriodEnd: true,
      }),
    ]);

    await processPlatformBillingWebhookEvent(
      {
        event: stripeEvent('evt_subscription_deleted_1', 'customer.subscription.deleted', {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'canceled',
          cancel_at_period_end: true,
          current_period_end: 1_784_155_335,
          trial_end: 1_784_155_335,
          canceled_at: 1_784_155_335,
          metadata: { contaId: 'conta_1' },
          items: { data: [{ price: { id: 'price_premium_test' } }] },
        }),
        environment: 'TEST',
        envSource,
      },
      store,
    );

    expect(store.accounts[0]).toMatchObject({
      status: 'CANCELED',
      accessStatus: 'CANCELED',
      planCode: 'PREMIUM',
      cancelAtPeriodEnd: false,
    });
    expect(store.accounts[0]?.canceledAt).toBeInstanceOf(Date);
  });

  it('ignora subscription.deleted para Conta inexistente sem criar billing account e deduplica repetição', async () => {
    const store = createMemoryStore([]);
    store.contaExists = async () => false;
    const event = stripeEvent('evt_subscription_deleted_missing_conta', 'customer.subscription.deleted', {
      id: 'sub_missing_conta',
      customer: 'cus_missing_conta',
      status: 'canceled',
      metadata: { contaId: 'conta_missing' },
      items: { data: [{ price: { id: 'price_pro_test' } }] },
    });

    const first = await processPlatformBillingWebhookEvent({ event, environment: 'TEST', envSource }, store);
    const repeated = await processPlatformBillingWebhookEvent({ event, environment: 'TEST', envSource }, store);

    expect(first.status).toBe('ignored');
    expect(store.webhookEvents[0]?.status).toBe('IGNORED');
    expect(repeated.status).toBe('duplicate');
    expect(store.accounts).toHaveLength(0);
    expect(store.auditLogs).toHaveLength(0);
    expect(store.webhookEvents[0]?.attempts).toBe(1);
  });

  it('cria billing account para subscription.created quando a Conta existe', async () => {
    const store = createMemoryStore([]);
    const result = await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_subscription_created_existing_conta', 'customer.subscription.created', {
        id: 'sub_existing_conta',
        customer: 'cus_existing_conta',
        status: 'active',
        metadata: { contaId: 'conta_1' },
        items: { data: [{ price: { id: 'price_pro_test' } }] },
      }),
      environment: 'TEST',
      envSource,
    }, store);

    expect(result.status).toBe('processed');
    expect(store.accounts).toHaveLength(1);
    expect(store.accounts[0]).toMatchObject({ contaId: 'conta_1', stripeCustomerId: 'cus_existing_conta' });
  });

  it('ignora se a Conta for removida entre a checagem e a criação após falha de FK', async () => {
    const store = createMemoryStore([]);
    let existenceChecks = 0;
    store.contaExists = async () => ++existenceChecks === 1;
    store.createAccount = async () => {
      throw Object.assign(new Error('Foreign key constraint failed.'), { code: 'P2003' });
    };

    const result = await processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_subscription_deleted_conta_race', 'customer.subscription.deleted', {
        id: 'sub_removed_conta',
        customer: 'cus_removed_conta',
        status: 'canceled',
        metadata: { contaId: 'conta_removed_during_create' },
      }),
      environment: 'TEST',
      envSource,
    }, store);

    expect(result.status).toBe('ignored');
    expect(store.webhookEvents[0]?.status).toBe('IGNORED');
    expect(store.webhookEvents[0]?.attempts).toBe(1);
    expect(existenceChecks).toBe(2);
    expect(store.accounts).toHaveLength(0);
  });

  it('mantém retry quando createAccount falha com FK mas a Conta ainda existe', async () => {
    const store = createMemoryStore([]);
    let existenceChecks = 0;
    store.contaExists = async () => {
      existenceChecks += 1;
      return true;
    };
    store.createAccount = async () => {
      throw Object.assign(new Error('Original foreign key failure.'), { code: 'P2003' });
    };

    await expect(processPlatformBillingWebhookEvent({
      event: stripeEvent('evt_subscription_deleted_conta_still_exists', 'customer.subscription.deleted', {
        id: 'sub_still_existing_conta',
        customer: 'cus_still_existing_conta',
        status: 'canceled',
        metadata: { contaId: 'conta_still_exists' },
      }),
      environment: 'TEST',
      envSource,
    }, store)).rejects.toMatchObject({
      code: 'PLATFORM_BILLING_WEBHOOK_PROCESSING_FAILED',
      details: { cause: 'Original foreign key failure.' },
    });

    expect(store.webhookEvents[0]?.status).toBe('FAILED');
    expect(store.webhookEvents[0]?.lastError).toContain('Platform billing webhook processing failed.');
    expect(store.webhookEvents[0]?.attempts).toBe(1);
    expect(existenceChecks).toBe(2);
    expect(store.accounts).toHaveLength(0);
  });
});

function stripeEvent(
  id: string,
  type: string,
  object: Record<string, unknown>,
  created = nextStripeEventCreated++,
): StripeWebhookEvent {
  return {
    id,
    type,
    created,
    data: { object },
  } as StripeWebhookEvent;
}

function addCheckoutSession(
  store: ReturnType<typeof createMemoryStore>,
  input: { idempotencyKey: string; planCode: PlatformBillingCheckoutSessionRecord['planCode']; stripeCustomerId: string; stripePriceId: string; stripeCheckoutSessionId: string },
): void {
  store.checkoutSessions.push({
    id: `pbcs_${store.checkoutSessions.length + 1}`,
    contaId: store.accounts[0]!.contaId,
    billingAccountId: store.accounts[0]!.id,
    environment: store.accounts[0]!.environment,
    planCode: input.planCode,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripeCustomerId: input.stripeCustomerId,
    stripePriceId: input.stripePriceId,
    status: 'CREATED',
    url: 'https://checkout.stripe.test/session',
    cancelUrl: `https://app.test/account/billing-plan?checkout=canceled&checkoutRequestKey=${encodeURIComponent(input.idempotencyKey)}`,
    idempotencyKey: input.idempotencyKey,
  });
}

function paidInvoice(input: { id: string; customer: string; subscription: string; priceId: string; amountPaid?: number }): Record<string, unknown> {
  const amount = input.amountPaid ?? 14900;
  return {
    id: input.id,
    customer: input.customer,
    subscription: input.subscription,
    status: 'paid',
    livemode: false,
    amount_due: amount,
    amount_paid: amount,
    currency: 'brl',
    status_transitions: { paid_at: 1_798_000_000 },
    metadata: { contaId: 'conta_1' },
    lines: { data: [{ price: { id: input.priceId } }] },
  };
}

function checkoutGateway(input: {
  sessionId: string; requestKey: string; customerId: string; subscriptionId: string; contaId: string;
  planCode: string; priceId: string; subscriptionStatus: string; invoice: Record<string, unknown> | null;
  reactivationOrigin?: { subscriptionId: string; planCode: string; priceId: string };
}) {
  const metadata = {
    contaId: input.contaId,
    billingContext: 'platform',
    checkoutRequestKey: input.requestKey,
    planCode: input.planCode,
    flow: 'subscription',
    ...(input.reactivationOrigin ? {
      flow: 'reactivation',
      reactivationFromSubscriptionId: input.reactivationOrigin.subscriptionId,
      reactivationFromPlanCode: input.reactivationOrigin.planCode,
      reactivationFromPriceId: input.reactivationOrigin.priceId,
    } : {}),
  };
  return {
    listCustomerSubscriptions: async () => ({ subscriptions: [], complete: true }),
    cancelSubscription: async () => undefined,
    retrieveCheckoutSession: async () => ({
      id: input.sessionId, status: 'complete', livemode: false, customerId: input.customerId,
      clientReferenceId: input.contaId,
      metadata,
      priceIds: [input.priceId], subscriptionId: input.subscriptionId,
    }),
    retrieveLatestSubscriptionInvoice: async () => input.invoice,
    retrieveSubscription: async () => ({
      id: input.subscriptionId, customerId: input.customerId, status: input.subscriptionStatus,
      priceId: input.priceId, currentPeriodEnd: new Date('2026-11-26T00:00:00.000Z'),
      cancelAtPeriodEnd: false, trialEndsAt: null, pendingUpdateId: null,
    }),
    retrieveSubscriptionSnapshot: async () => ({
      id: input.subscriptionId, customerId: input.customerId, status: input.subscriptionStatus, livemode: false,
      metadata,
      priceIds: [input.priceId], currentPeriodEnd: new Date('2026-11-26T00:00:00.000Z'),
      cancelAtPeriodEnd: false, trialEndsAt: null,
    }),
  };
}

function buildAccount(input: Partial<PlatformBillingAccountRecord>): PlatformBillingAccountRecord {
  return {
    id: 'pba_1',
    contaId: 'conta_1',
    environment: 'TEST',
    status: 'NOT_STARTED',
    planCode: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialWillEndNotifiedAt: null,
    accessStatus: 'PENDING',
    gracePeriodEndsAt: null,
    restrictedAt: null,
    canceledAt: null,
    lastPaymentFailedAt: null,
    firstPaidAt: null,
    lastSuccessfulPaymentAt: null,
    paymentMethodStatus: 'UNKNOWN',
    paymentMethodType: null,
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    paymentMethodExpMonth: null,
    paymentMethodExpYear: null,
    restrictionReason: null,
    gracePeriodStartedAt: null,
    accessStateVersion: 0,
    lastProviderEventCreatedAt: null,
    lastStripeEventId: null,
    lastReconciledAt: null,
    pendingPlanCode: null,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
    pendingChangeOperationId: null,
    pendingChangeClaimToken: null,
    ...input,
  };
}

function createMemoryStore(initialAccounts: PlatformBillingAccountRecord[] = []) {
  const accounts = [...initialAccounts];
  const checkoutSessions: PlatformBillingCheckoutSessionRecord[] = [];
  const invoices: PlatformBillingInvoiceRecord[] = [];
  const webhookEvents: PlatformBillingWebhookEventRecord[] = [];
  const auditLogs: PlatformBillingAuditLogInput[] = [];
  const paidIssueResolutions: Array<{ billingAccountId: string; correlationId?: string }> = [];
  const planChangeFinalizations: Array<{
    planChangeId: string; contaId: string; billingAccountId: string;
    environment: 'TEST' | 'LIVE'; stripeSubscriptionId: string; stripePriceId: string | null; applied: boolean;
  }> = [];

  const store: PlatformBillingStore & {
    accounts: PlatformBillingAccountRecord[];
    checkoutSessions: PlatformBillingCheckoutSessionRecord[];
    invoices: PlatformBillingInvoiceRecord[];
    webhookEvents: PlatformBillingWebhookEventRecord[];
    auditLogs: PlatformBillingAuditLogInput[];
    paidIssueResolutions: Array<{ billingAccountId: string; correlationId?: string }>;
    planChangeFinalizations: Array<{
      planChangeId: string; contaId: string; billingAccountId: string;
      environment: 'TEST' | 'LIVE'; stripeSubscriptionId: string; stripePriceId: string | null; applied: boolean;
    }>;
  } = {
    accounts,
    checkoutSessions,
    invoices,
    webhookEvents,
    auditLogs,
    paidIssueResolutions,
    planChangeFinalizations,
    async contaExists() { return true; },
    async findAccount(input) {
      return accounts.find((account) => account.contaId === input.contaId && account.environment === input.environment) ?? null;
    },
    async findAccountByStripeCustomerId(input) {
      return accounts.find((account) => account.environment === input.environment && account.stripeCustomerId === input.stripeCustomerId) ?? null;
    },
    async findAccountByStripeSubscriptionId(input) {
      return accounts.find((account) => account.environment === input.environment && account.stripeSubscriptionId === input.stripeSubscriptionId) ?? null;
    },
    async createAccount(input) {
      const account = buildAccount({
        id: `pba_${accounts.length + 1}`,
        contaId: input.contaId,
        environment: input.environment,
        stripeCustomerId: input.stripeCustomerId,
      });
      accounts.push(account);
      return account;
    },
    async attachCustomer(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      account.stripeCustomerId = input.stripeCustomerId;
      return account;
    },
    async markCheckoutPending(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      account.status = 'CHECKOUT_PENDING';
      account.planCode = input.planCode;
      account.stripePriceId = input.stripePriceId;
      return account;
    },
    async markCheckoutRequestStarted() {},
    async bindCheckoutSubscription(input) {
      const account = accounts.find((item) => item.id === input.accountId
        && item.contaId === input.contaId && item.environment === input.environment
        && item.stripeCustomerId === input.stripeCustomerId && item.checkoutClaimKey === input.idempotencyKey);
      if (account) {
        account.stripeSubscriptionId = input.stripeSubscriptionId;
        account.checkoutClaimKey = null;
        account.checkoutClaimPhase = null;
      }
    },
    async clearCheckoutClaim() {},
    async markCheckoutSessionCompleted(input) {
      const session = checkoutSessions.find((item) => item.contaId === input.contaId
        && item.environment === input.environment
        && item.stripeCheckoutSessionId === input.stripeCheckoutSessionId
        && (item.status === 'CREATED' || item.status === 'COMPLETED'));
      if (session) session.status = 'COMPLETED';
    },
    async updateAccountFromStripeSubscription(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      if (input.expectedAccountSnapshot && (
        account.contaId !== input.expectedAccountSnapshot.contaId
        || account.environment !== input.expectedAccountSnapshot.environment
        || account.stripeSubscriptionId !== input.expectedAccountSnapshot.stripeSubscriptionId
        || account.pendingChangeOperationId !== input.expectedAccountSnapshot.pendingChangeOperationId
        || (account.pendingChangeClaimToken ?? null) !== input.expectedAccountSnapshot.pendingChangeClaimToken
        || (input.expectedAccountSnapshot.lastProviderEventCreatedAt !== undefined
          && account.lastProviderEventCreatedAt?.getTime() !== input.expectedAccountSnapshot.lastProviderEventCreatedAt?.getTime())
        || (input.expectedAccountSnapshot.lastStripeEventId !== undefined
          && (account.lastStripeEventId ?? null) !== input.expectedAccountSnapshot.lastStripeEventId)
      )) throw new Error('Stripe account snapshot changed before subscription state could be applied.');
      account.status = input.status;
      account.lastProviderEventCreatedAt = input.lastProviderEventCreatedAt ?? account.lastProviderEventCreatedAt;
      account.lastStripeEventId = input.lastStripeEventId;
      account.planCode = input.planCode;
      account.stripeSubscriptionId = input.stripeSubscriptionId;
      account.stripePriceId = input.stripePriceId;
      account.currentPeriodEnd = input.currentPeriodEnd;
      account.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
      account.trialEndsAt = input.trialEndsAt;
      account.trialWillEndNotifiedAt = input.trialWillEndNotifiedAt === undefined ? account.trialWillEndNotifiedAt : input.trialWillEndNotifiedAt;
      account.accessStatus = input.accessStatus ?? account.accessStatus;
      account.gracePeriodEndsAt = input.gracePeriodEndsAt === undefined ? account.gracePeriodEndsAt : input.gracePeriodEndsAt;
      account.restrictedAt = input.restrictedAt === undefined ? account.restrictedAt : input.restrictedAt;
      account.canceledAt = input.canceledAt === undefined ? account.canceledAt : input.canceledAt;
      account.lastPaymentFailedAt = input.lastPaymentFailedAt === undefined ? account.lastPaymentFailedAt : input.lastPaymentFailedAt;
      account.firstPaidAt = input.firstPaidAt === undefined ? account.firstPaidAt : input.firstPaidAt;
      account.lastSuccessfulPaymentAt = input.lastSuccessfulPaymentAt === undefined
        ? account.lastSuccessfulPaymentAt
        : input.lastSuccessfulPaymentAt;
      account.pendingPlanCode = input.pendingPlanCode === undefined ? account.pendingPlanCode : input.pendingPlanCode;
      account.pendingChangeType = input.pendingChangeType === undefined ? account.pendingChangeType : input.pendingChangeType;
      account.pendingChangeEffectiveAt = input.pendingChangeEffectiveAt === undefined ? account.pendingChangeEffectiveAt : input.pendingChangeEffectiveAt;
      if (input.pendingChangeOperationId !== undefined) {
        account.pendingChangeOperationId = input.pendingChangeOperationId;
        account.pendingChangeClaimToken = null;
      }
      if (!input.cancelAtPeriodEnd && account.pendingChangeType === 'CANCEL_AT_PERIOD_END') {
        account.pendingChangeType = null;
        account.pendingChangeEffectiveAt = null;
      }
      if (input.planChangeFinalization) planChangeFinalizations.push(input.planChangeFinalization);
      return account;
    },
    async resolveOpenIssuesForPaidAccount(input) {
      paidIssueResolutions.push({
        billingAccountId: input.billingAccountId,
        correlationId: input.correlationId,
      });
      return 1;
    },
    async findCheckoutSessionByIdempotencyKey(input) {
      return checkoutSessions.find((session) => session.contaId === input.contaId && session.environment === input.environment && session.idempotencyKey === input.idempotencyKey) ?? null;
    },
    async createCheckoutSession(input) {
      const session: PlatformBillingCheckoutSessionRecord = {
        id: `pbcs_${checkoutSessions.length + 1}`,
        contaId: input.contaId,
        billingAccountId: input.billingAccountId,
        environment: input.environment,
        planCode: input.planCode,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripeCustomerId: input.stripeCustomerId,
        stripePriceId: input.stripePriceId,
        status: 'CREATED',
        url: input.url,
        idempotencyKey: input.idempotencyKey,
      };
      checkoutSessions.push(session);
      return session;
    },
    async listInvoices(input) {
      return invoices.filter((invoice) => invoice.contaId === input.contaId && invoice.environment === input.environment);
    },
    async upsertInvoice(input) {
      const invoice: PlatformBillingInvoiceRecord = {
        id: `pbi_${invoices.length + 1}`,
        contaId: input.contaId,
        billingAccountId: input.billingAccountId ?? null,
        environment: input.environment,
        stripeInvoiceId: input.stripeInvoiceId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripePriceId: input.stripePriceId ?? null,
        planCode: input.planCode ?? null,
        number: input.number ?? null,
        status: input.status,
        amountDue: input.amountDue,
        amountPaid: input.amountPaid,
        currency: input.currency,
        hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
        invoicePdf: input.invoicePdf ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        dueDate: input.dueDate ?? null,
        paidAt: input.paidAt ?? null,
        failedAt: input.failedAt ?? null,
        attempted: input.attempted ?? false,
        attemptCount: input.attemptCount ?? 0,
        nextPaymentAttempt: input.nextPaymentAttempt ?? null,
        lastPaymentErrorCode: input.lastPaymentErrorCode ?? null,
        lastPaymentErrorMessage: input.lastPaymentErrorMessage ?? null,
      };
      invoices.push(invoice);
      return invoice;
    },
    async upsertWebhookEvent(input) {
      const current = webhookEvents.find((event) => event.environment === input.environment && event.eventId === input.eventId);
      if (current) return { record: current, inserted: false };
      const event: PlatformBillingWebhookEventRecord = {
        id: `pbwe_${webhookEvents.length + 1}`,
        environment: input.environment,
        eventId: input.eventId,
        eventType: input.eventType,
        contaId: input.contaId ?? null,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        lastErrorCode: null,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lastAttemptAt: null,
        processingTimeoutAt: null,
        processedAt: null,
        exhaustedAt: null,
        workerId: null,
        correlationId: input.correlationId ?? input.eventId,
      };
      webhookEvents.push(event);
      return { record: event, inserted: true };
    },
    async markWebhookEventProcessing(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSING';
      event.contaId = input.contaId ?? event.contaId;
      event.workerId = input.workerId ?? null;
      event.processingTimeoutAt = input.processingTimeoutAt ?? null;
      event.attempts += 1;
      return event;
    },
    async markWebhookEventProcessed(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSED';
      event.contaId = input.contaId ?? event.contaId;
      event.processedAt = new Date();
      event.lockedAt = null;
      event.lastError = null;
      return event;
    },
    async markWebhookEventIgnored(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'IGNORED';
      event.contaId = input.contaId ?? event.contaId;
      return event;
    },
    async markWebhookEventFailed(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'FAILED';
      event.contaId = input.contaId ?? event.contaId;
      event.lastError = input.error;
      event.lastErrorCode = input.errorCode ?? null;
      event.nextAttemptAt = input.nextAttemptAt ?? null;
      event.exhaustedAt = input.exhausted ? new Date() : null;
      return event;
    },
    async createAuditLog(input) {
      auditLogs.push(input);
    },
  };

  return store;
}

