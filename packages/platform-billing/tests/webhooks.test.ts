import { describe, expect, it } from 'vitest';
import type { StripeWebhookEvent } from '@alusa/stripe';
import {
  processPlatformBillingWebhookEvent,
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
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
};

describe('@alusa/platform-billing webhooks', () => {
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

  it('trata autenticacao pendente como regularizacao de pagamento', async () => {
    const store = createMemoryStore([
      buildAccount({
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripePriceId: 'price_premium_test',
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
});

function stripeEvent(id: string, type: string, object: Record<string, unknown>): StripeWebhookEvent {
  return {
    id,
    type,
    data: { object },
  } as StripeWebhookEvent;
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
    lastReconciledAt: null,
    pendingPlanCode: null,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
    ...input,
  };
}

function createMemoryStore(initialAccounts: PlatformBillingAccountRecord[] = []) {
  const accounts = [...initialAccounts];
  const checkoutSessions: PlatformBillingCheckoutSessionRecord[] = [];
  const invoices: PlatformBillingInvoiceRecord[] = [];
  const webhookEvents: PlatformBillingWebhookEventRecord[] = [];
  const auditLogs: PlatformBillingAuditLogInput[] = [];

  const store: PlatformBillingStore & {
    accounts: PlatformBillingAccountRecord[];
    invoices: PlatformBillingInvoiceRecord[];
    webhookEvents: PlatformBillingWebhookEventRecord[];
    auditLogs: PlatformBillingAuditLogInput[];
  } = {
    accounts,
    invoices,
    webhookEvents,
    auditLogs,
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
    async updateAccountFromStripeSubscription(input) {
      const account = accounts.find((item) => item.id === input.accountId);
      if (!account) throw new Error('account not found');
      account.status = input.status;
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
      account.pendingPlanCode = input.pendingPlanCode === undefined ? account.pendingPlanCode : input.pendingPlanCode;
      account.pendingChangeType = input.pendingChangeType === undefined ? account.pendingChangeType : input.pendingChangeType;
      account.pendingChangeEffectiveAt = input.pendingChangeEffectiveAt === undefined ? account.pendingChangeEffectiveAt : input.pendingChangeEffectiveAt;
      if (!input.cancelAtPeriodEnd && account.pendingChangeType === 'CANCEL_AT_PERIOD_END') {
        account.pendingChangeType = null;
        account.pendingChangeEffectiveAt = null;
      }
      return account;
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

