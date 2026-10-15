import { randomUUID } from 'node:crypto';
import { parseStripeRuntimeConfig } from '@alusa/stripe';
import type { StripeEnvSource, StripeSubscriptionRecord } from '@alusa/stripe';
import { z } from 'zod';
import { PlatformBillingError } from './errors';
import { parsePublicCheckoutPlanCode, resolveStripePriceId } from './price-mapping';
import { getPlatformPlan } from './plans';
import { createDefaultPlatformBillingStripeGateway } from './stripe-gateway';
import type {
  PlatformBillingAccountRecord,
  PlatformBillingAuditLogInput,
  PlatformBillingCheckoutSessionRecord,
  PlatformBillingStore,
  PlatformBillingStripeGateway,
} from './types';
import type { PlatformPlanCode, PublicPlatformPlanCode } from './plans';

const nonEmptyString = z.string().trim().min(1);
const idempotencyKeySchema = nonEmptyString.max(128);
const urlSchema = z.string().trim().url();

const createCheckoutInputSchema = z.object({
  contaId: nonEmptyString,
  contaName: nonEmptyString,
  billingEmail: z.string().trim().email().optional(),
  planCode: z.unknown(),
  successUrl: urlSchema,
  cancelUrl: urlSchema,
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: idempotencyKeySchema,
  correlationId: nonEmptyString.optional(),
});

const createPortalInputSchema = z.object({
  contaId: nonEmptyString,
  returnUrl: urlSchema,
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: idempotencyKeySchema,
  correlationId: nonEmptyString.optional(),
});

const createTrialWithoutPaymentMethodInputSchema = z.object({
  contaId: nonEmptyString,
  contaName: nonEmptyString,
  billingEmail: z.string().trim().email().optional(),
  planCode: z.unknown(),
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: idempotencyKeySchema,
  correlationId: nonEmptyString.optional(),
});

export interface CreatePlatformBillingCheckoutSessionInput {
  contaId: string;
  contaName: string;
  billingEmail?: string;
  planCode: unknown;
  successUrl: string;
  cancelUrl: string;
  actorUserId?: string;
  idempotencyKey: string;
  correlationId?: string;
  envSource?: StripeEnvSource;
}

export interface CreatePlatformBillingCheckoutSessionDeps {
  store: PlatformBillingStore;
  stripeGateway?: PlatformBillingStripeGateway;
}

export interface CreatePlatformBillingCheckoutSessionResult {
  billingAccountId: string;
  checkoutSessionId: string;
  checkoutUrl: string | null;
  reused: boolean;
  record: PlatformBillingCheckoutSessionRecord;
}

export interface CreatePlatformBillingPortalSessionInput {
  contaId: string;
  returnUrl: string;
  actorUserId?: string;
  idempotencyKey: string;
  correlationId?: string;
  envSource?: StripeEnvSource;
}

export interface CreatePlatformBillingTrialWithoutPaymentMethodInput {
  contaId: string;
  contaName: string;
  billingEmail?: string;
  planCode: unknown;
  actorUserId?: string;
  idempotencyKey: string;
  correlationId?: string;
  envSource?: StripeEnvSource;
}

export interface CreatePlatformBillingTrialWithoutPaymentMethodDeps {
  store: PlatformBillingStore;
  stripeGateway?: PlatformBillingStripeGateway;
}

export interface CreatePlatformBillingTrialWithoutPaymentMethodResult {
  billingAccountId: string;
  stripeSubscriptionId: string;
  trialEndsAt: Date | null;
  reused: boolean;
  account: PlatformBillingAccountRecord;
}

export interface CreatePlatformBillingPortalSessionDeps {
  store: PlatformBillingStore;
  stripeGateway?: PlatformBillingStripeGateway;
}

export interface CreatePlatformBillingPortalSessionResult {
  billingAccountId: string;
  portalSessionId: string;
  portalUrl: string;
}

