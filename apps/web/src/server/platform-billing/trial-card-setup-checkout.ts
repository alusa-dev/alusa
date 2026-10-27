import {
  StripeIntegrationError,
  createStripeSetupCheckoutSession,
  customerHasDefaultPaymentMethod,
  allowStripePaymentMethodRedisplay,
  getStripeClient,
  listStripeCheckoutSessionsForCustomerSince,
  retrieveStripeSetupCheckoutSession,
  retrieveStripeSetupIntent,
} from '@alusa/stripe';
import { runWithTenant } from '@/lib/prisma-tenant';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';
import { resolvePlatformBillingEnvironment, resolvePlatformBillingActor } from '@/src/server/platform-billing/platform-billing-server';
import { completeTrialCardSetupSession, TRIAL_CARD_SETUP_SUCCESS_ACTION } from '@/src/server/platform-billing/trial-card-setup-webhook';

const TRIAL_CARD_CONSENT_VERSION = '2026-10-27-v1';
const TRIAL_CARD_CONSENT_TEXT = 'Autorizo salvar este cartão para futuras cobranças recorrentes mensais da assinatura Alusa. O valor depende da faixa de alunos ativos e será exibido antes de eu confirmar a contratação paga. Este cadastro não inicia assinatura nem cobrança; o trial não será convertido automaticamente. O cancelamento da assinatura paga vale ao fim do período vigente.';
const TRIAL_CARD_SETUP_EXPIRED_ACTION = 'PLATFORM_BILLING_TRIAL_CARD_SETUP_EXPIRED';
const TRIAL_CARD_SETUP_NO_SESSION_ACTION = 'PLATFORM_BILLING_TRIAL_CARD_SETUP_NO_SESSION_CONFIRMED';
// Stripe retains API v1 idempotency results for at least 24 hours; add a buffer before a full read-only scan.
const STRIPE_IDEMPOTENCY_RECONCILIATION_AGE_MS = 26 * 60 * 60 * 1000;

type SetupCheckoutHttpResult = { readonly kind: 'http'; readonly status: number; readonly body: Record<string, unknown> };
type SetupCheckoutOutcome = SetupCheckoutHttpResult;

function setupResult(body: Record<string, unknown>, init?: { status?: number }): SetupCheckoutHttpResult {
  return { kind: 'http', status: init?.status ?? 200, body };
}

function isSetupResult(value: unknown): value is SetupCheckoutHttpResult {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'http');
}

export interface TrialCardSetupCandidate {
  contaId: string;
  userId: string;
  billingAccountId: string;
  customerId: string | null;
  subscriptionId: string | null;
}

