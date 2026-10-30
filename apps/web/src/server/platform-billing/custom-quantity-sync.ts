import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  getStripeClient,
  retrieveStripeSubscriptionQuantityState,
  updateStripeSubscriptionItemQuantity,
} from '@alusa/stripe';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { runWithTenant } from '@/lib/prisma-tenant';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';

const STALE_CLAIM_MS = 5 * 60_000;
const UNRESOLVED_STATUSES = ['PENDING', 'PROCESSING', 'UNKNOWN', 'BLOCKED'];

type SyncStatus = 'PENDING' | 'PROCESSING' | 'UNKNOWN' | 'SUCCEEDED' | 'BLOCKED' | 'SUPERSEDED';
type SnapshotSyncRow = {
  id: string;
  contaId: string;
  environment: PlatformBillingEnvironment;
  periodStart: Date;
  studentCount: number;
  customQuantitySyncStatus: SyncStatus | null;
  customQuantitySyncRequestedQuantity: number | null;
  customQuantitySyncOperationKey: string | null;
  customQuantitySyncStripeSubscriptionId: string | null;
  customQuantitySyncStripeSubscriptionItemId: string | null;
  customQuantitySyncPriceId: string | null;
  customQuantitySyncAttemptCount: number;
  customQuantitySyncLastAttemptAt: Date | null;
};

type SyncResult = { status: SyncStatus | 'NOT_APPLICABLE' | 'BUSY'; changed: boolean };
type RetrieveQuantitySubscription = (subscriptionId: string) => ReturnType<typeof retrieveStripeSubscriptionQuantityState>;
type UpdateQuantitySubscriptionItem = (input: Parameters<typeof updateStripeSubscriptionItemQuantity>[1]) => ReturnType<typeof updateStripeSubscriptionItemQuantity>;

type AccountForSync = {
  id: string;
  planCode: string | null;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
};
type InvitationForSync = {
  id: string;
  conditionType: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
};

/**
 * Enqueues the current closed month, then retries durable pending work in
 * period order. An unresolved earlier period gates later quantities so an old
 * ambiguous request can never complete after a newer request.
 */
