import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingCheckoutSession,
  createPrismaPlatformBillingStore,
} from '@alusa/platform-billing';
import { z } from 'zod';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  assertPlanCapacity,
  countActivePlatformBillingStudents,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';

const checkoutSchema = z.object({
  planCode: z.enum(['STARTER', 'PREMIUM', 'PRO']),
  idempotencyKey: z.string().trim().min(1).optional(),
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

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:checkout:${contaId}:${userId}:${requestIp}`, 20, 10 * 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
      );
    }

    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    const activeStudents = await countActivePlatformBillingStudents({ tx, contaId });
    const capacityError = assertPlanCapacity({
      planCode: parsed.data.planCode,
      activeStudents,
    });
    if (capacityError) return capacityError;

    const origin = new URL(req.url).origin;
    const idempotencyKey =
      req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey || randomUUID();

    let result: Awaited<ReturnType<typeof createPlatformBillingCheckoutSession>>;
    try {
      result = await createPlatformBillingCheckoutSession(
        {
          contaId,
          contaName: actor.conta?.nome ?? 'Conta Alusa',
          billingEmail: actor.user?.email ?? undefined,
          planCode: parsed.data.planCode,
          successUrl: `${origin}/conta/plano-faturamento?checkout=success`,
          cancelUrl: `${origin}/conta/plano-faturamento?checkout=cancel`,
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

    console.info('[platform-billing][checkout]', {
      event: 'checkout_created',
      contaId,
      userId,
      planCode: parsed.data.planCode,
      reused: result.reused,
      checkoutSessionId: result.checkoutSessionId,
    });

    return NextResponse.json({
      checkoutSessionId: result.checkoutSessionId,
      checkoutUrl: result.checkoutUrl,
      reused: result.reused,
    });
  });
}

function billingActionErrorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformBillingError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.code === 'PLATFORM_PRICE_MISSING'
          ? 'Este plano ainda não está disponível para contratação.'
          : 'Não foi possível abrir o pagamento.',
      },
      { status: error.code === 'PLATFORM_PRICE_MISSING' ? 503 : 400 },
    );
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json({ error: error.code, message: 'O pagamento está temporariamente indisponível.' }, { status: 503 });
  }

  throw error;
}

async function readBody(req: NextRequest): Promise<{ success: true; data: unknown } | { success: false }> {
  try {
    return { success: true, data: await req.json() };
  } catch {
    return { success: false };
  }
}
