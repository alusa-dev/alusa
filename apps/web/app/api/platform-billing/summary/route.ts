import { NextResponse } from 'next/server';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { privateJson } from '@/lib/private-cache';
import { resolvePlatformBillingEnvironment } from '@/src/server/platform-billing/platform-billing-server';
import { refreshPlatformBillingPaymentMethod } from '@/src/server/platform-billing/reconciliation';
import { getPlatformBillingSummary } from '@/src/server/platform-billing/platform-billing-summary.service';

export async function GET() {
  try {
    const environment = resolvePlatformBillingEnvironment();

    return withTenantSession(async ({ contaId, userId, tx }) => {
      await refreshPlatformBillingPaymentMethod({ contaId, environment });
      const result = await getPlatformBillingSummary({ tx, contaId, userId, environment });
      if (!result.ok) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

      return privateJson(
        result.summary,
        {
          maxAgeSeconds: 30,
          staleWhileRevalidateSeconds: 120,
          cacheState: 'MISS',
        },
      );
    });
  } catch {
    return NextResponse.json(
      {
        error: 'PLATFORM_BILLING_SUMMARY_FAILED',
        message: 'Falha ao carregar faturamento.',
      },
      { status: 500 },
    );
  }
}