export async function syncCustomSubscriptionQuantityForMonthlyClose(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  periodStart: Date;
  now?: Date;
  runTenant?: typeof runWithTenant;
  retrieve?: RetrieveQuantitySubscription;
  update?: UpdateQuantitySubscriptionItem;
}): Promise<SyncResult[]> {
  const runTenant = input.runTenant ?? runWithTenant;
  const now = input.now ?? new Date();
  const period = periodKey(input.periodStart);
  await runTenant(input.contaId, async (tx) => {
    const snapshot = await tx.platformBillingMonthlySnapshot.findUnique({
      where: { uq_platform_billing_monthly_snapshot_conta_env_period: { contaId: input.contaId, environment: input.environment, periodStart: input.periodStart } },
    }) as SnapshotSyncRow | null;
    if (!snapshot) return null;
    const [latest, account, invitation] = await Promise.all([
      tx.platformBillingMonthlySnapshot.findFirst({
        where: { contaId: input.contaId, environment: input.environment },
        orderBy: { periodStart: 'desc' }, select: { periodStart: true },
      }),
      tx.platformBillingAccount.findUnique({
        where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment: input.environment } },
        select: { id: true, planCode: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true, stripePriceId: true },
      }) as Promise<AccountForSync | null>,
      tx.platformSchoolInvitation.findFirst({
        where: { acceptedContaId: input.contaId, status: 'ACCEPTED' },
        select: { id: true, conditionType: true, stripeProductId: true, stripePriceId: true },
      }) as Promise<InvitationForSync | null>,
    ]);
    if (!latest || periodKey(latest.periodStart) !== period) return { snapshot, active: false as const };
    if (!account || !invitation || invitation.conditionType !== 'CUSTOM' || !invitation.stripeProductId || !invitation.stripePriceId) {
      return { snapshot, active: false as const };
    }
    if (!account.stripeSubscriptionId || !account.stripeCustomerId || !['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(account.status)) {
      return { snapshot, active: false as const };
    }
    const operationKey = buildOperationKey(input.environment, input.contaId, period);
    const requestedQuantity = Math.max(1, snapshot.studentCount);
    if (snapshot.customQuantitySyncStatus === null) {
      const invalidBinding = account.planCode !== 'CUSTOM' || account.stripePriceId !== invitation.stripePriceId;
      const queued = await tx.platformBillingMonthlySnapshot.updateMany({
        where: { id: snapshot.id, contaId: input.contaId, environment: input.environment, customQuantitySyncStatus: null },
        data: {
          customQuantitySyncStatus: invalidBinding ? 'BLOCKED' : 'PENDING',
          customQuantitySyncRequestedQuantity: requestedQuantity,
          customQuantitySyncOperationKey: operationKey,
          customQuantitySyncStripeSubscriptionId: account.stripeSubscriptionId,
          customQuantitySyncPriceId: invitation.stripePriceId,
          customQuantitySyncLastAttemptAt: invalidBinding ? now : null,
          customQuantitySyncLastErrorCode: invalidBinding ? 'LOCAL_PRICE_BINDING_MISMATCH' : null,
        },
      });
      if (queued.count === 1) await createSyncAudit(tx, {
        contaId: input.contaId, billingAccountId: account.id, action: invalidBinding ? 'CUSTOM_QUANTITY_SYNC_BLOCKED' : 'CUSTOM_QUANTITY_SYNC_QUEUED',
        operationKey, period, metadata: { requestedQuantity, priceId: invitation.stripePriceId, reason: invalidBinding ? 'LOCAL_PRICE_BINDING_MISMATCH' : null },
      });
      if (queued.count === 1 && invalidBinding) await upsertSyncIssue(tx, {
        contaId: input.contaId, billingAccountId: account.id, environment: input.environment,
        period, operationKey, reason: 'LOCAL_PRICE_BINDING_MISMATCH',
      });
    }
    return { snapshot, active: true as const };
  });
  const pendingRows = await runTenant(input.contaId, async (tx) => tx.platformBillingMonthlySnapshot.findMany({
    where: {
      contaId: input.contaId,
      environment: input.environment,
      customQuantitySyncStatus: { in: UNRESOLVED_STATUSES },
    },
    orderBy: { periodStart: 'asc' },
  }) as Promise<SnapshotSyncRow[]>);
  const latest = await runTenant(input.contaId, async (tx) => tx.platformBillingMonthlySnapshot.findFirst({
    where: { contaId: input.contaId, environment: input.environment }, orderBy: { periodStart: 'desc' }, select: { periodStart: true },
  }));
  if (!latest) return [{ status: 'NOT_APPLICABLE', changed: false }];

  // A period which has never reached Stripe is safe to supersede. PROCESSING
  // and UNKNOWN operations are retained and resolved with their original key.
  for (const row of pendingRows) {
    if (periodKey(row.periodStart) >= periodKey(latest.periodStart)) continue;
    if (row.customQuantitySyncStatus !== 'PENDING') continue;
    await setTerminalStatus(input.contaId, row, 'SUPERSEDED', 'NEWER_MONTHLY_CLOSE_EXISTS', now, runTenant);
  }

  const remaining = await runTenant(input.contaId, async (tx) => tx.platformBillingMonthlySnapshot.findMany({
    where: {
      contaId: input.contaId,
      environment: input.environment,
      customQuantitySyncStatus: { in: UNRESOLVED_STATUSES },
    },
    orderBy: { periodStart: 'asc' },
  }) as Promise<SnapshotSyncRow[]>);
  const results: SyncResult[] = [];
  for (const row of remaining) {
    if (row.customQuantitySyncStatus === 'BLOCKED') {
      const retryAfter = row.customQuantitySyncLastAttemptAt
        ? new Date(row.customQuantitySyncLastAttemptAt.getTime() + 60 * 60_000)
        : new Date(0);
      if (retryAfter > now) {
        results.push({ status: 'BLOCKED', changed: false });
        break;
      }
    }
    const currentLatest = await runTenant(input.contaId, async (tx) => tx.platformBillingMonthlySnapshot.findFirst({
      where: { contaId: input.contaId, environment: input.environment },
      orderBy: { periodStart: 'desc' }, select: { periodStart: true },
    }));
    const rowIsLatest = currentLatest && periodKey(currentLatest.periodStart) === periodKey(row.periodStart);
    if (row.customQuantitySyncStatus === 'PENDING' && !rowIsLatest) {
      await setTerminalStatus(input.contaId, row, 'SUPERSEDED', 'NEWER_MONTHLY_CLOSE_EXISTS', now, runTenant);
      continue;
    }
    const processResult = await processOperation({ ...input, now, runTenant, row });
    results.push(processResult);
    if (processResult.status !== 'SUCCEEDED' && processResult.status !== 'SUPERSEDED') break;
  }
  return results.length ? results : [{ status: 'NOT_APPLICABLE', changed: false }];
}

