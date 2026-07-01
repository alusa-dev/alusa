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

  it('persiste invoice Stripe conhecida para histórico de faturamento', async () => {
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

  it('não reprocessa evento já processado', async () => {
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
    accessStatus: 'PENDING',
    gracePeriodEndsAt: null,
    restrictedAt: null,
    canceledAt: null,
    lastPaymentFailedAt: null,
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
      account.accessStatus = input.accessStatus ?? account.accessStatus;
      account.gracePeriodEndsAt = input.gracePeriodEndsAt ?? account.gracePeriodEndsAt;
      account.restrictedAt = input.restrictedAt ?? account.restrictedAt;
      account.canceledAt = input.canceledAt ?? account.canceledAt;
      account.lastPaymentFailedAt = input.lastPaymentFailedAt ?? account.lastPaymentFailedAt;
      account.pendingPlanCode = input.pendingPlanCode === undefined ? account.pendingPlanCode : input.pendingPlanCode;
      account.pendingChangeType = input.pendingChangeType === undefined ? account.pendingChangeType : input.pendingChangeType;
      account.pendingChangeEffectiveAt = input.pendingChangeEffectiveAt === undefined ? account.pendingChangeEffectiveAt : input.pendingChangeEffectiveAt;
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