export interface SchedulePlatformBillingDowngradeInput {
  contaId: string;
  billingAccountId: string;
  actorUserId: string;
  environment: 'TEST' | 'LIVE';
  idempotencyKey: string;
  planChange: {
    id: string;
    fromPlanCode: PlatformPlanCode;
    toPlanCode: PublicPlatformPlanCode;
    stripeSubscriptionId: string;
    stripePriceId: string;
    effectiveAt: Date;
  };
  account: {
    planCode: PlatformPlanCode;
    stripeSubscriptionId: string;
    pendingPlanCode: PlatformPlanCode | null;
    pendingChangeOperationId: string | null;
  };
  activeStudents: number;
}

export interface SchedulePlatformBillingDowngradeDeps {
  now?: () => Date;
  stripeGateway: Pick<PlatformBillingStripeGateway, 'scheduleSubscriptionPlanChange'>;
  store: {
    reservePendingPlan(_input: {
      contaId: string;
      environment: 'TEST' | 'LIVE';
      billingAccountId: string;
      stripeSubscriptionId: string;
      fromPlanCode: PlatformPlanCode;
      toPlanCode: PublicPlatformPlanCode;
      effectiveAt: Date;
      operationId: string;
      claimToken: string;
      claimAt: Date;
      claimExpiresBefore: Date;
    }): Promise<boolean>;
    releasePendingPlanClaim(_input: { billingAccountId: string; operationId: string; claimToken: string }): Promise<void>;
    completePendingPlanClaim(_input: { billingAccountId: string; operationId: string; claimToken: string; effectiveAt: Date }): Promise<boolean>;
    persistSchedule(_input: {
      planChangeId: string;
      scheduleId: string;
      activeStudents: number;
      claimToken: string;
    }): Promise<boolean>;
    createAuditLog(_input: PlatformBillingAuditLogInput): Promise<void>;
  };
}

/**
 * Reserves the tenant account before calling Stripe. The Stripe idempotency
 * key is anchored to the durable plan-change ID, so lease recovery for the same
 * operation replays the identical provider request. Ambiguous provider errors
 * keep the claim; only an explicit Stripe invalid-request response is known to
 * have had no side effect and may release it.
 */
