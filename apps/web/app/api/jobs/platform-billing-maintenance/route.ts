import { recordJobRequestRejected, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
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
  // This endpoint drains global platform billing state across tenants. A
  // tenant ADMIN session must never authorize that operation.
  const configuredCronToken = process.env.CRON_SECRET_TOKEN ?? process.env.CRON_SECRET;
  const bearerToken = req.headers.get('authorization')?.startsWith('Bearer ')
    ? req.headers.get('authorization')?.slice('Bearer '.length)
    : null;
  const cronToken = req.headers.get('x-cron-token');
  if (!configuredCronToken || (cronToken !== configuredCronToken && bearerToken !== configuredCronToken)) {
    recordJobRequestRejected('platform-billing-maintenance', 401);
    return NextResponse.json({ error: { code: 'NAO_AUTORIZADO', message: 'Credencial de cron inválida.' } }, { status: 401 });
  }

  const startedAt = startJobRun('platform-billing-maintenance');
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 100;

    const webhooks = await drainStripeWebhookWorker({ limit: safeLimit });
    const planChanges = await applyDuePlatformPlanChanges({ prisma, limit: safeLimit });
    const trials = await expirePlatformBillingTrials({ limit: safeLimit });
    const gracePeriods = await expirePlatformBillingGracePeriods({ limit: safeLimit });
    const reconciliation = await reconcilePlatformBilling({ limit: safeLimit });

    const failed = webhooks.failed + webhooks.notifications.failed + planChanges.failed;
    logJobResult('platform-billing-maintenance', startedAt, {
      webhooksProcessed: webhooks.processed,
      webhooksFailed: webhooks.failed,
      webhooksExhausted: webhooks.exhausted,
      webhookNotificationsClaimed: webhooks.notifications.claimed,
      webhookNotificationsDelivered: webhooks.notifications.delivered,
      webhookNotificationsFailed: webhooks.notifications.failed,
      webhookNotificationsExhausted: webhooks.notifications.exhausted,
      planChangesChecked: planChanges.checked,
      planChangesSubmitted: planChanges.submitted,
      planChangesFailed: planChanges.failed,
      trialsChecked: trials.checked,
      trialsRestricted: trials.restricted,
      trialsNotified: trials.notified,
      gracePeriodsChecked: gracePeriods.checked,
      gracePeriodsRestricted: gracePeriods.restricted,
      gracePeriodsNotified: gracePeriods.notified,
      billingAccountsChecked: reconciliation.checkedAccounts,
      billingIssues: reconciliation.issues,
    }, {
      partialFailure: failed > 0,
      workStatus: webhooks.processed + webhooks.notifications.claimed + planChanges.checked +
        trials.checked + gracePeriods.checked + reconciliation.issues > 0 ? 'worked' : 'unknown',
    });

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
