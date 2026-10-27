import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingCheckoutSession,
  createPrismaPlatformBillingStore,
} from '@alusa/platform-billing';
import { z } from 'zod';
import { platformBillingIdempotencyKeyDTOSchema } from '@/features/platform-billing/dtos';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  resolvePlatformBillingEnvironment,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';
import { resolveTenantPlatformBillingCheckoutPlan } from '@/src/server/platform-billing/checkout-commercial-resolution';

const checkoutSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await readBody(req);

  if (!body.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  const rawIdempotencyKey = req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey;
  if (!rawIdempotencyKey) {
    return NextResponse.json(
      {
        error: 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED',
        message: 'A chave de idempotência é obrigatória.',
      },
      { status: 400 },
    );
  }
  const parsedIdempotencyKey = platformBillingIdempotencyKeyDTOSchema.safeParse(rawIdempotencyKey);
  if (!parsedIdempotencyKey.success) {
    return NextResponse.json({ error: 'PLATFORM_BILLING_INPUT_INVALID' }, { status: 400 });
  }
  const idempotencyKey = parsedIdempotencyKey.data;

  try {
    return await withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(
      `platform-billing:checkout:${contaId}:${userId}:${requestIp}`,
      20,
      10 * 60_000,
    );
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'RATE_LIMITED' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    const environment = resolvePlatformBillingEnvironment();
    const commercialPlan = await resolveTenantPlatformBillingCheckoutPlan({
      tx,
      contaId,
      environment,
    });
    if (commercialPlan.kind === 'SPECIALIST' && commercialPlan.reason === 'CONFIRMED_SPECIALIST') {
      return NextResponse.json({
        error: 'SPECIALIST_REQUIRED',
        message: 'A faixa especial foi confirmada em três fechamentos. Entre em contato com um especialista para contratar.',
      }, { status: 422 });
    }
    if (commercialPlan.kind === 'UNSTABLE') {
      return NextResponse.json({
        error: 'PLATFORM_BILLING_PLAN_CHANGE_NOT_STABLE',
        message: 'A condição atual ainda está sendo conciliada. Não é possível iniciar uma nova cobrança automática agora.',
      }, { status: 409 });
    }
    if (commercialPlan.kind === 'SPECIALIST') {
        return NextResponse.json({
          error: 'SPECIALIST_REQUIRED',
          message: 'Escolas com mais de 500 alunos precisam conversar com um especialista.',
          activeStudents: commercialPlan.studentCount,
        }, { status: 422 });
    }
    const { planCode, currentBand } = commercialPlan;

    const origin = new URL(req.url).origin;
    const cancelUrl = new URL('/conta/plano-faturamento?checkout=cancel', origin);
    cancelUrl.searchParams.set('checkoutRequestKey', idempotencyKey);
    if (!currentBand) cancelUrl.searchParams.set('studentCount', String(commercialPlan.studentCount));
    let result: Awaited<ReturnType<typeof createPlatformBillingCheckoutSession>>;
    try {
      result = await createPlatformBillingCheckoutSession(
        {
          contaId,
          contaName: actor.conta?.nome ?? 'Conta Alusa',
          billingEmail: actor.user?.email ?? undefined,
          planCode,
          successUrl: `${origin}/conta/plano-faturamento?checkout=success`,
          cancelUrl: cancelUrl.toString(),
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
        eventName: isStripeSdkError(error)
          ? 'api.platform_billing.checkout.stripe_failed'
          : 'api.platform_billing.checkout.failed',
        route: '/api/platform-billing/checkout',
        method: 'POST',
        requestId: getRequestId(req),
        error,
      });
      return NextResponse.json({
        error: isStripeSdkError(error)
          ? 'PLATFORM_BILLING_PROVIDER_ERROR'
          : 'PLATFORM_BILLING_UNEXPECTED_ERROR',
        message: 'Não foi possível iniciar a contratação. Tente novamente.',
      }, { status: isStripeSdkError(error) ? 503 : 500 });
    }

    logApiOperationalEvent({
      severity: 'info',
      eventName: 'api.platform_billing.checkout.created',
      route: '/api/platform-billing/checkout',
      method: 'POST',
      requestId: getRequestId(req),
    });

    return NextResponse.json({
      checkoutSessionId: result.checkoutSessionId,
      checkoutUrl: result.checkoutUrl,
      reused: result.reused,
    });
    });
  } catch (error) {
    const requestId = getRequestId(req);
    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.platform_billing.checkout.failed',
      route: '/api/platform-billing/checkout',
      method: 'POST',
      requestId,
      error,
    });
    return NextResponse.json({
      error: 'PLATFORM_BILLING_UNEXPECTED_ERROR',
      message: 'Não foi possível iniciar a contratação. Tente novamente.',
      requestId,
    }, { status: 500 });
  }
}

function billingActionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof PlatformBillingError) {
    const conflictCodes = new Set([
      'PLATFORM_BILLING_IDEMPOTENCY_CONFLICT',
      'PLATFORM_BILLING_SUBSCRIPTION_ALREADY_EXISTS',
      'PLATFORM_BILLING_CHECKOUT_IN_PROGRESS',
      'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED',
      'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED',
      'PLATFORM_BILLING_PLAN_CHANGE_NOT_STABLE',
      'PLATFORM_BILLING_PLAN_CHANGE_IN_PROGRESS',
      'PLATFORM_BILLING_RECONCILIATION_FAILED',
      'PLATFORM_BILLING_TRIAL_ALREADY_USED',
      'PLATFORM_BILLING_CUSTOMER_RECOVERY_UNSAFE',
    ]);
    const status = error.code === 'PLATFORM_PRICE_MISSING'
      ? 503
      : conflictCodes.has(error.code)
        ? 409
        : 400;
    return NextResponse.json(
      {
        error: error.code,
        message:
          error.code === 'PLATFORM_PRICE_MISSING'
            ? 'Este plano ainda não está disponível para contratação.'
            : error.code === 'PLATFORM_BILLING_CHECKOUT_EXPIRED_RETRY_REQUIRED'
              ? 'A sessão anterior expirou. Vamos atualizar a confirmação para abrir um novo pagamento.'
            : 'Não foi possível abrir o pagamento.',
      },
      { status },
    );
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json(
      { error: error.code, message: 'O pagamento está temporariamente indisponível.' },
      { status: 503 },
    );
  }

  return null;
}

function isStripeSdkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { type?: unknown; name?: unknown };
  return (typeof candidate.type === 'string' && candidate.type.startsWith('Stripe'))
    || (typeof candidate.name === 'string' && candidate.name.startsWith('Stripe'));
}

async function readBody(
  req: NextRequest,
): Promise<{ success: true; data: unknown } | { success: false }> {
  try {
    return { success: true, data: await req.json() };
  } catch {
    return { success: false };
  }
}