export async function schedulePlatformBillingDowngrade(
  input: SchedulePlatformBillingDowngradeInput,
  deps: SchedulePlatformBillingDowngradeDeps,
): Promise<{ scheduleId: string; effectiveAt: Date }> {
  if (
    input.account.stripeSubscriptionId !== input.planChange.stripeSubscriptionId
    || input.account.planCode !== input.planChange.fromPlanCode
    || (input.account.pendingPlanCode && input.account.pendingPlanCode !== input.planChange.toPlanCode)
    || (input.account.pendingPlanCode === input.planChange.toPlanCode
      && input.account.pendingChangeOperationId !== input.planChange.id)
  ) {
    throw new PlatformBillingError(
      'Account plan changed before downgrade scheduling or recovery.',
      'PLATFORM_BILLING_REPLAY_INVALID',
      { contaId: input.contaId, planChangeId: input.planChange.id },
    );
  }

  const now = deps.now?.() ?? new Date();
  const claimToken = randomUUID();
  const reserved = await deps.store.reservePendingPlan({
    contaId: input.contaId,
    environment: input.environment,
    billingAccountId: input.billingAccountId,
    stripeSubscriptionId: input.planChange.stripeSubscriptionId,
    fromPlanCode: input.planChange.fromPlanCode,
    toPlanCode: input.planChange.toPlanCode,
    effectiveAt: input.planChange.effectiveAt,
    operationId: input.planChange.id,
    claimToken,
    claimAt: now,
    claimExpiresBefore: new Date(now.getTime() - 5 * 60_000),
  });
  if (!reserved) {
    throw new PlatformBillingError(
      'Another downgrade operation currently owns the account reservation.',
      'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS',
      { contaId: input.contaId, planChangeId: input.planChange.id },
    );
  }

  let schedule: { scheduleId: string; effectiveAt: Date };
  try {
    schedule = await deps.stripeGateway.scheduleSubscriptionPlanChange({
      subscriptionId: input.planChange.stripeSubscriptionId,
      priceId: input.planChange.stripePriceId,
      effectiveAt: input.planChange.effectiveAt,
      metadata: {
        contaId: input.contaId,
        planCode: input.planChange.toPlanCode,
        billingContext: 'platform',
        planChangeId: input.planChange.id,
      },
      idempotencyKey: stripeIdempotencyKey(
        input.environment,
        input.contaId,
        `plan-change:${input.planChange.id}`,
        'stripe-downgrade',
      ),
    });
  } catch (error) {
    if (isDefinitiveStripeNoEffect(error)) {
      await deps.store.releasePendingPlanClaim({
        billingAccountId: input.billingAccountId,
        operationId: input.planChange.id,
        claimToken,
      });
    }
    throw error;
  }

  const persisted = await deps.store.persistSchedule({
    planChangeId: input.planChange.id,
    scheduleId: schedule.scheduleId,
    activeStudents: input.activeStudents,
    claimToken,
  });
  if (!persisted) {
    throw new PlatformBillingError(
      'Downgrade schedule exists, but this worker no longer owns the claim; retry with the same plan change.',
      'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS',
      { contaId: input.contaId, planChangeId: input.planChange.id },
    );
  }
  const completed = await deps.store.completePendingPlanClaim({
    billingAccountId: input.billingAccountId,
    operationId: input.planChange.id,
    claimToken,
    effectiveAt: schedule.effectiveAt,
  });
  if (!completed) {
    throw new PlatformBillingError(
      'Downgrade schedule persisted but its account reservation could not be finalized; retry after the claim lease expires.',
      'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS',
      { contaId: input.contaId, planChangeId: input.planChange.id },
    );
  }
  await deps.store.createAuditLog({
    contaId: input.contaId,
    billingAccountId: input.billingAccountId,
    actorUserId: input.actorUserId,
    action: 'PLATFORM_BILLING_DOWNGRADE_SCHEDULED',
    entityType: 'PlatformBillingPlanChange',
    entityId: input.planChange.id,
    correlationId: input.idempotencyKey,
    metadata: { fromPlanCode: input.planChange.fromPlanCode, toPlanCode: input.planChange.toPlanCode },
  });

  return schedule;
}

function isDefinitiveStripeNoEffect(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { type?: unknown; statusCode?: unknown };
  return candidate.type === 'StripeInvalidRequestError' && candidate.statusCode === 400;
}

