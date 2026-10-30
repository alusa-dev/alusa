import { randomUUID } from 'node:crypto';
import { parseStripeRuntimeConfig } from '@alusa/stripe';
import type { StripeEnvSource, StripeSubscriptionRecord } from '@alusa/stripe';
import { z } from 'zod';
import { PlatformBillingError } from './errors';
import { isStripePriceId, parsePublicCheckoutPlanCode, resolveStripePriceId } from './price-mapping';
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

function resolveKnownPriceId(planCode: PlatformPlanCode, environment: 'TEST' | 'LIVE', source?: StripeEnvSource, customPriceId?: string | null) {
  if (planCode === 'CUSTOM' && isStripePriceId(customPriceId)) return customPriceId;
  return resolveStripePriceId({ planCode, environment, source });
}

const createCheckoutInputSchema = z.object({
  contaId: nonEmptyString,
  contaName: nonEmptyString,
  billingEmail: z.string().trim().email().optional(),
  planCode: z.unknown(),
  stripePriceId: z.string().regex(/^price_[A-Za-z0-9_]+$/).optional(),
  invitationId: nonEmptyString.optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
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
  stripePriceId: z.string().regex(/^price_[A-Za-z0-9_]+$/).optional(),
  invitationId: nonEmptyString.optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  trialDays: z.union([z.literal(0), z.literal(7), z.literal(14), z.literal(21), z.literal(30), z.literal(60), z.literal(90)]).optional(),
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: idempotencyKeySchema,
  correlationId: nonEmptyString.optional(),
});

