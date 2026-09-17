import { prisma } from '@/lib/prisma';
import {
  applyDuePlatformPlanChanges,
  requestPlatformPlanChange,
  requestPlatformSubscriptionCancellation,
  undoPlatformSubscriptionCancellation,
} from './plan-change-actions';
import { expirePlatformBillingGracePeriods } from './grace-period-jobs';
import { reconcilePlatformBilling } from './reconciliation';
import { drainStripeWebhookWorker } from './webhook-worker';

type PlanChangeInput = Omit<Parameters<typeof requestPlatformPlanChange>[0], 'prisma'>;
type CancellationInput = Omit<Parameters<typeof requestPlatformSubscriptionCancellation>[0], 'prisma'>;
type UndoCancellationInput = Omit<Parameters<typeof undoPlatformSubscriptionCancellation>[0], 'prisma'>;

/**
 * HTTP-facing adapters keep the Prisma dependency inside the application
 * service boundary. Route handlers only coordinate auth, DTOs and responses.
 */
export function requestPlatformPlanChangeFromHttp(input: PlanChangeInput) {
  return requestPlatformPlanChange({ prisma, ...input });
}

export function requestPlatformSubscriptionCancellationFromHttp(input: CancellationInput) {
  return requestPlatformSubscriptionCancellation({ prisma, ...input });
}

export function undoPlatformSubscriptionCancellationFromHttp(input: UndoCancellationInput) {
  return undoPlatformSubscriptionCancellation({ prisma, ...input });
}

export function applyDuePlatformPlanChangesFromHttp(input: Omit<Parameters<typeof applyDuePlatformPlanChanges>[0], 'prisma'>) {
  return applyDuePlatformPlanChanges({ prisma, ...input });
}

export async function runPlatformBillingMaintenanceFromHttp(input: {
  webhookLimit?: number;
  planChangeLimit?: number;
  graceLimit?: number;
  reconciliationLimit?: number;
  reconcile?: boolean;
}) {
  const webhooks = await drainStripeWebhookWorker({
    prisma,
    limit: input.webhookLimit,
  });
  const planChanges = await applyDuePlatformPlanChanges({
    prisma,
    limit: input.planChangeLimit,
  });
  const gracePeriods = await expirePlatformBillingGracePeriods({
    prisma,
    limit: input.graceLimit,
  });
  const reconciliation = input.reconcile === false
    ? null
    : await reconcilePlatformBilling({
      prisma,
      limit: input.reconciliationLimit,
    });

  return { webhooks, planChanges, gracePeriods, reconciliation };
}