export async function startTrialCardSetupCheckout(input: {
  setupCandidate: TrialCardSetupCandidate;
  consentAccepted: boolean;
  idempotencyKey: string;
  requestId: string;
  origin: string;
}): Promise<SetupCheckoutOutcome> {

  if (!input.consentAccepted) {
    return setupResult({ error: 'PLATFORM_BILLING_CARD_CONSENT_REQUIRED' }, { status: 400 });
  }
  if (!input.setupCandidate.customerId) return setupResult({ error: 'PLATFORM_BILLING_CUSTOMER_REQUIRED' }, { status: 409 });
  const stripe = getStripeClient(process.env);
  try {
    if (await customerHasDefaultPaymentMethod(stripe, input.setupCandidate.customerId, input.setupCandidate.subscriptionId)) {
      return setupResult({ error: 'PLATFORM_BILLING_DEFAULT_PAYMENT_METHOD_EXISTS' }, { status: 409 });
    }
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.platform_billing.portal.failed', route: '/api/platform-billing/portal', method: 'POST', requestId: input.requestId, error });
    return setupResult({ error: 'PLATFORM_BILLING_SETUP_PREFLIGHT_UNAVAILABLE' }, { status: 503 });
  }

  await reconcileOldIndeterminateSetup({
    contaId: input.setupCandidate.contaId,
    billingAccountId: input.setupCandidate.billingAccountId,
    customerId: input.setupCandidate.customerId,
    environment: resolvePlatformBillingEnvironment(),
    stripe,
    requestId: input.requestId,
  });

  const environment = resolvePlatformBillingEnvironment();
  const stripeIdempotencyKey = `optional-card:${environment}:${input.setupCandidate.contaId}:${input.idempotencyKey}`;
  const intent = await runWithTenant(input.setupCandidate.contaId, async (tx) => {
    const actor = await resolvePlatformBillingActor({ tx, contaId: input.setupCandidate.contaId, userId: input.setupCandidate.userId });
    if (!actor.canManagePlatformBilling) return setupResult({ error: 'SEM_PERMISSAO' }, { status: 403 });
    const currentAccount = await tx.platformBillingAccount.findUnique({
      where: { uq_platform_billing_account_conta_env: { contaId: input.setupCandidate.contaId, environment } },
      select: { id: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true, trialEndsAt: true, firstPaidAt: true, lastSuccessfulPaymentAt: true },
    });
    if (!currentAccount || currentAccount.id !== input.setupCandidate.billingAccountId
      || currentAccount.stripeCustomerId !== input.setupCandidate.customerId
      || currentAccount.stripeSubscriptionId !== input.setupCandidate.subscriptionId
      || !currentAccount.trialEndsAt || currentAccount.trialEndsAt.getTime() <= Date.now()
      || currentAccount.firstPaidAt || currentAccount.lastSuccessfulPaymentAt
      || currentAccount.status === 'ACTIVE' || currentAccount.status === 'PAST_DUE') {
      return setupResult({ error: 'PLATFORM_BILLING_TRIAL_CARD_RETRY_REQUIRED' }, { status: 409 });
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trial-card:${environment}:${input.setupCandidate.billingAccountId}`}, 0))`;
    const activeClaim = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED' },
      orderBy: { createdAt: 'desc' },
      select: { correlationId: true },
    });
    if (activeClaim?.correlationId && activeClaim.correlationId !== input.idempotencyKey) {
      const [verifiedExpired, verifiedNoSession] = await Promise.all([
        tx.platformBillingAuditLog.findFirst({ where: { contaId: input.setupCandidate.contaId,
          billingAccountId: input.setupCandidate.billingAccountId, action: TRIAL_CARD_SETUP_EXPIRED_ACTION,
          correlationId: activeClaim.correlationId }, select: { id: true } }),
        tx.platformBillingAuditLog.findFirst({ where: { contaId: input.setupCandidate.contaId,
          billingAccountId: input.setupCandidate.billingAccountId, action: TRIAL_CARD_SETUP_NO_SESSION_ACTION,
          correlationId: activeClaim.correlationId }, select: { id: true } }),
      ]);
      const unresolvedFailure = await tx.platformBillingAuditLog.findFirst({ where: { contaId: input.setupCandidate.contaId,
        billingAccountId: input.setupCandidate.billingAccountId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED',
        correlationId: activeClaim.correlationId }, select: { id: true } });
      const previousSession = await tx.platformBillingAuditLog.findFirst({
        where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
          action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', correlationId: activeClaim.correlationId },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, metadata: true },
      });
      const previousSessionId = previousSession?.entityId;
      const previousSessionMetadata = readRecord(previousSession?.metadata);
      const previousExpiresAt = typeof previousSessionMetadata.expiresAt === 'string'
        ? Date.parse(previousSessionMetadata.expiresAt) : Number.NaN;
      const localSessionExpired = Number.isFinite(previousExpiresAt) && previousExpiresAt <= Date.now();
      const completed = previousSessionId ? await tx.platformBillingAuditLog.findFirst({
        where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
          action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED', entityId: previousSessionId },
        select: { id: true },
      }) : null;
      if (!completed && !verifiedExpired && !verifiedNoSession) {
        if (unresolvedFailure || localSessionExpired) return setupResult({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' }, { status: 503 });
        return setupResult({ error: 'PLATFORM_BILLING_SETUP_CHECKOUT_ALREADY_OPEN' }, { status: 409 });
      }
    }
    if (!activeClaim || activeClaim.correlationId !== input.idempotencyKey) {
      await tx.platformBillingAuditLog.create({ data: {
        contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        actorUserId: input.setupCandidate.userId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED',
        entityType: 'StripeSetupCheckout', entityId: input.idempotencyKey, correlationId: input.idempotencyKey,
        metadata: { status: 'REQUESTED', consentVersion: TRIAL_CARD_CONSENT_VERSION },
      } });
    }
    const prior = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', correlationId: input.idempotencyKey },
      select: { id: true, metadata: true },
    });
    const metadata = prior?.metadata && typeof prior.metadata === 'object' ? prior.metadata as Record<string, unknown> : {};
    const acceptedAt = typeof metadata.acceptedAt === 'string' ? metadata.acceptedAt : new Date().toISOString();
    if (!prior) {
      await tx.platformBillingAuditLog.create({ data: {
        contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        actorUserId: input.setupCandidate.userId, action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT',
        entityType: 'StripeSetupCheckout', entityId: input.idempotencyKey, correlationId: input.idempotencyKey,
        metadata: { version: TRIAL_CARD_CONSENT_VERSION, acceptedAt, text: TRIAL_CARD_CONSENT_TEXT, status: 'REQUESTED' },
      } });
    }
    const completedSetup = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_COMPLETED', correlationId: input.idempotencyKey },
      select: { id: true },
    });
    if (completedSetup) return { acceptedAt, setupUrl: null, sessionId: null, setupCompleted: true };
    const ambiguousFailure = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED', correlationId: input.idempotencyKey },
      select: { id: true },
    });
    const noSessionResolution = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        action: TRIAL_CARD_SETUP_NO_SESSION_ACTION, correlationId: input.idempotencyKey },
      select: { id: true },
    });
    const expiredResolution = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
        action: TRIAL_CARD_SETUP_EXPIRED_ACTION, correlationId: input.idempotencyKey },
      select: { id: true },
    });
    if (expiredResolution) return setupResult({ error: 'PLATFORM_BILLING_SETUP_SESSION_EXPIRED_NEW_KEY_REQUIRED' }, { status: 409 });
    if (noSessionResolution) return setupResult({ error: 'PLATFORM_BILLING_SETUP_RETRY_WITH_NEW_KEY' }, { status: 409 });
    if (ambiguousFailure) {
      return setupResult({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' }, { status: 503 });
    }
    const existingResult = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', correlationId: input.idempotencyKey },
      select: { metadata: true },
    });
    const resultMetadata = existingResult?.metadata && typeof existingResult.metadata === 'object'
      ? existingResult.metadata as Record<string, unknown> : null;
    const localExpiresAt = typeof resultMetadata?.expiresAt === 'string' ? Date.parse(resultMetadata.expiresAt) : Number.NaN;
    if (Number.isFinite(localExpiresAt) && localExpiresAt <= Date.now()) {
      return setupResult({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' }, { status: 503 });
    }
    return { acceptedAt, setupUrl: typeof resultMetadata?.setupUrl === 'string' ? resultMetadata.setupUrl : null,
      sessionId: typeof resultMetadata?.sessionId === 'string' ? resultMetadata.sessionId : null };
  });
  if (isSetupResult(intent)) return intent;
  if (intent.setupCompleted) return setupResult({ setupCompleted: true });
  if (intent.setupUrl && intent.sessionId) {
    return setupResult({ setupSessionId: intent.sessionId, setupUrl: intent.setupUrl });
  }

  let setup: Awaited<ReturnType<typeof createStripeSetupCheckoutSession>>;
  try {
    setup = await createStripeSetupCheckoutSession(stripe, {
      customerId: input.setupCandidate.customerId, currency: 'brl',
      successUrl: `${input.origin}/account/billing-plan?setup=success`,
      cancelUrl: `${input.origin}/account/billing-plan?setup=canceled`,
      clientReferenceId: input.setupCandidate.contaId,
      metadata: {
        contaId: input.setupCandidate.contaId, billingContext: 'platform',
        checkoutPurpose: 'optional_trial_payment_method', consentVersion: TRIAL_CARD_CONSENT_VERSION,
        consentAcceptedAt: intent.acceptedAt,
        consentRequestKey: input.idempotencyKey,
      },
      idempotencyKey: stripeIdempotencyKey,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
  } catch (error) {
    await runWithTenant(input.setupCandidate.contaId, async (tx) => tx.platformBillingAuditLog.create({ data: {
      contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
      actorUserId: input.setupCandidate.userId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_FAILED',
      entityType: 'StripeSetupCheckout', entityId: input.idempotencyKey, correlationId: input.idempotencyKey,
      metadata: { consentVersion: TRIAL_CARD_CONSENT_VERSION, outcome: 'INDETERMINATE',
        resolution: 'webhook_or_manual_reconciliation_required',
        errorCode: error instanceof StripeIntegrationError ? error.code : 'STRIPE_SETUP_FAILED' },
    } }));
    logApiOperationalEvent({ severity: 'error', eventName: 'api.platform_billing.portal.failed', route: '/api/platform-billing/portal', method: 'POST', requestId: input.requestId, error });
    return setupResult({ error: 'PLATFORM_BILLING_SETUP_RECONCILIATION_REQUIRED' }, { status: 503 });
  }
  const persistedSetup = await runWithTenant(input.setupCandidate.contaId, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trial-card:${environment}:${input.setupCandidate.contaId}:${input.idempotencyKey}`}, 0))`;
    const existingResult = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.setupCandidate.contaId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', correlationId: input.idempotencyKey },
      select: { metadata: true },
    });
    const existingMetadata = existingResult?.metadata && typeof existingResult.metadata === 'object'
      ? existingResult.metadata as Record<string, unknown> : null;
    if (typeof existingMetadata?.sessionId === 'string' && typeof existingMetadata.setupUrl === 'string') {
      return { sessionId: existingMetadata.sessionId, setupUrl: existingMetadata.setupUrl };
    }
    await tx.platformBillingAuditLog.create({ data: {
      contaId: input.setupCandidate.contaId, billingAccountId: input.setupCandidate.billingAccountId,
      actorUserId: input.setupCandidate.userId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED',
      entityType: 'StripeSetupCheckout', entityId: setup.id, correlationId: input.idempotencyKey,
      metadata: { consentVersion: TRIAL_CARD_CONSENT_VERSION, consentAcceptedAt: intent.acceptedAt,
        sessionId: setup.id, setupUrl: setup.url, expiresAt: setup.expiresAt?.toISOString() ?? null },
    } });
    return { sessionId: setup.id, setupUrl: setup.url };
  });
  return setupResult({ setupSessionId: persistedSetup.sessionId, setupUrl: persistedSetup.setupUrl });


}