async function processOperation(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  now: Date;
  runTenant: typeof runWithTenant;
  row: SnapshotSyncRow;
  retrieve?: RetrieveQuantitySubscription;
  update?: UpdateQuantitySubscriptionItem;
}): Promise<SyncResult> {
  const { row } = input;
  const claim = await input.runTenant(input.contaId, async (tx) => {
    const staleBefore = new Date(input.now.getTime() - STALE_CLAIM_MS);
    const allowedPrevious = row.customQuantitySyncStatus === 'PROCESSING'
      ? { customQuantitySyncStatus: 'PROCESSING', customQuantitySyncLastAttemptAt: { lt: staleBefore } }
      : row.customQuantitySyncStatus === 'BLOCKED'
        ? { customQuantitySyncStatus: 'BLOCKED', OR: [{ customQuantitySyncLastAttemptAt: null }, { customQuantitySyncLastAttemptAt: { lt: new Date(input.now.getTime() - 60 * 60_000) } }] }
        : { customQuantitySyncStatus: { in: ['PENDING', 'UNKNOWN'] } };
    const updated = await tx.platformBillingMonthlySnapshot.updateMany({
      where: { id: row.id, contaId: input.contaId, environment: input.environment, ...allowedPrevious },
      data: {
        customQuantitySyncStatus: 'PROCESSING',
        customQuantitySyncAttemptCount: { increment: 1 },
        customQuantitySyncLastAttemptAt: input.now,
        customQuantitySyncLastErrorCode: null,
      },
    });
    if (updated.count !== 1) return false;
    const account = await tx.platformBillingAccount.findUnique({
      where: { uq_platform_billing_account_conta_env: { contaId: input.contaId, environment: input.environment } },
      select: { id: true, planCode: true, status: true, stripeCustomerId: true, stripeSubscriptionId: true, stripePriceId: true },
    }) as AccountForSync | null;
    const invitation = await tx.platformSchoolInvitation.findFirst({
      where: { acceptedContaId: input.contaId, status: 'ACCEPTED' },
      select: { id: true, conditionType: true, stripeProductId: true, stripePriceId: true },
    }) as InvitationForSync | null;
    const valid = account && invitation && invitation.conditionType === 'CUSTOM' && invitation.stripeProductId &&
      account.planCode === 'CUSTOM' && account.status !== 'CANCELED' && account.status !== 'INCOMPLETE_EXPIRED' &&
      account.stripeSubscriptionId === row.customQuantitySyncStripeSubscriptionId &&
      account.stripePriceId === row.customQuantitySyncPriceId && invitation.stripePriceId === row.customQuantitySyncPriceId;
    if (!valid) {
      await tx.platformBillingMonthlySnapshot.updateMany({
        where: { id: row.id, contaId: input.contaId, environment: input.environment, customQuantitySyncStatus: 'PROCESSING' },
        data: { customQuantitySyncStatus: 'BLOCKED', customQuantitySyncLastErrorCode: 'LOCAL_SUBSCRIPTION_BINDING_MISMATCH' },
      });
      await createSyncAudit(tx, {
        contaId: input.contaId, billingAccountId: account?.id ?? null, action: 'CUSTOM_QUANTITY_SYNC_BLOCKED',
        operationKey: row.customQuantitySyncOperationKey!, period: periodKey(row.periodStart),
        metadata: { reason: 'LOCAL_SUBSCRIPTION_BINDING_MISMATCH' },
      });
      await upsertSyncIssue(tx, {
        contaId: input.contaId, billingAccountId: account?.id ?? null, environment: input.environment,
        period: periodKey(row.periodStart), operationKey: row.customQuantitySyncOperationKey!, reason: 'LOCAL_SUBSCRIPTION_BINDING_MISMATCH',
      });
      return 'blocked' as const;
    }
    return { account, invitation };
  });
  if (claim === false) return { status: 'BUSY', changed: false };
  if (claim === 'blocked') return { status: 'BLOCKED', changed: true };

  const retrieve = input.retrieve ?? ((subscriptionId: string) => retrieveStripeSubscriptionQuantityState(getStripeClient(process.env), subscriptionId));
  const update = input.update ?? ((args: Parameters<typeof updateStripeSubscriptionItemQuantity>[1]) => updateStripeSubscriptionItemQuantity(getStripeClient(process.env), args));
  const operationKey = row.customQuantitySyncOperationKey!;
  const period = periodKey(row.periodStart);
  try {
    const subscription = await retrieve(row.customQuantitySyncStripeSubscriptionId!);
    const isLive = input.environment === 'LIVE';
    const expectedQty = row.customQuantitySyncRequestedQuantity!;
    const singleItem = subscription.items.length === 1 ? subscription.items[0] : null;
    const bindingMatches = subscription.id === row.customQuantitySyncStripeSubscriptionId &&
      subscription.customerId === claim.account.stripeCustomerId && subscription.livemode === isLive &&
      ['active', 'trialing', 'past_due'].includes(subscription.status) &&
      subscription.metadata.invitationId === claim.invitation.id && subscription.metadata.conditionType === 'custom' &&
      subscription.itemsComplete && singleItem?.priceId === row.customQuantitySyncPriceId;
    if (!bindingMatches || !singleItem) {
      await setTerminalStatus(input.contaId, row, 'BLOCKED', 'STRIPE_SUBSCRIPTION_PRICE_OR_TENANT_MISMATCH', input.now, input.runTenant, singleItem?.id ?? null);
      return { status: 'BLOCKED', changed: true };
    }
    const metadataPeriod = singleItem.metadata.alusaQuantitySyncPeriod;
    if (metadataPeriod && metadataPeriod > period) {
      await setTerminalStatus(input.contaId, row, 'SUPERSEDED', 'REMOTE_NEWER_QUANTITY_SYNC_EXISTS', input.now, input.runTenant, singleItem.id);
      return { status: 'SUPERSEDED', changed: true };
    }
    if (metadataPeriod === period && singleItem.quantity === expectedQty) {
      await setTerminalStatus(input.contaId, row, 'SUCCEEDED', null, input.now, input.runTenant, singleItem.id);
      return { status: 'SUCCEEDED', changed: true };
    }
    await input.runTenant(input.contaId, async (tx) => tx.platformBillingMonthlySnapshot.updateMany({
      where: { id: row.id, contaId: input.contaId, environment: input.environment, customQuantitySyncStatus: 'PROCESSING' },
      data: { customQuantitySyncStripeSubscriptionItemId: singleItem.id },
    }));
    const updated = await update({
      subscriptionItemId: singleItem.id,
      quantity: expectedQty,
      operationPeriod: period,
      idempotencyKey: operationKey,
    });
    if (updated.id !== singleItem.id || updated.quantity !== expectedQty) {
      await markUnknown(input.contaId, row, 'STRIPE_QUANTITY_RESULT_MISMATCH', input.now, input.runTenant);
      return { status: 'UNKNOWN', changed: true };
    }
    await setTerminalStatus(input.contaId, row, 'SUCCEEDED', null, input.now, input.runTenant, singleItem.id);
    return { status: 'SUCCEEDED', changed: true };
  } catch (error) {
    const errorCode = readStripeErrorCode(error);
    await markUnknown(input.contaId, row, errorCode, input.now, input.runTenant);
    logApiOperationalEvent({
      severity: 'error', eventName: 'job.platform_billing.custom_quantity_sync.unknown',
      route: '/api/jobs/platform-billing-maintenance', method: 'JOB',
      requestId: operationKey, error,
    });
    return { status: 'UNKNOWN', changed: true };
  }
}

