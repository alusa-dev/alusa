import { NextResponse } from 'next/server';
import {
  PLATFORM_BILLING_CAPABILITIES,
  canUsePlatformCapability,
  derivePlatformBillingCommunication,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
  type PlatformBillingCapability,
} from '@alusa/platform-billing';

import { withTenantSession } from '@/lib/api/with-tenant-session';
import {
  assertPlatformAccessForCapability,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';

const capabilities = new Set<PlatformBillingCapability>(PLATFORM_BILLING_CAPABILITIES);

export async function GET(request: Request) {
  const capability = new URL(request.url).searchParams.get('capability') as PlatformBillingCapability | null;
  if (capability && !capabilities.has(capability)) {
    return NextResponse.json(
      { error: 'PLATFORM_BILLING_CAPABILITY_INVALID' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  return withTenantSession(async ({ contaId, tx }) => {
    if (!capability) {
      const account = await tx.platformBillingAccount.findUnique({
        where: {
          uq_platform_billing_account_conta_env: {
            contaId,
            environment: resolvePlatformBillingEnvironment(),
          },
        },
      });
      const now = new Date();
      const accessStatus = derivePlatformAccessStatus({ account, now });
      const restrictionReason = account ? derivePlatformRestrictionReason({ account, now }) : null;
      const communication = derivePlatformBillingCommunication({ account, now });

      return NextResponse.json({
        accountId: account?.id ?? null,
        billingStatus: account?.status ?? 'NOT_STARTED',
        accessStatus,
        planCode: account?.planCode ?? null,
        restrictionReason,
        trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
        gracePeriodEndsAt: account?.gracePeriodEndsAt?.toISOString() ?? null,
        hasPaymentMethod: account?.paymentMethodStatus === 'PRESENT',
        communication,
        capabilities: Object.fromEntries(
          PLATFORM_BILLING_CAPABILITIES.map((item) => [
            item,
            canUsePlatformCapability({ accessStatus, capability: item }),
          ]),
        ),
        generatedAt: now.toISOString(),
      }, { headers: { 'cache-control': 'no-store' } });
    }

    try {
      await assertPlatformAccessForCapability({ tx, contaId, capability });
      return NextResponse.json({ allowed: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      return NextResponse.json(
        { error: 'PLATFORM_BILLING_ACCESS_CHECK_FAILED' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
  });
}