async function reconcileOldIndeterminateSetup(input: {
  contaId: string;
  billingAccountId: string;
  customerId: string;
  environment: ReturnType<typeof resolvePlatformBillingEnvironment>;
  stripe: Parameters<typeof listStripeCheckoutSessionsForCustomerSince>[0];
  requestId: string;
}): Promise<void> {
  const candidate = await runWithTenant(input.contaId, async (tx) => {
    const claim = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED' },
      orderBy: { createdAt: 'desc' },
      select: { correlationId: true, createdAt: true },
    });
    if (!claim?.correlationId || !claim.createdAt) return null;
    const [expired, noSession, completed, consent, sessionAudit] = await Promise.all([
      tx.platformBillingAuditLog.findFirst({ where: { contaId: input.contaId,
        billingAccountId: input.billingAccountId, action: TRIAL_CARD_SETUP_EXPIRED_ACTION,
        correlationId: claim.correlationId }, select: { id: true } }),
      tx.platformBillingAuditLog.findFirst({ where: { contaId: input.contaId,
        billingAccountId: input.billingAccountId, action: TRIAL_CARD_SETUP_NO_SESSION_ACTION,
        correlationId: claim.correlationId }, select: { id: true } }),
    tx.platformBillingAuditLog.findFirst({ where: { contaId: input.contaId,
      billingAccountId: input.billingAccountId, action: TRIAL_CARD_SETUP_SUCCESS_ACTION,
      correlationId: claim.correlationId }, select: { id: true } }),
      tx.platformBillingAuditLog.findFirst({ where: { contaId: input.contaId,
        billingAccountId: input.billingAccountId, action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT',
        correlationId: claim.correlationId }, select: { metadata: true } }),
      tx.platformBillingAuditLog.findFirst({ where: { contaId: input.contaId,
        billingAccountId: input.billingAccountId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED',
        correlationId: claim.correlationId }, orderBy: { createdAt: 'desc' }, select: { entityId: true, metadata: true } }),
    ]);
    if (expired || noSession || completed) return null;
    const metadata = consent?.metadata && typeof consent.metadata === 'object'
      ? consent.metadata as Record<string, unknown> : {};
    if (metadata.status !== 'REQUESTED' || typeof metadata.version !== 'string'
      || typeof metadata.acceptedAt !== 'string') return null;
    const sessionMetadata = readRecord(sessionAudit?.metadata);
    const localExpiresAt = typeof sessionMetadata.expiresAt === 'string' ? Date.parse(sessionMetadata.expiresAt) : Number.NaN;
    const expiredLocally = Boolean(sessionAudit?.entityId && Number.isFinite(localExpiresAt) && localExpiresAt <= Date.now());
    if (!expiredLocally && Date.now() - claim.createdAt.getTime() < STRIPE_IDEMPOTENCY_RECONCILIATION_AGE_MS) return null;
    return { requestKey: claim.correlationId, createdAt: claim.createdAt,
      consentVersion: metadata.version, acceptedAt: metadata.acceptedAt,
      ...(expiredLocally && typeof sessionAudit?.entityId === 'string' ? { knownSessionId: sessionAudit.entityId } : {}) };
  });
  if (!candidate) return;

  let sessionId = candidate.knownSessionId ?? null;
  let scanCount = 0;
  let createdAfter = new Date(candidate.createdAt.getTime() - 60_000);
  if (!sessionId) {
    let listing: Awaited<ReturnType<typeof listStripeCheckoutSessionsForCustomerSince>>;
    try {
      listing = await listStripeCheckoutSessionsForCustomerSince(input.stripe, input.customerId, createdAfter);
    } catch (error) {
      logApiOperationalEvent({ severity: 'error', eventName: 'api.platform_billing.portal.failed', route: '/api/platform-billing/portal', method: 'POST', requestId: input.requestId, error });
      return;
    }
    if (!listing.complete) return;
    scanCount = listing.sessions.length;
    const byRequestKey = listing.sessions.filter((session) => {
      const metadata = readRecord(session.metadata);
      return metadata.consentRequestKey === candidate.requestKey;
    });
    if (byRequestKey.length > 1) return;
    const listedSession = byRequestKey[0];
    if (!listedSession) {
      const unresolvedRelatedSessions = listing.sessions.some((session) => {
        const metadata = readRecord(session.metadata);
        return session.mode === 'setup' && session.client_reference_id === input.contaId
          && readStripeCustomerId(session.customer) === input.customerId
          && metadata.contaId === input.contaId && metadata.billingContext === 'platform'
          && metadata.checkoutPurpose === 'optional_trial_payment_method';
      });
      if (unresolvedRelatedSessions) return;
      await recordNoSetupSession(input, candidate, scanCount, createdAfter);
      return;
    }

    const listedMetadata = readRecord(listedSession.metadata);
    if (listedSession.mode !== 'setup' || listedSession.client_reference_id !== input.contaId
      || readStripeCustomerId(listedSession.customer) !== input.customerId
      || listedMetadata.contaId !== input.contaId || listedMetadata.billingContext !== 'platform'
      || listedMetadata.checkoutPurpose !== 'optional_trial_payment_method'
      || listedMetadata.consentVersion !== candidate.consentVersion
      || listedMetadata.consentAcceptedAt !== candidate.acceptedAt) return;
    sessionId = typeof listedSession.id === 'string' ? listedSession.id : null;
  }
  if (!sessionId) return;
  let session: Record<string, unknown>;
  try {
    session = await retrieveStripeSetupCheckoutSession(input.stripe, sessionId);
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.platform_billing.portal.failed', route: '/api/platform-billing/portal', method: 'POST', requestId: input.requestId, error });
    return;
  }
  const metadata = readRecord(session.metadata);
  if (session.id !== sessionId || session.mode !== 'setup'
    || !['open', 'expired', 'complete'].includes(String(session.status))
    || session.client_reference_id !== input.contaId || readStripeCustomerId(session.customer) !== input.customerId
    || metadata.contaId !== input.contaId || metadata.billingContext !== 'platform'
    || metadata.checkoutPurpose !== 'optional_trial_payment_method'
    || metadata.consentRequestKey !== candidate.requestKey || metadata.consentVersion !== candidate.consentVersion
    || metadata.consentAcceptedAt !== candidate.acceptedAt) return;

  if (session.status === 'open') return;

  if (session.status === 'complete') {
    try {
      await reconcileCompletedTrialCardSetup(input, candidate, sessionId);
    } catch (error) {
      logApiOperationalEvent({ severity: 'error', eventName: 'api.platform_billing.portal.failed', route: '/api/platform-billing/portal', method: 'POST', requestId: input.requestId, error });
    }
    return;
  }

  await runWithTenant(input.contaId, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trial-card-terminal:${input.environment}:${input.contaId}:${sessionId}`}, 0))`;
    const currentClaim = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED' },
      orderBy: { createdAt: 'desc' }, select: { correlationId: true },
    });
    if (currentClaim?.correlationId !== candidate.requestKey) return;
    const existing = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: TRIAL_CARD_SETUP_EXPIRED_ACTION, webhookEnvironment: input.environment, entityId: sessionId }, select: { id: true },
    });
    if (existing) return;
    const sessionAudit = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', correlationId: candidate.requestKey, entityId: sessionId },
      select: { id: true },
    });
    if (!sessionAudit) await tx.platformBillingAuditLog.create({ data: {
      contaId: input.contaId, billingAccountId: input.billingAccountId,
      action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', entityType: 'StripeSetupCheckout',
      entityId: sessionId, correlationId: candidate.requestKey,
      metadata: { sessionId, recoveredViaReadOnlyReconciliation: true,
        expiresAt: typeof session.expires_at === 'number' ? new Date(session.expires_at * 1000).toISOString() : null },
    } });
    await tx.platformBillingAuditLog.create({ data: {
      contaId: input.contaId, billingAccountId: input.billingAccountId,
      action: TRIAL_CARD_SETUP_EXPIRED_ACTION, webhookEnvironment: input.environment, entityType: 'StripeSetupCheckout',
      entityId: sessionId, correlationId: candidate.requestKey,
      metadata: { verifiedBy: candidate.knownSessionId ? 'local_session_retrieve' : 'customer_session_list_and_retrieve',
        scanCount, resolvedAt: new Date().toISOString() },
    } });
  });
}