export async function createPlatformBillingCheckoutSession(
  input: CreatePlatformBillingCheckoutSessionInput,
  deps: CreatePlatformBillingCheckoutSessionDeps,
): Promise<CreatePlatformBillingCheckoutSessionResult> {
  const parsed = parseCheckoutInput(input);
  const config = parseStripeRuntimeConfig(input.envSource);
  const planCode = parsePublicCheckoutPlanCode(parsed.planCode);
  const stripePriceId = resolveStripePriceId({
    planCode,
    environment: config.environment,
    source: input.envSource,
  });

  const existingSession = await deps.store.findCheckoutSessionByIdempotencyKey({
    contaId: parsed.contaId,
    environment: config.environment,
    idempotencyKey: parsed.idempotencyKey,
  });

  if (existingSession) {
    if (existingSession.planCode !== planCode) {
      throw new PlatformBillingError(
        'Checkout idempotency key was already used for a different plan.',
        'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        {
          contaId: parsed.contaId,
          environment: config.environment,
          idempotencyKey: parsed.idempotencyKey,
          existingPlanCode: existingSession.planCode,
          requestedPlanCode: planCode,
        },
      );
    }
    return {
      billingAccountId: existingSession.billingAccountId,
      checkoutSessionId: existingSession.stripeCheckoutSessionId,
      checkoutUrl: existingSession.url,
      reused: true,
      record: existingSession,
    };
  }

  const stripeGateway = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
  const account = await ensureBillingAccount({
    store: deps.store,
    stripeGateway,
    contaId: parsed.contaId,
    contaName: parsed.contaName,
    billingEmail: parsed.billingEmail,
    environment: config.environment,
    idempotencyKey: accountCustomerStripeIdempotencyKey(config.environment, parsed.contaId),
  });
  const trialDays = resolveTrialDaysForCheckout(account, planCode);
  const isReactivation = isReactivationCheckoutAccount(account);

  if (account.stripeSubscriptionId && !isReactivation) {
    throw new PlatformBillingError(
      'An active or pending Stripe subscription already exists for this account.',
      'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
      { contaId: parsed.contaId, environment: config.environment },
    );
  }

  // Claim the account before calling Stripe so two different requests cannot
  // both pass the local eligibility check and create subscriptions.
  await deps.store.markCheckoutPending({
    accountId: account.id,
    planCode,
    stripePriceId,
    pendingChangeType: isReactivation ? 'REACTIVATE' : null,
    idempotencyKey: parsed.idempotencyKey,
  });
  await deps.store.markCheckoutRequestStarted({ accountId: account.id, idempotencyKey: parsed.idempotencyKey });

  let checkoutSession: Awaited<ReturnType<PlatformBillingStripeGateway['createCheckoutSession']>>;
  try {
    checkoutSession = await stripeGateway.createCheckoutSession({
      customerId: account.stripeCustomerId,
      priceId: stripePriceId,
      successUrl: parsed.successUrl,
      cancelUrl: parsed.cancelUrl,
      clientReferenceId: parsed.contaId,
      metadata: {
        contaId: parsed.contaId,
        planCode,
        billingContext: 'platform',
        trialDays: trialDays ? String(trialDays) : '0',
        flow: isReactivation ? 'reactivation' : 'subscription',
        checkoutRequestKey: parsed.idempotencyKey,
      },
      trialDays,
      idempotencyKey: stripeIdempotencyKey(config.environment, parsed.contaId, 'checkout', parsed.idempotencyKey),
    });
  } catch (error) {
    // A Stripe 400 is a definitive rejection: Stripe did not create a Checkout
    // Session, so release this request's claim. Network/5xx failures remain
    // claimed because Stripe may have accepted the request before the failure.
    if (isDefinitiveStripeNoEffect(error)) {
      await deps.store.clearCheckoutClaim({
        contaId: parsed.contaId,
        environment: config.environment,
        idempotencyKey: parsed.idempotencyKey,
      });
    }
    throw error;
  }

  const record = await deps.store.createCheckoutSession({
    contaId: parsed.contaId,
    billingAccountId: account.id,
    environment: config.environment,
    planCode,
    stripeCheckoutSessionId: checkoutSession.id,
    stripeCustomerId: account.stripeCustomerId,
    stripePriceId,
    url: checkoutSession.url,
    successUrl: parsed.successUrl,
    cancelUrl: parsed.cancelUrl,
    idempotencyKey: parsed.idempotencyKey,
    createdByUserId: parsed.actorUserId,
    expiresAt: checkoutSession.expiresAt,
  });

  await deps.store.createAuditLog({
    contaId: parsed.contaId,
    billingAccountId: account.id,
    actorUserId: parsed.actorUserId,
    action: isReactivation
      ? 'PLATFORM_BILLING_REACTIVATION_CHECKOUT_SESSION_CREATED'
      : 'PLATFORM_BILLING_CHECKOUT_SESSION_CREATED',
    entityType: 'PlatformBillingCheckoutSession',
    entityId: record.id,
    correlationId: parsed.correlationId ?? parsed.idempotencyKey,
    metadata: {
      environment: config.environment,
      planCode,
      stripeCheckoutSessionId: checkoutSession.id,
      trialDays,
      flow: isReactivation ? 'reactivation' : 'subscription',
    },
  });

  return {
    billingAccountId: account.id,
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    reused: false,
    record,
  };
}

