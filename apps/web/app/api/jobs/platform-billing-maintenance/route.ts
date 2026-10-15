import { logJobFailure } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expirePlatformBillingGracePeriods } from '@/src/server/platform-billing/grace-period-jobs';
import { expirePlatformBillingTrials } from '@/src/server/platform-billing/trial-jobs';
import { reconcilePlatformBilling } from '@/src/server/platform-billing/reconciliation';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';
import { applyDuePlatformPlanChanges } from '@/src/server/platform-billing/plan-change-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  const startedAt = Date.now();
  // This endpoint drains global platform billing state across tenants. A
  // tenant ADMIN session must never authorize that operation.
  const configuredCronToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  const bearerToken = req.headers.get('authorization')?.startsWith('Bearer ')
    ? req.headers.get('authorization')?.slice('Bearer '.length)
    : null;
  const cronToken = req.headers.get('x-cron-token');
  if (!configuredCronToken || (cronToken !== configuredCronToken && bearerToken !== configuredCronToken)) {
    return NextResponse.json({ error: { code: 'NAO_AUTORIZADO', message: 'Credencial de cron inválida.' } }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 100;

    const webhooks = await drainStripeWebhookWorker({ limit: safeLimit });
    const planChanges = await applyDuePlatformPlanChanges({ prisma, limit: safeLimit });
    const trials = await expirePlatformBillingTrials({ limit: safeLimit });
    const gracePeriods = await expirePlatformBillingGracePeriods({ limit: safeLimit });
    const reconciliation = await reconcilePlatformBilling({ limit: safeLimit });

    return NextResponse.json({
      success: true,
      webhooks,
      planChanges,
      trials,
      gracePeriods,
      reconciliation,
    });
  } catch (error) {
    logJobFailure('platform-billing-maintenance', startedAt, error);
    return NextResponse.json(
      {
        error: {
          code: 'PLATFORM_BILLING_MAINTENANCE_FAILED',
          message: 'Falha na manutenção do faturamento.',
        },
      },
      { status: 500 },
    );
  }
}