async function recordNoSetupSession(
  input: { contaId: string; billingAccountId: string; environment: ReturnType<typeof resolvePlatformBillingEnvironment> },
  candidate: { requestKey: string; createdAt: Date },
  scannedCount: number,
  createdAfter: Date,
): Promise<void> {
  await runWithTenant(input.contaId, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trial-card:${input.environment}:${input.billingAccountId}`}, 0))`;
    const currentClaim = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED' },
      orderBy: { createdAt: 'desc' }, select: { correlationId: true },
    });
    if (currentClaim?.correlationId !== candidate.requestKey) return;
    const existing = await tx.platformBillingAuditLog.findFirst({
      where: { contaId: input.contaId, billingAccountId: input.billingAccountId,
        action: TRIAL_CARD_SETUP_NO_SESSION_ACTION, correlationId: candidate.requestKey }, select: { id: true },
    });
    if (existing) return;
    await tx.platformBillingAuditLog.create({ data: {
      contaId: input.contaId, billingAccountId: input.billingAccountId,
      action: TRIAL_CARD_SETUP_NO_SESSION_ACTION, entityType: 'StripeSetupCheckout',
      entityId: candidate.requestKey, correlationId: candidate.requestKey,
      metadata: { verifiedBy: 'complete_customer_session_list', scannedCount,
        claimCreatedAt: candidate.createdAt.toISOString(), searchedCreatedAfter: createdAfter.toISOString(),
        stripeIdempotencyRetentionElapsed: true, resolvedAt: new Date().toISOString() },
    } });
  });
}

