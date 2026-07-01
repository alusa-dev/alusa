import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { expirePlatformBillingGracePeriods } from '@/src/server/platform-billing/grace-period-jobs';
import { applyDuePlatformPlanChanges } from '@/src/server/platform-billing/plan-change-actions';
import { reconcilePlatformBilling } from '@/src/server/platform-billing/reconciliation';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

export const runtime = 'nodejs';

const maintenanceSchema = z.object({
  webhookLimit: z.number().int().min(1).max(100).optional(),
  planChangeLimit: z.number().int().min(1).max(100).optional(),
  graceLimit: z.number().int().min(1).max(100).optional(),
  reconciliationLimit: z.number().int().min(1).max(100).optional(),
  reconcile: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const authorized = await isAuthorizedWorkerRequest(req);
  if (!authorized) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = maintenanceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() }, { status: 400 });
  }

  const webhooks = await drainStripeWebhookWorker({
    prisma,
    limit: parsed.data.webhookLimit,
  });
  const planChanges = await applyDuePlatformPlanChanges({
    prisma,
    limit: parsed.data.planChangeLimit,
  });
  const gracePeriods = await expirePlatformBillingGracePeriods({
    prisma,
    limit: parsed.data.graceLimit,
  });
  const reconciliation = parsed.data.reconcile === false
    ? null
    : await reconcilePlatformBilling({
      prisma,
      limit: parsed.data.reconciliationLimit,
    });

  return NextResponse.json({
    webhooks,
    planChanges,
    gracePeriods,
    reconciliation,
  });
}

async function isAuthorizedWorkerRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.PLATFORM_BILLING_WORKER_SECRET?.trim();
  if (secret) return req.headers.get('x-platform-billing-worker-secret') === secret;

  const session = await getServerSession(authOptions);
  const role = (session as { user?: { role?: string } } | null)?.user?.role;
  return String(role ?? '').toUpperCase() === 'ADMIN';
}
