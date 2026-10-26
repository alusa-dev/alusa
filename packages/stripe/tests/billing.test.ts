import { describe, expect, it, vi } from 'vitest';
import {
  createStripeBillingCustomer,
  createStripeBillingPortalSession,
  createStripeSubscriptionCheckoutSession,
  createStripeTrialSubscriptionWithoutPaymentMethod,
  getStripeMissingCustomerId,
  releaseStripeSubscriptionSchedule,
  retrieveStripeCustomer,
  retrieveStripeCheckoutSession,
  retrieveStripeDefaultPaymentMethod,
  scheduleStripeSubscriptionPlanChange,
} from '../src';

describe('@alusa/stripe billing operations', () => {
  it('retrieves Checkout status and bindings including the actual line-item price', async () => {
    const retrieve = vi.fn(async () => ({
      id: 'cs_test_1', status: 'open', livemode: false, customer: 'cus_1',
      client_reference_id: 'conta_1', metadata: { contaId: 'conta_1', planCode: 'BAND_001_025' },
    }));
    const listLineItems = vi.fn(async () => ({ data: [{ price: { id: 'price_band_1' } }] }));
    const client = { checkout: { sessions: { retrieve, listLineItems } } };

    await expect(retrieveStripeCheckoutSession(client as never, 'cs_test_1')).resolves.toEqual({
      id: 'cs_test_1', status: 'open', livemode: false, customerId: 'cus_1',
      clientReferenceId: 'conta_1', metadata: { contaId: 'conta_1', planCode: 'BAND_001_025' },
      priceIds: ['price_band_1'],
      subscriptionId: null,
    });
    expect(retrieve).toHaveBeenCalledWith('cs_test_1');
    expect(listLineItems).toHaveBeenCalledWith('cs_test_1', { limit: 10 });
  });

  it('retrieves a customer and reports deleted state without mutating Stripe', async () => {
    const retrieve = vi.fn(async () => ({ id: 'cus_1', deleted: true }));
    const client = { customers: { retrieve } };

    await expect(retrieveStripeCustomer(client as never, 'cus_1')).resolves.toEqual({
      id: 'cus_1', deleted: true,
    });
    expect(retrieve).toHaveBeenCalledWith('cus_1');
  });

  it('extracts only exact missing customer IDs from Stripe resource-missing errors', () => {
    const stripeError = Object.assign(new Error("No such customer: 'cus_123abc'"), {
      type: 'StripeInvalidRequestError', code: 'resource_missing',
    });

    expect(getStripeMissingCustomerId(stripeError)).toBe('cus_123abc');
    expect(getStripeMissingCustomerId(new Error("No such customer: 'cus_123abc'"))).toBeNull();
    expect(getStripeMissingCustomerId(Object.assign(new Error("No such subscription: 'sub_1'"), {
      type: 'StripeInvalidRequestError', code: 'resource_missing',
    }))).toBeNull();
    expect(getStripeMissingCustomerId(Object.assign(new Error("No such customer: 'cus_123abc'"), {
      type: 'StripeInvalidRequestError', code: 'api_error',
    }))).toBeNull();
  });

  it('releases a subscription schedule with a stable idempotency key', async () => {
    const release = vi.fn(async () => ({}));
    const client = { subscriptionSchedules: { release } };
    await releaseStripeSubscriptionSchedule(client as never, {
      scheduleId: 'sched_1', idempotencyKey: 'idem_release_1',
    });
    expect(release).toHaveBeenCalledWith('sched_1', {}, { idempotencyKey: 'idem_release_1' });
  });

  it('schedules downgrade at renewal and releases schedule after the target phase', async () => {
    const client = {
      subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', schedule: null })) },
      subscriptionSchedules: {
        create: vi.fn(async () => ({
          id: 'sched_1', metadata: {}, current_phase: { start_date: 1_700_000_000 },
          phases: [{ start_date: 1_700_000_000, end_date: 1_800_000_000, items: [{ price: 'price_current', quantity: 2 }] }],
        })),
        update: vi.fn(async () => ({})),
        release: vi.fn(async () => ({})),
      },
    };
    const effectiveAt = new Date(1_800_000_000 * 1000);
    await expect(scheduleStripeSubscriptionPlanChange(client as never, {
      subscriptionId: 'sub_1', priceId: 'price_target', effectiveAt,
      metadata: { contaId: 'conta_1', planCode: 'STARTER' }, idempotencyKey: 'idem_downgrade',
    })).resolves.toEqual({ scheduleId: 'sched_1', effectiveAt });
    expect(client.subscriptionSchedules.update).toHaveBeenCalledWith('sched_1', expect.objectContaining({
      end_behavior: 'release',
      phases: expect.arrayContaining([
        expect.objectContaining({ end_date: 1_800_000_000, items: [{ price: 'price_current', quantity: 2 }], proration_behavior: 'none' }),
        expect.objectContaining({ start_date: 1_800_000_000, items: [{ price: 'price_target', quantity: 2 }], proration_behavior: 'none' }),
      ]),
    }), { idempotencyKey: 'idem_downgrade:update' });
  });

  it('reuses the owned scheduled band transition on retry without another Stripe update', async () => {
    const effectiveAt = new Date(1_800_000_000 * 1000);
    const scheduled = {
      id: 'sched_band', metadata: { alusaPlanChangeKey: 'idem_band' },
      current_phase: { start_date: 1_700_000_000 },
      phases: [
        { start_date: 1_700_000_000, end_date: 1_800_000_000, items: [{ price: 'price_current' }] },
        { start_date: 1_800_000_000, items: [{ price: 'price_band_026_050' }] },
      ],
    };
    const client = {
      subscriptions: { retrieve: vi.fn()
        .mockResolvedValueOnce({ id: 'sub_1', schedule: null })
        .mockResolvedValueOnce({ id: 'sub_1', schedule: scheduled }) },
      subscriptionSchedules: {
        create: vi.fn(async () => ({ ...scheduled, phases: [scheduled.phases[0]] })),
        update: vi.fn(async () => ({})),
        retrieve: vi.fn(async () => scheduled),
      },
    };
    const input = {
      subscriptionId: 'sub_1', priceId: 'price_band_026_050', effectiveAt,
      metadata: { contaId: 'conta_1', planCode: 'BAND_026_050' }, idempotencyKey: 'idem_band',
    };

    await expect(scheduleStripeSubscriptionPlanChange(client as never, input)).resolves.toMatchObject({ scheduleId: 'sched_band' });
    await expect(scheduleStripeSubscriptionPlanChange(client as never, input)).resolves.toMatchObject({ scheduleId: 'sched_band' });

    expect(client.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(client.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
    expect(client.subscriptionSchedules.update.mock.calls[0]?.[1].phases?.every((phase) => phase.proration_behavior === 'none')).toBe(true);
  });

  it('refuses to replace a schedule owned by another operation', async () => {
    const client = {
      subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', schedule: 'sched_existing' })) },
      subscriptionSchedules: { retrieve: vi.fn(async () => ({ id: 'sched_existing', metadata: { owner: 'other' }, phases: [] })) },
    };
    await expect(scheduleStripeSubscriptionPlanChange(client as never, {
      subscriptionId: 'sub_1', priceId: 'price_target', effectiveAt: new Date(), metadata: {}, idempotencyKey: 'idem_new',
    })).rejects.toThrow(/already managed by another schedule/);
  });

  it('recovers an owned schedule after update failure without releasing or recreating it', async () => {
    const createdSchedule = {
      id: 'sched_recover',
      metadata: { alusaPlanChangeKey: 'idem_recover', contaId: 'conta_1' },
      current_phase: { start_date: 1_700_000_000 },
      phases: [{ start_date: 1_700_000_000, end_date: 1_800_000_000, items: [{ price: 'price_current', quantity: 1 }] }],
    };
    const client = {
      subscriptions: {
        retrieve: vi.fn()
          .mockResolvedValueOnce({ id: 'sub_1', schedule: null })
          .mockResolvedValueOnce({ id: 'sub_1', schedule: createdSchedule }),
      },
      subscriptionSchedules: {
        create: vi.fn(async () => createdSchedule),
        update: vi.fn().mockRejectedValueOnce(Object.assign(new Error('invalid update'), {
          type: 'StripeInvalidRequestError', statusCode: 400,
        })).mockResolvedValueOnce({}),
        release: vi.fn(async () => ({})),
      },
    };
    const input = {
      subscriptionId: 'sub_1', priceId: 'price_target', effectiveAt: new Date(1_800_000_000 * 1000),
      metadata: { contaId: 'conta_1' }, idempotencyKey: 'idem_recover',
    };
    await expect(scheduleStripeSubscriptionPlanChange(client as never, input)).rejects.toMatchObject({
      name: 'StripeScheduleUpdateRecoveryError',
      code: 'STRIPE_SCHEDULE_UPDATE_RECOVERY_REQUIRED',
      cause: expect.objectContaining({ type: 'StripeInvalidRequestError', statusCode: 400 }),
    });
    await expect(scheduleStripeSubscriptionPlanChange(client as never, input)).resolves.toMatchObject({ scheduleId: 'sched_recover' });
    expect(client.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(client.subscriptionSchedules.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ alusaPlanChangeKey: 'idem_recover', contaId: 'conta_1' }),
    }), expect.anything());
    expect(client.subscriptionSchedules.update).toHaveBeenCalledTimes(2);
    expect(client.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

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

  it('propaga falha ao consultar a assinatura sem mascará-la com o cartão do customer', async () => {
    const client = {
      subscriptions: {
        retrieve: vi.fn().mockRejectedValue(new Error('Stripe subscription unavailable')),
      },
      customers: {
        retrieve: vi.fn(async () => ({
          id: 'cus_test_1',
          invoice_settings: { default_payment_method: 'pm_customer_default' },
        })),
      },
      paymentMethods: { retrieve: vi.fn() },
    };

    await expect(retrieveStripeDefaultPaymentMethod(client as never, {
      customerId: 'cus_test_1',
      subscriptionId: 'sub_test_1',
    })).rejects.toThrow('Stripe subscription unavailable');

    expect(client.customers.retrieve).not.toHaveBeenCalled();
  });
});