export async function createPlatformBillingTrialWithoutPaymentMethod(
  input: CreatePlatformBillingTrialWithoutPaymentMethodInput,
  deps: CreatePlatformBillingTrialWithoutPaymentMethodDeps,
): Promise<CreatePlatformBillingTrialWithoutPaymentMethodResult> {
  const parsed = parseTrialWithoutPaymentMethodInput(input);
  const config = parseStripeRuntimeConfig(input.envSource);
  const planCode = parsePublicCheckoutPlanCode(parsed.planCode);
  const stripePriceId = resolveStripePriceId({
    planCode,
    environment: config.environment,
    source: input.envSource,
  });

  const stripeGateway = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
  const trialDays = getPlatformPlan(planCode).trialDays;
  if (!trialDays || trialDays <= 0) {
    throw new PlatformBillingError(
      'Selected platform plan does not support trial.',
      'PLATFORM_BILLING_TRIAL_UNAVAILABLE',
      { contaId: parsed.contaId, environment: config.environment, planCode },
    );
  }

  const account = await deps.store.reserveTrialSubscriptionClaim({
    contaId: parsed.contaId,
    environment: config.environment,
    idempotencyKey: parsed.idempotencyKey,
  });
  if (account.stripeSubscriptionId) {
    return {
      billingAccountId: account.id,
      stripeSubscriptionId: account.stripeSubscriptionId,
      trialEndsAt: account.trialEndsAt,
      reused: true,
      account,
    };
  }
  if (account.trialEndsAt) {
    throw new PlatformBillingError(
      'Platform billing trial was already used for this account.',
      'PLATFORM_BILLING_TRIAL_ALREADY_USED',
      { contaId: parsed.contaId, environment: config.environment },
    );
  }

  await deps.store.markTrialSubscriptionRequestStarted({
    contaId: parsed.contaId,
    environment: config.environment,
    idempotencyKey: parsed.idempotencyKey,
  });

  let accountWithCustomer: PlatformBillingAccountRecord & { stripeCustomerId: string };
  let subscription: StripeSubscriptionRecord;
  try {
    accountWithCustomer = await ensureBillingAccount({
      store: deps.store,
      stripeGateway,
      contaId: parsed.contaId,
      contaName: parsed.contaName,
      billingEmail: parsed.billingEmail,
      environment: config.environment,
      idempotencyKey: accountCustomerStripeIdempotencyKey(config.environment, parsed.contaId),
    });

    subscription = await stripeGateway.createTrialSubscriptionWithoutPaymentMethod({
      customerId: accountWithCustomer.stripeCustomerId,
      priceId: stripePriceId,
      metadata: {
        contaId: parsed.contaId,
        planCode,
        billingContext: 'platform',
        trialDays: String(trialDays),
        source: 'finance-wizard-register-later',
      },
      trialDays,
      idempotencyKey: stripeIdempotencyKey(config.environment, parsed.contaId, 'trial-subscription', parsed.idempotencyKey),
    });
  } catch (error) {
    if (isDefinitiveStripeNoEffect(error)) {
      await deps.store.releaseTrialSubscriptionClaim({
        contaId: parsed.contaId,
        environment: config.environment,
        idempotencyKey: parsed.idempotencyKey,
      });
    }
    throw error;
  }

  let updated: PlatformBillingAccountRecord;
  try {
    updated = await deps.store.updateAccountFromStripeSubscription({
      accountId: account.id,
      expectedAccountSnapshot: {
        contaId: parsed.contaId,
        environment: config.environment,
        stripeSubscriptionId: null,
        pendingChangeOperationId: account.pendingChangeOperationId,
        pendingChangeClaimToken: account.pendingChangeClaimToken ?? null,
        trialSubscriptionClaimKey: parsed.idempotencyKey,
      },
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      planCode,
      stripeSubscriptionId: subscription.id,
      stripePriceId,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      pendingPlanCode: null,
      pendingChangeType: null,
      pendingChangeEffectiveAt: null,
      lastStripeEventId: 'local:trial_without_payment_method',
    });
  } catch (error) {
    const current = await deps.store.findAccount({ contaId: parsed.contaId, environment: config.environment });
    if (current?.stripeSubscriptionId === subscription.id) {
      return {
        billingAccountId: current.id,
        stripeSubscriptionId: subscription.id,
        trialEndsAt: current.trialEndsAt,
        reused: true,
        account: current,
      };
    }
    throw error;
  }

  await deps.store.createAuditLog({
    contaId: parsed.contaId,
    billingAccountId: updated.id,
    actorUserId: parsed.actorUserId,
    action: 'PLATFORM_BILLING_TRIAL_WITHOUT_PAYMENT_METHOD_CREATED',
    entityType: 'StripeSubscription',
    entityId: subscription.id,
    correlationId: parsed.correlationId ?? parsed.idempotencyKey,
    metadata: {
      environment: config.environment,
      planCode,
      stripePriceId,
      stripeSubscriptionId: subscription.id,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    },
  });

  return {
    billingAccountId: updated.id,
    stripeSubscriptionId: subscription.id,
    trialEndsAt: updated.trialEndsAt,
    reused: false,
    account: updated,
  };
}

