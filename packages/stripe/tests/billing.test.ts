import { describe, expect, it, vi } from 'vitest';
import {
  createStripeBillingCustomer,
  createStripeBillingPortalSession,
  createStripeSubscriptionCheckoutSession,
} from '../src';

describe('@alusa/stripe billing operations', () => {
  it('cria customer Stripe com metadata de plataforma e idempotency key', async () => {
    const client = {
      customers: {
        create: vi.fn(async () => ({ id: 'cus_test_1', livemode: false })),
      },
    };

    await expect(
      createStripeBillingCustomer(client as never, {
        name: 'Escola Alusa',
        email: 'financeiro@escola.test',
        metadata: { contaId: 'conta_1', billingContext: 'platform' },
        idempotencyKey: 'idem_customer',
      }),
    ).resolves.toEqual({ id: 'cus_test_1', livemode: false });

    expect(client.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Escola Alusa',
        metadata: { contaId: 'conta_1', billingContext: 'platform' },
      }),
      { idempotencyKey: 'idem_customer' },
    );
  });

  it('cria Checkout Session em modo subscription usando Price', async () => {
    const client = {
      checkout: {
        sessions: {
          create: vi.fn(async () => ({
            id: 'cs_test_1',
            url: 'https://checkout.stripe.test/session',
            expires_at: 1_782_645_200,
          })),
        },
      },
    };

    const result = await createStripeSubscriptionCheckoutSession(client as never, {
      customerId: 'cus_test_1',
      priceId: 'price_starter_test',
      successUrl: 'https://app.alusa.test/success',
      cancelUrl: 'https://app.alusa.test/cancel',
      clientReferenceId: 'conta_1',
      metadata: { contaId: 'conta_1', planCode: 'STARTER', billingContext: 'platform' },
      idempotencyKey: 'idem_checkout',
    });

    expect(result.id).toBe('cs_test_1');
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_test_1',
        line_items: [{ price: 'price_starter_test', quantity: 1 }],
      }),
      { idempotencyKey: 'idem_checkout' },
    );
  });

  it('cria Billing Portal Session com return URL', async () => {
    const client = {
      billingPortal: {
        sessions: {
          create: vi.fn(async () => ({
            id: 'bps_test_1',
            url: 'https://billing.stripe.test/session',
          })),
        },
      },
    };

    await expect(
      createStripeBillingPortalSession(client as never, {
        customerId: 'cus_test_1',
        returnUrl: 'https://app.alusa.test/billing',
        configurationId: 'bpc_test_1',
      }),
    ).resolves.toEqual({
      id: 'bps_test_1',
      url: 'https://billing.stripe.test/session',
    });

    expect(client.billingPortal.sessions.create).toHaveBeenCalledWith(
      {
        customer: 'cus_test_1',
        return_url: 'https://app.alusa.test/billing',
        configuration: 'bpc_test_1',
      },
      undefined,
    );
  });
});
