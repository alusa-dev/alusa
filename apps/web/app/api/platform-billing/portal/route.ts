import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingPortalSession,
  createPrismaPlatformBillingStore,
} from '@alusa/platform-billing';
import { resolveTenantSession, withTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  resolvePlatformBillingEnvironment,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';
import {
  platformBillingIdempotencyKeyDTOSchema,
  platformBillingPortalInputDTOSchema,
} from '@/features/platform-billing/dtos';
import { startTrialCardSetupCheckout } from '@/src/server/platform-billing/trial-card-setup-checkout';

async function readBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await readBody(req);
  const parsedBody = platformBillingPortalInputDTOSchema.safeParse(body);
  const returnPath = readSafeReturnPath(parsedBody.success ? parsedBody.data : null);
  const rawIdempotencyKey = req.headers.get('idempotency-key')?.trim();
  if (!rawIdempotencyKey) {
    return NextResponse.json(
      { error: 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED', message: 'A chave de idempotência é obrigatória.' },
      { status: 400 },
    );
  }
  const parsedIdempotencyKey = platformBillingIdempotencyKeyDTOSchema.safeParse(rawIdempotencyKey);
  if (!parsedIdempotencyKey.success) {
    return NextResponse.json(
      { error: 'PLATFORM_BILLING_INPUT_INVALID', message: 'A chave de idempotência deve ter até 128 caracteres.' },
      { status: 400 },
    );
  }
  const idempotencyKey = parsedIdempotencyKey.data;

  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_MISMATCH' : 'UNAUTHENTICATED' }, {
      status: auth.reason === 'CONTA_MISMATCH' ? 403 : 401,
    });
  }
  const setupCandidate = await runWithTenant(auth.contaId, async (tx) => {
    const actor = await resolvePlatformBillingActor({ tx, contaId: auth.contaId, userId: auth.userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;
    const account = await tx.platformBillingAccount.findUnique({
      where: { uq_platform_billing_account_conta_env: { contaId: auth.contaId, environment: resolvePlatformBillingEnvironment() } },
      select: {
        id: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true,
        trialEndsAt: true, firstPaidAt: true, lastSuccessfulPaymentAt: true,
      },
    });
    const unpaidTrial = Boolean(account?.trialEndsAt && !account.firstPaidAt && !account.lastSuccessfulPaymentAt
      && account.status !== 'ACTIVE' && account.status !== 'PAST_DUE');
    if (unpaidTrial && account?.trialEndsAt && account.trialEndsAt.getTime() <= Date.now()) {
      return NextResponse.json({
        error: 'PLATFORM_BILLING_CHECKOUT_REQUIRED',
        message: 'Seu período de teste terminou. Para contratar, confirme o pagamento pelo Checkout.',
      }, { status: 409 });
    }
    if (!unpaidTrial || !account?.trialEndsAt || account.trialEndsAt.getTime() <= Date.now()) return null;
    const rate = await rateLimitAsync(`platform-billing:portal:${auth.contaId}:${auth.userId}:${requestIp}`, 30, 10 * 60_000);
    if (!rate.ok) return NextResponse.json({ error: 'RATE_LIMITED' }, {
      status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
    });
    return {
      contaId: auth.contaId, userId: auth.userId, billingAccountId: account.id,
      customerId: account.stripeCustomerId, subscriptionId: account.stripeSubscriptionId,
    };
  });
  if (setupCandidate instanceof NextResponse) return setupCandidate;
  if (setupCandidate) {
    const outcome = await startTrialCardSetupCheckout({
      setupCandidate,
      consentAccepted: parsedBody.success && parsedBody.data.savePaymentMethodConsent === true,
      idempotencyKey,
      requestId: getRequestId(req),
      origin: new URL(req.url).origin,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
  }

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:portal:${contaId}:${userId}:${requestIp}`, 30, 10 * 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    const account = await tx.platformBillingAccount.findUnique({
      where: {
        uq_platform_billing_account_conta_env: {
          contaId,
          environment: resolvePlatformBillingEnvironment(),
        },
      },
      select: {
        id: true,
        status: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        trialEndsAt: true,
        firstPaidAt: true,
        lastSuccessfulPaymentAt: true,
      },
    });
    const hasExpiredUnpaidTrial = Boolean(
      account?.trialEndsAt
      && account.trialEndsAt.getTime() <= Date.now()
      && !account.firstPaidAt
      && !account.lastSuccessfulPaymentAt
      && account.status !== 'ACTIVE'
      && account.status !== 'PAST_DUE',
    );
    if (hasExpiredUnpaidTrial) {
      return NextResponse.json({
        error: 'PLATFORM_BILLING_CHECKOUT_REQUIRED',
        message: 'Seu período de teste terminou. Para contratar, confirme o pagamento pelo Checkout.',
      }, { status: 409 });
    }
    const trialWithoutPaidHistory = Boolean(
      account?.trialEndsAt
      && account.trialEndsAt.getTime() > Date.now()
      && !account.firstPaidAt
      && !account.lastSuccessfulPaymentAt
      && account.status !== 'ACTIVE'
      && account.status !== 'PAST_DUE',
    );
    if (trialWithoutPaidHistory) {
      return NextResponse.json({ error: 'PLATFORM_BILLING_TRIAL_CARD_RETRY_REQUIRED' }, { status: 409 });
    }

    const origin = new URL(req.url).origin;
    let result: Awaited<ReturnType<typeof createPlatformBillingPortalSession>>;
    try {
      result = await createPlatformBillingPortalSession(
        {
          contaId,
          returnUrl: `${origin}/api/platform-billing/portal/return?returnPath=${encodeURIComponent(returnPath)}`,
          actorUserId: userId,
          idempotencyKey,
          correlationId: idempotencyKey,
          envSource: process.env,
        },
        { store: createPrismaPlatformBillingStore(tx) },
      );
    } catch (error) {
      const knownResponse = billingActionErrorResponse(error);
      if (knownResponse) return knownResponse;

      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.platform_billing.portal.failed',
        route: '/api/platform-billing/portal',
        method: 'POST',
        requestId: getRequestId(req),
        error,
      });
      return NextResponse.json({
        error: 'PLATFORM_BILLING_UNEXPECTED_ERROR',
        message: 'Não foi possível abrir a área de pagamento. Tente novamente.',
      }, { status: 500 });
    }

    return NextResponse.json({
      portalSessionId: result.portalSessionId,
      portalUrl: result.portalUrl,
    });
  });
}

function readSafeReturnPath(body: unknown): string {
  if (!body || typeof body !== 'object') return '/account/billing-plan';
  const value = (body as { returnPath?: unknown }).returnPath;
  if (typeof value !== 'string') return '/account/billing-plan';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/account/billing-plan';
  }
  return trimmed;
}

function billingActionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof PlatformBillingError) {
    const status = error.code === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND' ? 404
      : error.code === 'PLATFORM_BILLING_TRIAL_CHECKOUT_REQUIRED' ? 409 : 400;
    return NextResponse.json({
      error: error.code,
      message: error.code === 'PLATFORM_BILLING_TRIAL_CHECKOUT_REQUIRED'
        ? 'A forma de pagamento não pode ser cadastrada durante o teste. Confirme a contratação pelo Checkout após o período de teste.'
        : error.code === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND'
        ? 'Nenhuma assinatura encontrada para esta conta.'
        : 'Não foi possível abrir a área de pagamento.',
    }, { status });
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json({ error: error.code, message: 'A área de pagamento está temporariamente indisponível.' }, { status: 503 });
  }

  return null;
}
