import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingTrialWithoutPaymentMethod,
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

const trialSchema = z.object({
  planCode: z.enum(['STARTER', 'PREMIUM', 'PRO']),
  idempotencyKey: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await readBody(req);

  if (!body.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  const parsed = trialSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:trial:${contaId}:${userId}:${requestIp}`, 20, 10 * 60_000);
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

    const idempotencyKey =
      req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey || randomUUID();

    let result: Awaited<ReturnType<typeof createPlatformBillingTrialWithoutPaymentMethod>>;
    try {
      result = await createPlatformBillingTrialWithoutPaymentMethod(
        {
          contaId,
          contaName: actor.conta?.nome ?? 'Conta Alusa',
          billingEmail: actor.user?.email ?? undefined,
          planCode: parsed.data.planCode,
          actorUserId: userId,
          idempotencyKey,
          correlationId: idempotencyKey,
          envSource: process.env,
        },
        { store: createPrismaPlatformBillingStore(tx) },
      );
    } catch (error) {
      return trialActionErrorResponse(error);
    }

    console.info('[platform-billing][trial]', {
      event: 'trial_without_payment_method_created',
      contaId,
      userId,
      planCode: parsed.data.planCode,
      reused: result.reused,
      stripeSubscriptionId: result.stripeSubscriptionId,
    });

    return NextResponse.json({
      billingAccountId: result.billingAccountId,
      stripeSubscriptionId: result.stripeSubscriptionId,
      trialEndsAt: result.trialEndsAt?.toISOString() ?? null,
      reused: result.reused,
    });
  });
}

function trialActionErrorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformBillingError) {
    return NextResponse.json(
      {
        error: error.code,
        message: error.code === 'PLATFORM_PRICE_MISSING'
          ? 'Este plano ainda não está disponível para contratação.'
          : 'Não foi possível iniciar o teste.',
      },
      { status: error.code === 'PLATFORM_PRICE_MISSING' ? 503 : 400 },
    );
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json({ error: error.code, message: 'O teste está temporariamente indisponível.' }, { status: 503 });
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
