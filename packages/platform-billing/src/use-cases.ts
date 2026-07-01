import { parseStripeRuntimeConfig } from '@alusa/stripe';
import type { StripeEnvSource } from '@alusa/stripe';
import { z } from 'zod';
import { PlatformBillingError } from './errors';
import { parsePublicCheckoutPlanCode, resolveStripePriceId } from './price-mapping';
import { createDefaultPlatformBillingStripeGateway } from './stripe-gateway';
import type {
  PlatformBillingAccountRecord,
  PlatformBillingCheckoutSessionRecord,
  PlatformBillingStore,
  PlatformBillingStripeGateway,
} from './types';

const nonEmptyString = z.string().trim().min(1);
const urlSchema = z.string().trim().url();

const createCheckoutInputSchema = z.object({
  contaId: nonEmptyString,
  contaName: nonEmptyString,
  billingEmail: z.string().trim().email().optional(),
  planCode: z.unknown(),
  successUrl: urlSchema,
  cancelUrl: urlSchema,
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: nonEmptyString,
  correlationId: nonEmptyString.optional(),
});

const createPortalInputSchema = z.object({
  contaId: nonEmptyString,
  returnUrl: urlSchema,
  actorUserId: nonEmptyString.optional(),
  idempotencyKey: nonEmptyString.optional(),
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
  idempotencyKey?: string;
  correlationId?: string;
  envSource?: StripeEnvSource;
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
    idempotencyKey: `${parsed.idempotencyKey}:customer`,
  });

  const checkoutSession = await stripeGateway.createCheckoutSession({
    customerId: account.stripeCustomerId,
    priceId: stripePriceId,
    successUrl: parsed.successUrl,
    cancelUrl: parsed.cancelUrl,
    clientReferenceId: parsed.contaId,
    metadata: {
      contaId: parsed.contaId,
      planCode,
      billingContext: 'platform',
    },
    idempotencyKey: `${parsed.idempotencyKey}:checkout`,
  });

  await deps.store.markCheckoutPending({
    accountId: account.id,
    planCode,
    stripePriceId,
  });

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
    action: 'PLATFORM_BILLING_CHECKOUT_SESSION_CREATED',
    entityType: 'PlatformBillingCheckoutSession',
    entityId: record.id,
    correlationId: parsed.correlationId ?? parsed.idempotencyKey,
    metadata: {
      environment: config.environment,
      planCode,
      stripeCheckoutSessionId: checkoutSession.id,
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
    idempotencyKey: parsed.idempotencyKey,
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

function parseCheckoutInput(input: CreatePlatformBillingCheckoutSessionInput) {
  const parsed = createCheckoutInputSchema.safeParse(input);

  if (!parsed.success) {
    const missingIdempotency = parsed.error.issues.some((issue) => issue.path.includes('idempotencyKey'));
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
    throw new PlatformBillingError('Platform billing input is invalid.', 'PLATFORM_BILLING_INPUT_INVALID', {
      fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean),
    });
  }

  return parsed.data;
}