async function setTerminalStatus(
  contaId: string,
  row: SnapshotSyncRow,
  status: 'SUCCEEDED' | 'BLOCKED' | 'SUPERSEDED',
  errorCode: string | null,
  now: Date,
  runTenant: typeof runWithTenant,
  subscriptionItemId?: string | null,
) {
  await runTenant(contaId, async (tx) => {
    const update = await tx.platformBillingMonthlySnapshot.updateMany({
      where: { id: row.id, contaId, environment: row.environment, customQuantitySyncStatus: { in: ['PROCESSING', 'UNKNOWN', 'PENDING'] } },
      data: {
        customQuantitySyncStatus: status,
        customQuantitySyncStripeSubscriptionItemId: subscriptionItemId ?? undefined,
        customQuantitySyncLastErrorCode: errorCode,
        customQuantitySyncAppliedAt: status === 'SUCCEEDED' ? now : undefined,
      },
    });
    if (update.count === 1) await createSyncAudit(tx, {
      contaId, billingAccountId: null,
      action: `CUSTOM_QUANTITY_SYNC_${status}`,
      operationKey: row.customQuantitySyncOperationKey!, period: periodKey(row.periodStart),
      metadata: { requestedQuantity: row.customQuantitySyncRequestedQuantity, stripeItemId: subscriptionItemId ?? row.customQuantitySyncStripeSubscriptionItemId, errorCode },
    });
    if (update.count === 1 && status === 'BLOCKED') await upsertSyncIssue(tx, {
      contaId, billingAccountId: null, environment: row.environment,
      period: periodKey(row.periodStart), operationKey: row.customQuantitySyncOperationKey!, reason: errorCode ?? 'STRIPE_BINDING_MISMATCH',
    });
    if (update.count === 1 && status === 'SUCCEEDED') await tx.platformBillingIssue.updateMany({
      where: { environment: row.environment, fingerprint: syncIssueFingerprint(contaId), status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: now },
    }).then(async (resolved) => {
      if (resolved.count === 1) await createSyncAudit(tx, {
        contaId, billingAccountId: null, action: 'CUSTOM_QUANTITY_SYNC_BLOCKED_ISSUE_RESOLVED',
        operationKey: row.customQuantitySyncOperationKey!, period: periodKey(row.periodStart),
        metadata: { resolution: 'subscription binding verified and quantity applied' },
      });
    });
  });
}