function resolveTrialDaysForCheckout(
  account: PlatformBillingAccountRecord,
  planCode: ReturnType<typeof parsePublicCheckoutPlanCode>,
): number | null {
  if (account.stripeSubscriptionId || account.trialEndsAt) return null;

  const trialDays = getPlatformPlan(planCode).trialDays;
  return typeof trialDays === 'number' && trialDays > 0 ? trialDays : null;
}

function isReactivationCheckoutAccount(account: PlatformBillingAccountRecord): boolean {
  return Boolean(
    account.stripeSubscriptionId &&
    account.planCode &&
    (account.status === 'CANCELED' ||
      account.accessStatus === 'CANCELED' ||
      account.pendingChangeType === 'REACTIVATE'),
  );
}

export async function createPlatformBillingPortalSession(
  input: CreatePlatformBillingPortalSessionInput,
  deps: CreatePlatformBillingPortalSessionDeps,
): Promise<CreatePlatformBillingPortalSessionResult> {
  const parsed = parsePortalInput(input);
  const config = parseStripeRuntimeConfig(input.envSource);
  const account = await deps.store.findAccount({
    contaId: parsed.contaId,
    environment: config.environment,
  });

  if (!account) {
    throw new PlatformBillingError(
      'Platform billing account was not found.',
      'PLATFORM_BILLING_ACCOUNT_NOT_FOUND',
      { contaId: parsed.contaId, environment: config.environment },
    );
  }

  if (!account.stripeCustomerId) {
    throw new PlatformBillingError(
      'Platform billing account has no Stripe customer.',
      'PLATFORM_BILLING_CUSTOMER_MISSING',
      { contaId: parsed.contaId, environment: config.environment },
    );
  }

  const stripeGateway = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
  const portalSession = await stripeGateway.createPortalSession({
    customerId: account.stripeCustomerId,
    returnUrl: parsed.returnUrl,
    configurationId: input.envSource?.STRIPE_BILLING_PORTAL_CONFIGURATION_ID ?? process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
    idempotencyKey: stripeIdempotencyKey(config.environment, parsed.contaId, 'portal', parsed.idempotencyKey),
  });

  await deps.store.createAuditLog({
    contaId: parsed.contaId,
    billingAccountId: account.id,
    actorUserId: parsed.actorUserId,
    action: 'PLATFORM_BILLING_PORTAL_SESSION_CREATED',
    entityType: 'PlatformBillingAccount',
    entityId: account.id,
    correlationId: parsed.correlationId ?? parsed.idempotencyKey,
    metadata: {
      environment: config.environment,
      stripePortalSessionId: portalSession.id,
    },
  });

  return {
    billingAccountId: account.id,
    portalSessionId: portalSession.id,
    portalUrl: portalSession.url,
  };
}

