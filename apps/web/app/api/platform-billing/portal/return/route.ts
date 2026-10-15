import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { refreshPlatformBillingPaymentMethod } from '@/src/server/platform-billing/reconciliation';
import {
  assertCanManagePlatformBilling,
  resolvePlatformBillingActor,
  resolvePlatformBillingEnvironment,
} from '@/src/server/platform-billing/platform-billing-server';

/**
 * Stripe redirects here after a customer updates billing details. Refresh only
 * this authenticated tenant's payment-method snapshot, then return to the UI.
 */
export async function GET(request: NextRequest) {
  const destination = new URL(readSafeReturnPath(request.nextUrl.searchParams.get('returnPath')), request.url);
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    destination.pathname = '/login';
    destination.search = '';
    return NextResponse.redirect(destination);
  }

  const actor = await runWithTenant(auth.contaId, (tx) =>
    resolvePlatformBillingActor({ tx, contaId: auth.contaId, userId: auth.userId }),
  );
  const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
  if (forbidden) return forbidden;

  const rate = await rateLimitAsync(
    `platform-billing:portal-return:${auth.contaId}:${auth.userId}:${ipFromRequest(request)}`,
    30,
    10 * 60_000,
  );

  if (rate.ok) {
    try {
      await refreshPlatformBillingPaymentMethod({
        contaId: auth.contaId,
        environment: resolvePlatformBillingEnvironment(),
        force: true,
      });
    } catch {
      // Portal return must remain usable when Stripe is temporarily unavailable.
      // The next explicit portal return or scheduled reconciliation can retry.
    }
  }

  return NextResponse.redirect(destination);
}

function readSafeReturnPath(value: string | null): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/account/billing-plan';
  }
  return trimmed;
}
