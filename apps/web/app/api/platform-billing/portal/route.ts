import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingPortalSession,
  createPrismaPlatformBillingStore,
} from '@alusa/platform-billing';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);

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

    const origin = new URL(req.url).origin;
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || randomUUID();
    let result: Awaited<ReturnType<typeof createPlatformBillingPortalSession>>;
    try {
      result = await createPlatformBillingPortalSession(
        {
          contaId,
          returnUrl: `${origin}/conta/plano-faturamento`,
          actorUserId: userId,
          idempotencyKey,
          correlationId: idempotencyKey,
          envSource: process.env,
        },
        { store: createPrismaPlatformBillingStore(tx) },
      );
    } catch (error) {
      return billingActionErrorResponse(error);
    }

    return NextResponse.json({
      portalSessionId: result.portalSessionId,
      portalUrl: result.portalUrl,
    });
  });
}

function billingActionErrorResponse(error: unknown): NextResponse {
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

  throw error;
}
