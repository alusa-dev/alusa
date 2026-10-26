import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingPortalSession,
  createPrismaPlatformBillingStore,
} from '@alusa/platform-billing';
import { withTenantSession } from '@/lib/api/with-tenant-session';
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
        status: true,
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

async function readBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
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
    const status = error.code === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND' ? 404 : 400;
    return NextResponse.json({
      error: error.code,
      message: error.code === 'PLATFORM_BILLING_ACCOUNT_NOT_FOUND'
        ? 'Nenhuma assinatura encontrada para esta conta.'
        : 'Não foi possível abrir a área de pagamento.',
    }, { status });
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json({ error: error.code, message: 'A área de pagamento está temporariamente indisponível.' }, { status: 503 });
  }

  return null;
}