async function reconcileCompletedTrialCardSetup(
  input: {
    contaId: string;
    billingAccountId: string;
    customerId: string;
    environment: ReturnType<typeof resolvePlatformBillingEnvironment>;
    stripe: Parameters<typeof listStripeCheckoutSessionsForCustomerSince>[0];
  },
  candidate: { requestKey: string; consentVersion: string; acceptedAt: string },
  sessionId: string,
): Promise<void> {
  await completeTrialCardSetupSession({
    sessionId,
    expected: { contaId: input.contaId, customerId: input.customerId,
      requestKey: candidate.requestKey, consentVersion: candidate.consentVersion, acceptedAt: candidate.acceptedAt },
    eventId: null,
    source: 'read_only_reconciliation',
    environment: input.environment,
    stripe: {
      retrieveSession: async (id) => retrieveStripeSetupCheckoutSession(input.stripe, id),
      retrieveSetupIntent: async (id) => retrieveStripeSetupIntent(input.stripe, id),
      allowPaymentMethodRedisplay: async (id) => allowStripePaymentMethodRedisplay(input.stripe, id),
    },
    loadConsent: async ({ contaId, environment, customerId, requestKey, sessionId: consentSessionId }) =>
      runWithTenant(contaId, async (tx) => {
        const account = await tx.platformBillingAccount.findFirst({
          where: { contaId, environment, stripeCustomerId: customerId }, select: { id: true },
        });
        if (!account || account.id !== input.billingAccountId) return null;
        const [consent, sessionAudit, claimAudit, completedAudit] = await Promise.all([
          tx.platformBillingAuditLog.findFirst({ where: { contaId, billingAccountId: account.id,
            action: 'PLATFORM_BILLING_TRIAL_CARD_CONSENT', correlationId: requestKey }, select: { metadata: true } }),
          tx.platformBillingAuditLog.findFirst({ where: { contaId, billingAccountId: account.id,
            action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', correlationId: requestKey, entityId: consentSessionId }, select: { id: true } }),
          tx.platformBillingAuditLog.findFirst({ where: { contaId, billingAccountId: account.id,
            action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_CLAIMED', correlationId: requestKey }, select: { id: true } }),
          tx.platformBillingAuditLog.findFirst({ where: { contaId, billingAccountId: account.id,
            action: TRIAL_CARD_SETUP_SUCCESS_ACTION, webhookEnvironment: environment, entityId: consentSessionId }, select: { id: true } }),
        ]);
        const metadata = readRecord(consent?.metadata);
        if (!consent || (!sessionAudit && !claimAudit) || metadata.status !== 'REQUESTED'
          || metadata.version !== candidate.consentVersion || metadata.acceptedAt !== candidate.acceptedAt) return null;
        return { accountId: account.id, stripeCustomerId: customerId,
          consentVersion: candidate.consentVersion, acceptedAt: candidate.acceptedAt,
          sessionId: consentSessionId, alreadyCompleted: Boolean(completedAudit) };
      }),
    record: async (data) => runWithTenant(data.contaId, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trial-card-terminal:${data.environment}:${data.contaId}:${data.sessionId}`}, 0))`;
      const existing = await tx.platformBillingAuditLog.findFirst({ where: { contaId: data.contaId,
        billingAccountId: data.accountId, action: TRIAL_CARD_SETUP_SUCCESS_ACTION,
        webhookEnvironment: data.environment, entityId: data.sessionId }, select: { id: true } });
      if (existing) return;
      const sessionAudit = await tx.platformBillingAuditLog.findFirst({ where: { contaId: data.contaId,
        billingAccountId: data.accountId, action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED',
        correlationId: data.requestKey, entityId: data.sessionId }, select: { id: true } });
      if (!sessionAudit) await tx.platformBillingAuditLog.create({ data: {
        contaId: data.contaId, billingAccountId: data.accountId,
        action: 'PLATFORM_BILLING_TRIAL_CARD_SETUP_SESSION_CREATED', entityType: 'StripeSetupCheckout',
        entityId: data.sessionId, correlationId: data.requestKey,
        metadata: { sessionId: data.sessionId, recoveredViaReadOnlyReconciliation: true },
      } });
      await tx.platformBillingAuditLog.create({ data: {
        contaId: data.contaId, billingAccountId: data.accountId,
        action: TRIAL_CARD_SETUP_SUCCESS_ACTION, webhookEnvironment: data.environment,
        webhookEventId: null, entityType: 'StripeSetupCheckout', entityId: data.sessionId,
        correlationId: data.requestKey,
        metadata: { setupIntentId: data.setupIntentId, paymentMethodId: data.paymentMethodId,
          allowRedisplay: 'always', consentVersion: data.consentVersion,
          consentAcceptedAt: data.acceptedAt, card: data.card, source: data.source },
      } });
    }),
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readStripeCustomerId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  const id = readRecord(value).id;
  return typeof id === 'string' ? id : null;
}