export interface CreatePlatformBillingCheckoutSessionInput {
  contaId: string;
  contaName: string;
  billingEmail?: string;
  planCode: unknown;
  stripePriceId?: string;
  invitationId?: string;
  quantity?: number;
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

export async function cancelPlatformBillingCheckoutReturn(input: {
  contaId: string;
  environment: 'TEST' | 'LIVE';
  actorUserId: string;
  idempotencyKey: string;
  correlationId?: string;
  envSource?: StripeEnvSource;
}, deps: { store: PlatformBillingStore; stripeGateway?: PlatformBillingStripeGateway }): Promise<'CANCELED' | 'ALREADY_CANCELED' | 'PENDING' | 'STALE'> {
  const account = await deps.store.findAccount({ contaId: input.contaId, environment: input.environment });
  const claimKey = account?.checkoutClaimKey;
  if (!account || !claimKey || account.checkoutClaimPhase !== 'REQUESTING') return 'ALREADY_CANCELED';
  if (claimKey !== input.idempotencyKey) return 'STALE';
  const checkout = await deps.store.findCheckoutSessionByIdempotencyKey({ contaId: input.contaId, environment: input.environment, idempotencyKey: claimKey });
  if (!checkout || checkout.idempotencyKey !== input.idempotencyKey ||
    checkoutCancelRequestKey(checkout.cancelUrl) !== checkout.idempotencyKey ||
    account.pendingPlanCode !== checkout.planCode) return 'STALE';
  const stripe = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
  const remote = await stripe.retrieveCheckoutSession(checkout.stripeCheckoutSessionId);
  const matches = (candidate: Awaited<ReturnType<PlatformBillingStripeGateway['retrieveCheckoutSession']>>) =>
    checkoutSessionBindingMatches({
      session: checkout,
      account,
      contaId: input.contaId,
      environment: input.environment,
      source: input.envSource,
      remote: candidate,
    });
  if (!matches(remote)) return 'PENDING';
  if (remote.status === 'complete') return 'PENDING';
  if (remote.status === 'open') {
    const latestBeforeExpire = await deps.store.findAccount({ contaId: input.contaId, environment: input.environment });
    if (!latestBeforeExpire || latestBeforeExpire.checkoutClaimKey !== claimKey ||
      latestBeforeExpire.checkoutClaimPhase !== 'REQUESTING' ||
      latestBeforeExpire.pendingPlanCode !== checkout.planCode ||
      !checkoutSessionBindingMatches({
        session: checkout,
        account: latestBeforeExpire,
        contaId: input.contaId,
        environment: input.environment,
        source: input.envSource,
        remote,
      })) return 'PENDING';
    try {
      await stripe.expireCheckoutSession(remote.id);
    } catch {
      // Another return/worker may have expired it concurrently. The following
      // read is authoritative before the local claim can be released.
    }
    const confirmed = await stripe.retrieveCheckoutSession(remote.id);
    if (!matches(confirmed) || confirmed.status !== 'expired') return 'PENDING';
  } else if (remote.status !== 'expired') return 'PENDING';
  const latestBeforeClear = await deps.store.findAccount({ contaId: input.contaId, environment: input.environment });
  const finalRemote = await stripe.retrieveCheckoutSession(checkout.stripeCheckoutSessionId);
  if (!latestBeforeClear || latestBeforeClear.checkoutClaimKey !== claimKey ||
    latestBeforeClear.checkoutClaimPhase !== 'REQUESTING' ||
    latestBeforeClear.pendingPlanCode !== checkout.planCode ||
    finalRemote.status !== 'expired' ||
    !checkoutSessionBindingMatches({
      session: checkout,
      account: latestBeforeClear,
      contaId: input.contaId,
      environment: input.environment,
      source: input.envSource,
      remote: finalRemote,
    })) return 'PENDING';
  await deps.store.markCheckoutSessionExpired({ contaId: input.contaId, environment: input.environment, idempotencyKey: claimKey });
  const cleared = await deps.store.clearCheckoutClaim({ contaId: input.contaId, environment: input.environment, idempotencyKey: claimKey });
  if (cleared) await deps.store.createAuditLog({
    contaId: input.contaId, billingAccountId: account.id, actorUserId: input.actorUserId,
    action: 'PLATFORM_BILLING_CHECKOUT_CANCELED', entityType: 'PlatformBillingCheckoutSession',
    entityId: checkout.id, correlationId: input.correlationId,
    metadata: { environment: input.environment, stripeCheckoutSessionId: checkout.stripeCheckoutSessionId },
  });
  return 'CANCELED';
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
  stripePriceId?: string;
  invitationId?: string;
  quantity?: number;
  trialDays?: number;
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
  actorUserId: string | null;
  environment: 'TEST' | 'LIVE';
  idempotencyKey: string;
  changeType?: 'UPGRADE' | 'DOWNGRADE';
  idempotencySuffix?: string;
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
      changeType: 'UPGRADE' | 'DOWNGRADE';
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
  const changeType = input.changeType ?? 'DOWNGRADE';
  if (
    input.account.stripeSubscriptionId !== input.planChange.stripeSubscriptionId
    || input.account.planCode !== input.planChange.fromPlanCode
    || (input.account.pendingPlanCode && input.account.pendingPlanCode !== input.planChange.toPlanCode)
    || (input.account.pendingPlanCode === input.planChange.toPlanCode
      && input.account.pendingChangeOperationId !== input.planChange.id)
  ) {
    throw new PlatformBillingError(
      'Account plan changed before price-band scheduling or recovery.',
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
    changeType,
    claimToken,
    claimAt: now,
    claimExpiresBefore: new Date(now.getTime() - 5 * 60_000),
  });
  if (!reserved) {
    throw new PlatformBillingError(
      'Another plan-change operation currently owns the account reservation.',
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
        input.idempotencySuffix ?? (changeType === 'DOWNGRADE' ? 'stripe-downgrade' : 'stripe-band-transition'),
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
      actorUserId: input.actorUserId ?? undefined,
      action: changeType === 'DOWNGRADE'
        ? 'PLATFORM_BILLING_DOWNGRADE_SCHEDULED'
        : 'PLATFORM_BILLING_BAND_TRANSITION_SCHEDULED',
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

function checkoutReconciliationRequired(contaId: string, environment: 'TEST' | 'LIVE'): PlatformBillingError {
  return new PlatformBillingError(
    'The existing Stripe Checkout session must be reconciled before another checkout can be created.',
    'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED',
    { contaId, environment },
  );
}

function checkoutCancelStudentCount(cancelUrl: string): string | null {
  return new URL(cancelUrl).searchParams.get('studentCount');
}

function checkoutCancelRequestKey(cancelUrl: string): string | null {
  const key = new URL(cancelUrl).searchParams.get('checkoutRequestKey');
  return key && key.length <= 128 && key.trim() === key ? key : null;
}

function checkoutSessionBindingMatches(input: {
  session: PlatformBillingCheckoutSessionRecord;
  account: PlatformBillingAccountRecord;
  contaId: string;
  environment: 'TEST' | 'LIVE';
  source?: StripeEnvSource;
  remote: Awaited<ReturnType<PlatformBillingStripeGateway['retrieveCheckoutSession']>> | null;
}): boolean {
  const { session, account, remote } = input;
  if (!remote || !account.stripeCustomerId ||
    account.contaId !== input.contaId ||
    account.environment !== input.environment ||
    session.contaId !== input.contaId ||
    session.environment !== input.environment ||
    session.billingAccountId !== account.id ||
    session.stripeCustomerId !== account.stripeCustomerId ||
    session.idempotencyKey.length === 0 ||
    remote.id !== session.stripeCheckoutSessionId ||
    remote.livemode !== (input.environment === 'LIVE') ||
    remote.customerId !== account.stripeCustomerId ||
    remote.clientReferenceId !== input.contaId ||
    remote.metadata.contaId !== input.contaId ||
    remote.metadata.planCode !== session.planCode ||
    remote.metadata.checkoutRequestKey !== session.idempotencyKey ||
    remote.metadata.billingContext !== 'platform' ||
    remote.priceIds.length !== 1 ||
    remote.priceIds[0] !== session.stripePriceId) {
    return false;
  }

  try {
    return resolveKnownPriceId(session.planCode, input.environment, input.source, session.stripePriceId) === session.stripePriceId;
  } catch {
    return false;
  }
}

export async function createPlatformBillingCheckoutSession(
  input: CreatePlatformBillingCheckoutSessionInput,
  deps: CreatePlatformBillingCheckoutSessionDeps,
): Promise<CreatePlatformBillingCheckoutSessionResult> {
  const parsed = parseCheckoutInput(input);
  const config = parseStripeRuntimeConfig(input.envSource);
  const planCode = parsed.planCode === 'CUSTOM' && isStripePriceId(parsed.stripePriceId)
    ? 'CUSTOM'
    : parsePublicCheckoutPlanCode(parsed.planCode);
  if (planCode === 'CUSTOM' && (!isStripePriceId(parsed.stripePriceId) || !parsed.invitationId)) {
    throw new PlatformBillingError('Custom plan requires a validated invitation Price.', 'PLATFORM_BILLING_INPUT_INVALID');
  }
  if (checkoutCancelRequestKey(parsed.cancelUrl) !== parsed.idempotencyKey) {
    throw new PlatformBillingError(
      'Checkout cancel URL must be bound to its request key.',
      'PLATFORM_BILLING_INPUT_INVALID',
    );
  }
  const stripePriceId = planCode === 'CUSTOM' ? parsed.stripePriceId! : resolveStripePriceId({
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
    if (existingSession.stripePriceId !== stripePriceId) {
      throw new PlatformBillingError('Checkout idempotency key was already used for a different Stripe Price.', 'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT');
    }
    const existingAccount = await deps.store.findAccount({ contaId: parsed.contaId, environment: config.environment });
    const existingStripeGateway = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
    if (existingAccount) {
      await assertNoRemoteNonterminalSubscription({
        gateway: existingStripeGateway,
        account: existingAccount,
        contaId: parsed.contaId,
        environment: config.environment,
        source: input.envSource,
        allowExpiredTrialPause: isExpiredUnpaidTrialReactivation(existingAccount),
      });
    }
    if (existingAccount?.stripeSubscriptionId && !isReactivationCheckoutAccount(existingAccount)) {
      throw new PlatformBillingError(
        'An active or pending Stripe subscription already exists for this account.',
        'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
        { contaId: parsed.contaId, environment: config.environment },
      );
    }
    if (existingSession.idempotencyKey !== parsed.idempotencyKey ||
      (existingAccount?.checkoutClaimKey && existingAccount.checkoutClaimKey !== existingSession.idempotencyKey)) {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
    }
    if (checkoutCancelStudentCount(existingSession.cancelUrl) !== checkoutCancelStudentCount(parsed.cancelUrl)) {
      throw new PlatformBillingError(
        'Checkout idempotency key was already used with a different student count.',
        'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
        { contaId: parsed.contaId, environment: config.environment, idempotencyKey: parsed.idempotencyKey },
      );
    }
    if (checkoutCancelRequestKey(existingSession.cancelUrl) !== existingSession.idempotencyKey) {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
    }
    const remote = existingAccount
      ? await existingStripeGateway.retrieveCheckoutSession(existingSession.stripeCheckoutSessionId)
      : null;
    if (!existingAccount || !remote || !checkoutSessionBindingMatches({
      session: existingSession,
      account: existingAccount,
      contaId: parsed.contaId,
      environment: config.environment,
      source: input.envSource,
      remote,
    })) {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
    }
    if (remote.status === 'expired') {
      if (existingAccount.checkoutClaimKey && existingAccount.checkoutClaimKey !== existingSession.idempotencyKey) {
        throw checkoutReconciliationRequired(parsed.contaId, config.environment);
      }
      await deps.store.markCheckoutSessionExpired({
        contaId: parsed.contaId,
        environment: config.environment,
        idempotencyKey: existingSession.idempotencyKey,
      });
      const cleared = await deps.store.clearCheckoutClaim({
        contaId: parsed.contaId,
        environment: config.environment,
        idempotencyKey: existingSession.idempotencyKey,
      });
      const latestAccount = await deps.store.findAccount({ contaId: parsed.contaId, environment: config.environment });
      if (!cleared && latestAccount?.checkoutClaimKey) {
        throw checkoutReconciliationRequired(parsed.contaId, config.environment);
      }
      throw new PlatformBillingError(
        'The prior Checkout session is confirmed expired. Retry with a fresh request key.',
        'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED',
        { contaId: parsed.contaId, environment: config.environment },
      );
    }
    if (remote.status !== 'open' || existingSession.status !== 'CREATED' || !existingSession.url) {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
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
  await assertNoRemoteNonterminalSubscription({
    gateway: stripeGateway,
    account,
    contaId: parsed.contaId,
    environment: config.environment,
    source: input.envSource,
    allowExpiredTrialPause: isExpiredUnpaidTrialReactivation(account),
  });
  // Trials are started only through the no-card trial endpoint. Checkout is
  // always an explicit paid subscription confirmation.
  const trialDays = null;
  const isReactivation = isReactivationCheckoutAccount(account);
  const reactivationOrigin = isReactivation ? {
    subscriptionId: account.stripeSubscriptionId,
    planCode: account.planCode,
    priceId: account.stripePriceId,
  } : null;
  const reactivationMetadata = reactivationOrigin?.subscriptionId && reactivationOrigin.planCode && reactivationOrigin.priceId
    ? {
        reactivationFromSubscriptionId: reactivationOrigin.subscriptionId,
        reactivationFromPlanCode: reactivationOrigin.planCode,
        reactivationFromPriceId: reactivationOrigin.priceId,
      }
    : null;
  if (isReactivation && !reactivationMetadata) {
    throw checkoutReconciliationRequired(parsed.contaId, config.environment);
  }

  if (account.stripeSubscriptionId && !isReactivation) {
    throw new PlatformBillingError(
      'An active or pending Stripe subscription already exists for this account.',
      'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
      { contaId: parsed.contaId, environment: config.environment },
    );
  }

  if (account.checkoutClaimPhase === 'REQUESTING' && account.checkoutClaimKey) {
    const claimKey = account.checkoutClaimKey;
    const pendingSession = await deps.store.findCheckoutSessionByIdempotencyKey({
      contaId: parsed.contaId,
      environment: config.environment,
      idempotencyKey: claimKey,
    });
    const remote = pendingSession
      ? await stripeGateway.retrieveCheckoutSession(pendingSession.stripeCheckoutSessionId)
      : null;
    if (!pendingSession || !remote || !checkoutSessionBindingMatches({
      session: pendingSession,
      account,
      contaId: parsed.contaId,
      environment: config.environment,
      source: input.envSource,
      remote,
    }) || account.checkoutClaimKey !== pendingSession.idempotencyKey || account.pendingPlanCode !== pendingSession.planCode) {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
    }

    if (remote.status === 'open') {
      if (pendingSession.status !== 'CREATED') {
        throw checkoutReconciliationRequired(parsed.contaId, config.environment);
      }
      const sameSelection = pendingSession.planCode === planCode &&
        pendingSession.stripePriceId === stripePriceId &&
        checkoutCancelStudentCount(pendingSession.cancelUrl) === checkoutCancelStudentCount(parsed.cancelUrl) &&
        checkoutCancelRequestKey(pendingSession.cancelUrl) === pendingSession.idempotencyKey;
      if (sameSelection) {
        if (!pendingSession.url) {
          throw checkoutReconciliationRequired(parsed.contaId, config.environment);
        }
        return {
          billingAccountId: pendingSession.billingAccountId,
          checkoutSessionId: pendingSession.stripeCheckoutSessionId,
          checkoutUrl: pendingSession.url,
          reused: true,
          record: pendingSession,
        };
      }

      // A changed selection may replace the open session only after Stripe
      // confirms it is no longer payable. Never expire a session with a broken
      // or mismatched persisted binding.
      try {
        await stripeGateway.expireCheckoutSession(remote.id);
      } catch {
        // A concurrent cancel/expiry can win the race; the read below is the
        // authority for whether the old session can safely be replaced.
      }
      const afterExpire = await stripeGateway.retrieveCheckoutSession(remote.id);
      if (afterExpire.id !== remote.id || !checkoutSessionBindingMatches({
        session: pendingSession,
        account,
        contaId: parsed.contaId,
        environment: config.environment,
        source: input.envSource,
        remote: afterExpire,
      }) || afterExpire.status !== 'expired') {
        throw checkoutReconciliationRequired(parsed.contaId, config.environment);
      }
    } else if (remote.status !== 'expired') {
      throw checkoutReconciliationRequired(parsed.contaId, config.environment);
    }

    await deps.store.markCheckoutSessionExpired({
      contaId: parsed.contaId,
      environment: config.environment,
      idempotencyKey: claimKey,
    });
    const cleared = await deps.store.clearCheckoutClaim({
      contaId: parsed.contaId,
      environment: config.environment,
      idempotencyKey: claimKey,
    });
    if (!cleared) {
      // Stripe can deliver checkout.session.expired while this request is
      // clearing the same claim. Ask the bounded client retry to use a fresh
      // request key only after the old session and account are revalidated.
      const latestAccount = await deps.store.findAccount({ contaId: parsed.contaId, environment: config.environment });
      const latestRemote = await stripeGateway.retrieveCheckoutSession(pendingSession.stripeCheckoutSessionId);
      if (!latestAccount || latestAccount.checkoutClaimKey || latestAccount.checkoutClaimPhase ||
        latestRemote.status !== 'expired' || !checkoutSessionBindingMatches({
          session: pendingSession,
          account: latestAccount,
          contaId: parsed.contaId,
          environment: config.environment,
          source: input.envSource,
          remote: latestRemote,
        })) {
        throw checkoutReconciliationRequired(parsed.contaId, config.environment);
      }
      if (latestAccount.stripeSubscriptionId && !isReactivationCheckoutAccount(latestAccount)) {
        throw new PlatformBillingError(
          'An active or pending Stripe subscription already exists for this account.',
          'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
          { contaId: parsed.contaId, environment: config.environment },
        );
      }
      throw new PlatformBillingError(
        'The prior Checkout session is confirmed expired. Retry with a fresh request key.',
        'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED',
        { contaId: parsed.contaId, environment: config.environment },
      );
    }
    await deps.store.createAuditLog({
      contaId: parsed.contaId,
      billingAccountId: account.id,
      actorUserId: parsed.actorUserId,
      action: 'PLATFORM_BILLING_CHECKOUT_CANCELED',
      entityType: 'PlatformBillingCheckoutSession',
      entityId: pendingSession.id,
      correlationId: parsed.correlationId ?? parsed.idempotencyKey,
      metadata: {
        environment: config.environment,
        stripeCheckoutSessionId: pendingSession.stripeCheckoutSessionId,
        replacedByPlanCode: planCode,
      },
    });
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
      quantity: parsed.quantity,
      metadata: {
        contaId: parsed.contaId,
        planCode,
        billingContext: 'platform',
      trialDays: trialDays ? String(trialDays) : '0',
      ...(planCode === 'CUSTOM' ? { conditionType: 'custom', invitationId: parsed.invitationId!, studentCount: String(parsed.quantity ?? 1) } : {}),
        flow: isReactivation ? 'reactivation' : 'subscription',
        checkoutRequestKey: parsed.idempotencyKey,
        ...(reactivationMetadata ?? {}),
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

  if (!checkoutSession.url) {
    throw checkoutReconciliationRequired(parsed.contaId, config.environment);
  }

  return {
    billingAccountId: account.id,
    checkoutSessionId: checkoutSession.id,
    checkoutUrl: checkoutSession.url,
    reused: false,
    record,
  };
}

const NONTERMINAL_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused',
]);

async function assertNoRemoteNonterminalSubscription(input: {
  gateway: PlatformBillingStripeGateway;
  account: PlatformBillingAccountRecord;
  contaId: string;
  environment: 'TEST' | 'LIVE';
  source?: StripeEnvSource;
  allowExpiredTrialPause?: boolean;
}): Promise<void> {
  const customerId = input.account.stripeCustomerId;
  if (!customerId || input.account.contaId !== input.contaId || input.account.environment !== input.environment) {
    throw checkoutReconciliationRequired(input.contaId, input.environment);
  }
  const result = await input.gateway.listCustomerSubscriptions(customerId);
  if (!result.complete) throw checkoutReconciliationRequired(input.contaId, input.environment);

  const candidates = result.subscriptions.filter((subscription) =>
    NONTERMINAL_STRIPE_SUBSCRIPTION_STATUSES.has(subscription.status),
  );
  if (candidates.length === 0) return;

  let allowedExpiredTrialPause = false;
  for (const subscription of candidates) {
    const metadataPlan = subscription.metadata.planCode;
    let expectedPriceId: string | null = null;
    try {
      if (metadataPlan) {
        expectedPriceId = resolveKnownPriceId(metadataPlan as PlatformPlanCode, input.environment, input.source, input.account.stripePriceId);
      }
    } catch {
      // An unrecognized remote subscription is ambiguous and blocks Checkout.
    }
    if (subscription.customerId !== customerId ||
      subscription.livemode !== (input.environment === 'LIVE') ||
      subscription.metadata.contaId !== input.contaId ||
      subscription.metadata.billingContext !== 'platform' ||
      !expectedPriceId || subscription.priceIds.length !== 1 ||
      subscription.priceIds[0] !== expectedPriceId) {
      throw checkoutReconciliationRequired(input.contaId, input.environment);
    }
    if (subscription.status === 'paused' &&
      input.allowExpiredTrialPause &&
      subscription.id === input.account.stripeSubscriptionId) {
      allowedExpiredTrialPause = true;
      continue;
    }
  }

  if (candidates.length > 1) throw checkoutReconciliationRequired(input.contaId, input.environment);
  if (allowedExpiredTrialPause) return;
  throw new PlatformBillingError(
    'An active or pending Stripe subscription already exists for this account.',
    'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
    { contaId: input.contaId, environment: input.environment },
  );
}

export async function createPlatformBillingTrialWithoutPaymentMethod(
  input: CreatePlatformBillingTrialWithoutPaymentMethodInput,
  deps: CreatePlatformBillingTrialWithoutPaymentMethodDeps,
): Promise<CreatePlatformBillingTrialWithoutPaymentMethodResult> {
  const parsed = parseTrialWithoutPaymentMethodInput(input);
  const config = parseStripeRuntimeConfig(input.envSource);
  const planCode: PlatformPlanCode = parsed.planCode === 'CUSTOM' && isStripePriceId(parsed.stripePriceId)
    ? 'CUSTOM'
    : parsePublicCheckoutPlanCode(parsed.planCode);
  if (planCode === 'CUSTOM' && (!isStripePriceId(parsed.stripePriceId) || !parsed.invitationId)) {
    throw new PlatformBillingError('Custom trial requires a validated school invitation Price.', 'PLATFORM_BILLING_INPUT_INVALID');
  }
  const stripePriceId = planCode === 'CUSTOM' ? parsed.stripePriceId! : resolveStripePriceId({
    planCode,
    environment: config.environment,
    source: input.envSource,
  });

  const stripeGateway = deps.stripeGateway ?? createDefaultPlatformBillingStripeGateway(input.envSource);
  const trialDays = parsed.trialDays ?? getPlatformPlan(planCode).trialDays;
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
      quantity: parsed.quantity,
      metadata: {
        contaId: parsed.contaId,
        planCode,
        billingContext: 'platform',
        trialDays: String(trialDays),
        source: 'finance-wizard-register-later',
        ...(planCode === 'CUSTOM' && parsed.invitationId ? { conditionType: 'custom', invitationId: parsed.invitationId, studentCount: String(parsed.quantity ?? 1) } : {}),
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

function isReactivationCheckoutAccount(account: PlatformBillingAccountRecord): boolean {
  return Boolean(
    account.stripeSubscriptionId &&
    account.planCode &&
    (account.status === 'CANCELED' ||
      account.accessStatus === 'CANCELED' ||
      account.pendingChangeType === 'REACTIVATE' ||
      (account.status === 'PAUSED' &&
        account.trialEndsAt && account.trialEndsAt.getTime() <= Date.now() &&
        !account.firstPaidAt && !account.lastSuccessfulPaymentAt) ||
      (account.status === 'TRIALING' &&
        account.trialEndsAt && account.trialEndsAt.getTime() <= Date.now() &&
        !account.firstPaidAt && !account.lastSuccessfulPaymentAt)),
  );
}

function isExpiredUnpaidTrialReactivation(account: PlatformBillingAccountRecord): boolean {
  return Boolean(
    (account.status === 'PAUSED' || account.status === 'TRIALING' ||
      (account.status === 'CANCELED' && account.stripeSubscriptionId !== null && account.planCode !== null)) &&
    account.trialEndsAt && account.trialEndsAt.getTime() <= Date.now() &&
    !account.firstPaidAt && !account.lastSuccessfulPaymentAt,
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

  if (account.status === 'TRIALING' &&
    account.trialEndsAt && account.trialEndsAt.getTime() > Date.now() &&
    !account.firstPaidAt && !account.lastSuccessfulPaymentAt) {
    throw new PlatformBillingError(
      'Payment details cannot be collected during a trial without explicit paid checkout confirmation.',
      'PLATFORM_BILLING_TRIAL_CHECKOUT_REQUIRED',
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

  // A legacy canceled subscription can still be the authoritative link to the
  // account's Stripe customer. Recover that association only after fresh reads
  // confirm both the subscription link and that the customer still exists.
  if (existingAccount?.stripeSubscriptionId && isReactivationCheckoutAccount(existingAccount)) {
    const subscription = await input.stripeGateway.retrieveSubscription(existingAccount.stripeSubscriptionId);
    const pausedExpiredTrial = subscription.status === 'paused' &&
      isExpiredUnpaidTrialReactivation(existingAccount) &&
      subscription.trialEndsAt !== null &&
      subscription.trialEndsAt.getTime() <= Date.now();
    if (
      subscription.id !== existingAccount.stripeSubscriptionId ||
      (subscription.status !== 'canceled' && !pausedExpiredTrial) ||
      !subscription.customerId
    ) {
      throw new PlatformBillingError(
        'The legacy Stripe customer could not be safely recovered for reactivation.',
        'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE',
        { contaId: input.contaId, environment: input.environment },
      );
    }

    const legacyCustomer = await input.stripeGateway.retrieveCustomer(subscription.customerId);
    if (legacyCustomer.id !== subscription.customerId) {
      throw new PlatformBillingError(
        'The Stripe customer returned for the legacy subscription did not match its customer reference.',
        'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE',
        { contaId: input.contaId, environment: input.environment },
      );
    }
    if (!legacyCustomer.deleted) {
      const customerOwner = await input.store.findAccountByStripeCustomerId({
        environment: input.environment,
        stripeCustomerId: legacyCustomer.id,
      });
      if (customerOwner && customerOwner.id !== existingAccount.id) {
        throw new PlatformBillingError(
          'The legacy Stripe customer is already associated with another billing account.',
          'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE',
          { contaId: input.contaId, environment: input.environment },
        );
      }
      return input.store.attachCustomer({
        accountId: existingAccount.id,
        stripeCustomerId: legacyCustomer.id,
      }) as Promise<PlatformBillingAccountRecord & { stripeCustomerId: string }>;
    }
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