async function markUnknown(contaId: string, row: SnapshotSyncRow, errorCode: string, now: Date, runTenant: typeof runWithTenant) {
  await runTenant(contaId, async (tx) => {
    const update = await tx.platformBillingMonthlySnapshot.updateMany({
      where: { id: row.id, contaId, environment: row.environment, customQuantitySyncStatus: 'PROCESSING' },
      data: { customQuantitySyncStatus: 'UNKNOWN', customQuantitySyncLastErrorCode: errorCode, customQuantitySyncLastAttemptAt: now },
    });
    if (update.count === 1) await createSyncAudit(tx, {
      contaId, billingAccountId: null, action: 'CUSTOM_QUANTITY_SYNC_UNKNOWN',
      operationKey: row.customQuantitySyncOperationKey!, period: periodKey(row.periodStart),
      metadata: { requestedQuantity: row.customQuantitySyncRequestedQuantity, errorCode },
    });
  });
}

async function createSyncAudit(tx: TenantTransactionClient, input: {
  contaId: string; billingAccountId: string | null; action: string; operationKey: string; period: string; metadata: Prisma.InputJsonObject;
}) {
  await tx.platformBillingAuditLog.create({
    data: {
      contaId: input.contaId, billingAccountId: input.billingAccountId,
      action: input.action, entityType: 'PlatformBillingMonthlySnapshot', entityId: input.period,
      correlationId: input.operationKey, metadata: input.metadata,
    },
  });
}

async function upsertSyncIssue(tx: TenantTransactionClient, input: {
  contaId: string; billingAccountId: string | null; environment: PlatformBillingEnvironment;
  period: string; operationKey: string; reason: string;
}) {
  const fingerprint = syncIssueFingerprint(input.contaId);
  await tx.platformBillingIssue.upsert({
    where: { uq_platform_billing_issue_env_fingerprint: { environment: input.environment, fingerprint } },
    create: {
      contaId: input.contaId, billingAccountId: input.billingAccountId, environment: input.environment,
      severity: 'WARNING', code: 'CUSTOM_SUBSCRIPTION_QUANTITY_SYNC_BLOCKED',
      title: 'Revisão de quantidade da assinatura personalizada',
      message: 'A quantidade da assinatura personalizada não pôde ser confirmada com segurança. Revise o vínculo da assinatura e do preço. Após a correção, o job de manutenção tentará novamente automaticamente a cada hora.',
      fingerprint, correlationId: input.operationKey,
      details: { period: input.period, reason: input.reason, operationKey: input.operationKey },
    },
    update: { updatedAt: new Date(), details: { period: input.period, reason: input.reason, operationKey: input.operationKey } },
  });
}

function buildOperationKey(environment: PlatformBillingEnvironment, contaId: string, period: string) {
  const tenantHash = createHash('sha256').update(contaId).digest('hex').slice(0, 24);
  return `alusa-custom-qty-${environment.toLowerCase()}-${tenantHash}-${period}`;
}

function syncIssueFingerprint(contaId: string) {
  return `custom-subscription-quantity-sync:${createHash('sha256').update(contaId).digest('hex').slice(0, 24)}`;
}

function periodKey(periodStart: Date) {
  return periodStart.toISOString().slice(0, 7);
}

function readStripeErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code.slice(0, 80);
  return 'STRIPE_REQUEST_UNKNOWN';
}
