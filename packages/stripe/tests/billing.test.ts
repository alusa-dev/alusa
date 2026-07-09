import { describe, expect, it, vi } from 'vitest';
import {
  createStripeBillingCustomer,
  createStripeBillingPortalSession,
  createStripeSubscriptionCheckoutSession,
  createStripeTrialSubscriptionWithoutPaymentMethod,
  retrieveStripeDefaultPaymentMethod,
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

  it('cria assinatura trial sem coletar forma de pagamento e pausa no fim', async () => {
    const client = {
      subscriptions: {
        create: vi.fn(async () => ({
          id: 'sub_test_1',
          customer: 'cus_test_1',
          status: 'trialing',
          cancel_at_period_end: false,
          trial_end: 1_782_645_200,
          items: { data: [{ price: { id: 'price_premium_test' }, current_period_end: 1_782_645_200 }] },
        })),
      },
    };

    const result = await createStripeTrialSubscriptionWithoutPaymentMethod(client as never, {
      customerId: 'cus_test_1',
      priceId: 'price_premium_test',
      metadata: { contaId: 'conta_1', planCode: 'PREMIUM', billingContext: 'platform' },
      trialDays: 14,
      idempotencyKey: 'idem_trial',
    });

    expect(result).toMatchObject({
      id: 'sub_test_1',
      status: 'trialing',
      priceId: 'price_premium_test',
    });
    expect(client.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_test_1',
        items: [{ price: 'price_premium_test', quantity: 1 }],
        trial_period_days: 14,
        trial_settings: {
          end_behavior: {
            missing_payment_method: 'pause',
          },
        },
      }),
      { idempotencyKey: 'idem_trial' },
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
      trialDays: 14,
      idempotencyKey: 'idem_checkout',
    });

    expect(result.id).toBe('cs_test_1');
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_test_1',
        line_items: [{ price: 'price_starter_test', quantity: 1 }],
        payment_method_collection: 'always',
        saved_payment_method_options: {
          allow_redisplay_filters: ['always', 'limited'],
          payment_method_remove: 'enabled',
          payment_method_save: 'enabled',
        },
        subscription_data: expect.objectContaining({
          trial_period_days: 14,
          trial_settings: {
            end_behavior: {
              missing_payment_method: 'cancel',
            },
          },
        }),
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

  it('consulta cartão padrão expandido da assinatura sem expor dados sensíveis', async () => {
    const client = {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: 'sub_test_1',
          default_payment_method: {
            id: 'pm_test_1',
            object: 'payment_method',
            type: 'card',
            card: {
              brand: 'visa',
              last4: '4242',
              exp_month: 12,
              exp_year: 2030,
            },
          },
        })),
      },
      customers: {
        retrieve: vi.fn(),
      },
      paymentMethods: {
        retrieve: vi.fn(),
      },
    };

    await expect(
      retrieveStripeDefaultPaymentMethod(client as never, {
        customerId: 'cus_test_1',
        subscriptionId: 'sub_test_1',
      }),
    ).resolves.toEqual({
      id: 'pm_test_1',
      type: 'card',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
    });

    expect(client.subscriptions.retrieve).toHaveBeenCalledWith('sub_test_1', {
      expand: ['default_payment_method'],
    });
    expect(client.customers.retrieve).not.toHaveBeenCalled();
    expect(client.paymentMethods.retrieve).not.toHaveBeenCalled();
  });

  it('usa invoice_settings do customer como fallback para cartão padrão', async () => {
    const client = {
      subscriptions: {
        retrieve: vi.fn(async () => ({
          id: 'sub_test_1',
          default_payment_method: null,
        })),
      },
      customers: {
        retrieve: vi.fn(async () => ({
          id: 'cus_test_1',
          object: 'customer',
          invoice_settings: {
            default_payment_method: 'pm_test_2',
          },
        })),
      },
      paymentMethods: {
        retrieve: vi.fn(async () => ({
          id: 'pm_test_2',
          object: 'payment_method',
          type: 'card',
          card: {
            brand: 'mastercard',
            last4: '4444',
            exp_month: 8,
            exp_year: 2029,
          },
        })),
      },
    };

    await expect(
      retrieveStripeDefaultPaymentMethod(client as never, {
        customerId: 'cus_test_1',
        subscriptionId: 'sub_test_1',
      }),
    ).resolves.toMatchObject({
      id: 'pm_test_2',
      brand: 'mastercard',
      last4: '4444',
    });

    expect(client.customers.retrieve).toHaveBeenCalledWith('cus_test_1', {
      expand: ['invoice_settings.default_payment_method'],
    });
    expect(client.paymentMethods.retrieve).toHaveBeenCalledWith('pm_test_2');
  });
});
