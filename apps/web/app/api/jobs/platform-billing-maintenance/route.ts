import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { expirePlatformBillingGracePeriods } from '@/src/server/platform-billing/grace-period-jobs';
import { expirePlatformBillingTrials } from '@/src/server/platform-billing/trial-jobs';
import { reconcilePlatformBilling } from '@/src/server/platform-billing/reconciliation';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const scope = await resolveTenantScope(req, { allowCron: true });
  if (!scope.ok) return scope.response;

  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 100;

    const webhooks = await drainStripeWebhookWorker({ prisma, limit: safeLimit });
    const trials = await expirePlatformBillingTrials({ prisma, limit: safeLimit });
    const gracePeriods = await expirePlatformBillingGracePeriods({ prisma, limit: safeLimit });
    const reconciliation = await reconcilePlatformBilling({ prisma, limit: safeLimit });

    return NextResponse.json({
      success: true,
      webhooks,
      trials,
      gracePeriods,
      reconciliation,
    });
  } catch (error) {
    console.error('[platform-billing-maintenance] failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: { code: 'PLATFORM_BILLING_MAINTENANCE_FAILED', message: 'Falha na manutenção do faturamento.' } },
      { status: 500 },
    );
  }
}