async function ensureBillingAccount(input: {
  store: PlatformBillingStore;
  stripeGateway: PlatformBillingStripeGateway;
  contaId: string;
  contaName: string;
  billingEmail?: string;
  environment: 'TEST' | 'LIVE';
  idempotencyKey: string;
}): Promise<PlatformBillingAccountRecord & { stripeCustomerId: string }> {
  const existingAccount = await input.store.findAccount({
    contaId: input.contaId,
    environment: input.environment,
  });

  if (existingAccount?.stripeCustomerId) {
    return existingAccount as PlatformBillingAccountRecord & { stripeCustomerId: string };
  }

  const customer = await input.stripeGateway.createCustomer({
    name: input.contaName,
    email: input.billingEmail,
    metadata: {
      contaId: input.contaId,
      billingContext: 'platform',
    },
    idempotencyKey: input.idempotencyKey,
  });

  if (existingAccount) {
    return input.store.attachCustomer({
      accountId: existingAccount.id,
      stripeCustomerId: customer.id,
    }) as Promise<PlatformBillingAccountRecord & { stripeCustomerId: string }>;
  }

  return input.store.createAccount({
    contaId: input.contaId,
    environment: input.environment,
    stripeCustomerId: customer.id,
  }) as Promise<PlatformBillingAccountRecord & { stripeCustomerId: string }>;
}

function stripeIdempotencyKey(
  environment: 'TEST' | 'LIVE',
  contaId: string,
  operation: string,
  requestKey: string,
): string {
  // Stripe scopes keys to the Stripe account, so include our tenant and
  // environment namespace to prevent accidental collisions between tenants.
  const key = `alusa:${environment}:${contaId}:${operation}:${requestKey}`;
  if (key.length > 255) {
    throw new PlatformBillingError('Stripe idempotency key exceeds the provider limit.', 'PLATFORM_BILLING_INPUT_INVALID');
  }
  return key;
}

function accountCustomerStripeIdempotencyKey(environment: 'TEST' | 'LIVE', contaId: string): string {
  return stripeIdempotencyKey(environment, contaId, 'customer', 'platform-account');
}

function parseCheckoutInput(input: CreatePlatformBillingCheckoutSessionInput) {
  const parsed = createCheckoutInputSchema.safeParse(input);

  if (!parsed.success) {
    const missingIdempotency = !input.idempotencyKey?.trim();
    throw new PlatformBillingError(
      missingIdempotency ? 'Checkout idempotency key is required.' : 'Platform billing input is invalid.',
      missingIdempotency ? 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED' : 'PLATFORM_BILLING_INPUT_INVALID',
      { fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean) },
    );
  }

  return parsed.data;
}

function parsePortalInput(input: CreatePlatformBillingPortalSessionInput) {
  const parsed = createPortalInputSchema.safeParse(input);

  if (!parsed.success) {
    const missingIdempotency = !input.idempotencyKey?.trim();
    throw new PlatformBillingError(
      missingIdempotency ? 'Portal idempotency key is required.' : 'Platform billing input is invalid.',
      missingIdempotency ? 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED' : 'PLATFORM_BILLING_INPUT_INVALID',
      {
      fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean),
      },
    );
  }

  return parsed.data;
}

function parseTrialWithoutPaymentMethodInput(input: CreatePlatformBillingTrialWithoutPaymentMethodInput) {
  const parsed = createTrialWithoutPaymentMethodInputSchema.safeParse(input);

  if (!parsed.success) {
    const missingIdempotency = !input.idempotencyKey?.trim();
    throw new PlatformBillingError(
      missingIdempotency ? 'Trial idempotency key is required.' : 'Platform billing input is invalid.',
      missingIdempotency ? 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED' : 'PLATFORM_BILLING_INPUT_INVALID',
      { fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean) },
    );
  }

  return parsed.data;
}
