import { describe, expect, it, vi } from 'vitest';
import {
  PlatformBillingError,
  createPlatformBillingCheckoutSession,
  createPlatformBillingPortalSession,
  createPlatformBillingTrialWithoutPaymentMethod,
} from '../src';
import type {
  PlatformBillingAccountRecord,
  PlatformBillingAuditLogInput,
  PlatformBillingCheckoutSessionRecord,
  PlatformBillingInvoiceRecord,
  PlatformBillingStore,
  PlatformBillingStripeGateway,
  PlatformBillingWebhookEventRecord,
} from '../src';

const envSource = {
  STRIPE_ENVIRONMENT: 'TEST',
  STRIPE_SECRET_KEY: 'sk_test_foundation',
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_test',
  STRIPE_PRICE_PREMIUM_MONTHLY: 'price_premium_test',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_test',
};

describe('@alusa/platform-billing use cases', () => {
  it('cria customer, checkout de assinatura e registro local auditável', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingCheckoutSession(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        billingEmail: 'financeiro@escola.test',
        planCode: 'STARTER',
        successUrl: 'https://app.alusa.test/billing/success',
        cancelUrl: 'https://app.alusa.test/billing/cancel',
        actorUserId: 'user_1',
        idempotencyKey: 'idem_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(false);
    expect(result.checkoutSessionId).toBe('cs_test_1');
    expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        priceId: 'price_starter_test',
        trialDays: 14,
        idempotencyKey: 'idem_1:checkout',
      }),
    );
    expect(store.auditLogs).toHaveLength(1);
    expect(store.accounts[0]?.status).toBe('CHECKOUT_PENDING');
    expect(store.accounts[0]?.planCode).toBeNull();
    expect(store.accounts[0]?.pendingPlanCode).toBe('STARTER');
  });

  it('nao reaplica trial quando conta ja teve assinatura Stripe', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'CANCELED',
        planCode: 'STARTER',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_old_1',
        stripePriceId: 'price_starter_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
        trialWillEndNotifiedAt: null,
        accessStatus: 'CANCELED',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        trialDays: null,
        metadata: expect.objectContaining({ flow: 'reactivation' }),
      }),
    );
    expect(store.accounts[0]?.pendingChangeType).toBe('REACTIVATE');
    expect(store.accounts[0]?.status).toBe('CANCELED');
    expect(store.accounts[0]?.accessStatus).toBe('CANCELED');
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_REACTIVATION_CHECKOUT_SESSION_CREATED');
  });

  it('reusa sessão local quando idempotency key já existe', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });
    const reused = await createPlatformBillingCheckoutSession(buildCheckoutInput(), { store, stripeGateway });

    expect(reused.reused).toBe(true);
    expect(reused.checkoutSessionId).toBe('cs_test_1');
    expect(stripeGateway.createCustomer).toHaveBeenCalledTimes(1);
    expect(stripeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it('cria trial sem forma de pagamento e persiste assinatura local', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingTrialWithoutPaymentMethod(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        billingEmail: 'financeiro@escola.test',
        planCode: 'PREMIUM',
        actorUserId: 'user_1',
        idempotencyKey: 'idem_trial_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(false);
    expect(result.stripeSubscriptionId).toBe('sub_test_trial_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_test_1',
        priceId: 'price_premium_test',
        trialDays: 14,
        idempotencyKey: 'idem_trial_1:trial-subscription',
      }),
    );
    expect(store.accounts[0]).toMatchObject({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      planCode: 'PREMIUM',
      stripeSubscriptionId: 'sub_test_trial_1',
      stripePriceId: 'price_premium_test',
    });
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_TRIAL_WITHOUT_PAYMENT_METHOD_CREATED');
  });

  it('nao duplica trial sem cartao quando assinatura ja existe', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'TRIALING',
        planCode: 'PREMIUM',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_existing_1',
        stripePriceId: 'price_premium_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
        trialWillEndNotifiedAt: null,
        accessStatus: 'ACTIVE',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingTrialWithoutPaymentMethod(
      {
        contaId: 'conta_1',
        contaName: 'Escola Alusa',
        planCode: 'PREMIUM',
        idempotencyKey: 'idem_trial_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.reused).toBe(true);
    expect(result.stripeSubscriptionId).toBe('sub_existing_1');
    expect(stripeGateway.createTrialSubscriptionWithoutPaymentMethod).not.toHaveBeenCalled();
  });

  it('falha com Price ausente sem chamar Stripe', async () => {
    const store = createMemoryStore();
    const stripeGateway = createStripeGatewayMock();

    await expect(
      createPlatformBillingCheckoutSession(
        {
          ...buildCheckoutInput(),
          envSource: {
            STRIPE_ENVIRONMENT: 'TEST',
            STRIPE_SECRET_KEY: 'sk_test_foundation',
          },
        },
        { store, stripeGateway },
      ),
    ).rejects.toThrow(PlatformBillingError);
    expect(stripeGateway.createCustomer).not.toHaveBeenCalled();
  });

  it('cria sessão de portal para account com Stripe customer', async () => {
    const store = createMemoryStore([
      {
        id: 'pba_1',
        contaId: 'conta_1',
        environment: 'TEST',
        status: 'ACTIVE',
        planCode: 'STARTER',
        stripeCustomerId: 'cus_test_1',
        stripeSubscriptionId: 'sub_test_1',
        stripePriceId: 'price_starter_test',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
        trialWillEndNotifiedAt: null,
        accessStatus: 'ACTIVE',
        gracePeriodEndsAt: null,
        restrictedAt: null,
        canceledAt: null,
        lastPaymentFailedAt: null,
        lastReconciledAt: null,
        pendingPlanCode: null,
        pendingChangeType: null,
        pendingChangeEffectiveAt: null,
      },
    ]);
    const stripeGateway = createStripeGatewayMock();

    const result = await createPlatformBillingPortalSession(
      {
        contaId: 'conta_1',
        returnUrl: 'https://app.alusa.test/billing',
        actorUserId: 'user_1',
        envSource,
      },
      { store, stripeGateway },
    );

    expect(result.portalUrl).toBe('https://billing.stripe.test/session');
    expect(stripeGateway.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test_1' }),
    );
    expect(store.auditLogs[0]?.action).toBe('PLATFORM_BILLING_PORTAL_SESSION_CREATED');
  });

  it('rejeita portal quando não há Stripe customer local', async () => {
    const store = createMemoryStore([
      {
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
      },
    ]);

    await expect(
      createPlatformBillingPortalSession(
        {
          contaId: 'conta_1',
          returnUrl: 'https://app.alusa.test/billing',
          envSource,
        },
        { store, stripeGateway: createStripeGatewayMock() },
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_BILLING_CUSTOMER_MISSING' });
  });
});

function buildCheckoutInput() {
  return {
    contaId: 'conta_1',
    contaName: 'Escola Alusa',
    planCode: 'STARTER',
    successUrl: 'https://app.alusa.test/billing/success',
    cancelUrl: 'https://app.alusa.test/billing/cancel',
    idempotencyKey: 'idem_1',
    envSource,
  };
}

function createStripeGatewayMock(): PlatformBillingStripeGateway {
  return {
    createCustomer: vi.fn(async () => ({ id: 'cus_test_1', livemode: false })),
    createCheckoutSession: vi.fn(async () => ({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.test/session',
      expiresAt: new Date('2026-06-28T12:00:00.000Z'),
    })),
    createTrialSubscriptionWithoutPaymentMethod: vi.fn(async () => ({
      id: 'sub_test_trial_1',
      customerId: 'cus_test_1',
      status: 'trialing',
      priceId: 'price_premium_test',
      currentPeriodEnd: new Date('2026-07-15T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      pendingUpdateId: null,
    })),
    createPortalSession: vi.fn(async () => ({
      id: 'bps_test_1',
      url: 'https://billing.stripe.test/session',
    })),
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
    checkoutSessions: PlatformBillingCheckoutSessionRecord[];
    invoices: PlatformBillingInvoiceRecord[];
    webhookEvents: PlatformBillingWebhookEventRecord[];
    auditLogs: PlatformBillingAuditLogInput[];
  } = {
    accounts,
    checkoutSessions,
    invoices,
    webhookEvents,
    auditLogs,
    async findAccount(input) {
      return (
        accounts.find(
          (account) => account.contaId === input.contaId && account.environment === input.environment,
        ) ?? null
      );
    },
    async findAccountByStripeCustomerId(input) {
      return (
        accounts.find(
          (account) =>
            account.environment === input.environment &&
            account.stripeCustomerId === input.stripeCustomerId,
        ) ?? null
      );
    },
    async findAccountByStripeSubscriptionId(input) {
      return (
        accounts.find(
          (account) =>
            account.environment === input.environment &&
            account.stripeSubscriptionId === input.stripeSubscriptionId,
        ) ?? null
      );
    },
    async createAccount(input) {
      const account: PlatformBillingAccountRecord = {
        id: `pba_${accounts.length + 1}`,
        contaId: input.contaId,
        environment: input.environment,
        status: 'NOT_STARTED',
        planCode: null,
        stripeCustomerId: input.stripeCustomerId,
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
      };
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
      if (input.pendingChangeType === 'REACTIVATE') {
        account.status = 'CANCELED';
        account.accessStatus = 'CANCELED';
      } else {
        account.status = 'CHECKOUT_PENDING';
        account.accessStatus = 'PENDING';
      }
      account.pendingPlanCode = input.planCode;
      account.pendingChangeType = input.pendingChangeType ?? null;
      account.pendingChangeEffectiveAt = null;
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
      return account;
    },
    async findCheckoutSessionByIdempotencyKey(input) {
      return (
        checkoutSessions.find(
          (session) =>
            session.contaId === input.contaId &&
            session.environment === input.environment &&
            session.idempotencyKey === input.idempotencyKey,
        ) ?? null
      );
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
      return invoices
        .filter((invoice) => invoice.contaId === input.contaId && invoice.environment === input.environment)
        .slice(0, input.limit ?? 24);
    },
    async upsertInvoice(input) {
      const current = invoices.find(
        (invoice) =>
          invoice.environment === input.environment &&
          invoice.stripeInvoiceId === input.stripeInvoiceId,
      );
      const next: PlatformBillingInvoiceRecord = {
        id: current?.id ?? `pbi_${invoices.length + 1}`,
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
      if (current) Object.assign(current, next);
      else invoices.push(next);
      return current ?? next;
    },
    async upsertWebhookEvent(input) {
      const current = webhookEvents.find(
        (event) => event.environment === input.environment && event.eventId === input.eventId,
      );
      if (current) return { record: current, inserted: false };
      const event: PlatformBillingWebhookEventRecord = {
        id: `pbwe_${webhookEvents.length + 1}`,
        environment: input.environment,
        eventId: input.eventId,
        eventType: input.eventType,
        contaId: input.contaId ?? null,
        status: 'RECEIVED',
        attempts: 0,
      };
      webhookEvents.push(event);
      return { record: event, inserted: true };
    },
    async markWebhookEventProcessing(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSING';
      event.contaId = input.contaId ?? event.contaId;
      event.attempts += 1;
      return event;
    },
    async markWebhookEventProcessed(input) {
      const event = webhookEvents.find((item) => item.id === input.id);
      if (!event) throw new Error('webhook event not found');
      event.status = 'PROCESSED';
      event.contaId = input.contaId ?? event.contaId;
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
      return event;
    },
    async createAuditLog(input) {
      auditLogs.push(input);
    },
  };

  return store;
}
