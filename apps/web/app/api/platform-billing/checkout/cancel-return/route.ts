import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cancelPlatformBillingCheckoutReturn, createDefaultPlatformBillingStripeGateway, createPrismaPlatformBillingStore } from '@alusa/platform-billing';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { assertCanManagePlatformBilling, resolvePlatformBillingActor, resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

const cancelReturnSchema = z.object({ idempotencyKey: z.string().trim().min(1).max(128) });

export async function POST(request: NextRequest) {
  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(`platform-billing:checkout-cancel-return:${contaId}:${userId}:${ipFromRequest(request)}`, 20, 10 * 60_000);
    if (!rate.ok) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;
    const body = await request.json().catch(() => null);
    const parsed = cancelReturnSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'PLATFORM_BILLING_INPUT_INVALID', state: 'PENDING' }, { status: 400 });
    try {
      const state = await cancelPlatformBillingCheckoutReturn({ contaId, environment: resolvePlatformBillingEnvironment(), actorUserId: userId, idempotencyKey: parsed.data.idempotencyKey }, {
        store: createPrismaPlatformBillingStore(tx), stripeGateway: createDefaultPlatformBillingStripeGateway(process.env),
      });
      return NextResponse.json({ state });
    } catch {
      return NextResponse.json({ error: 'PLATFORM_BILLING_CHECKOUT_RECONCILIATION_REQUIRED', state: 'PENDING' }, { status: 503 });
    }
  });
}
