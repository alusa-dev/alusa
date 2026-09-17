import {
  PLATFORM_BILLING_CAPABILITIES,
  PLATFORM_PLANS,
  canUsePlatformCapability,
  createPrismaPlatformBillingStore,
  derivePlatformAccessStatus,
  derivePlatformBillingCommunication,
  derivePlatformRestrictionReason,
  type PlatformBillingAccountRecord,
  type PlatformBillingInvoiceRecord,
} from '@alusa/platform-billing';
import { platformBillingSummaryDTOSchema, type PlatformBillingSummaryDTO } from '@/features/platform-billing/dtos/platform-billing-summary';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import {
  countActivePlatformBillingStudents,
  resolvePlatformBillingActor,
} from './platform-billing-server';

export type PlatformBillingSummaryResult =
  | { ok: true; summary: PlatformBillingSummaryDTO }
  | { ok: false; reason: 'FORBIDDEN' };

/**
 * Read model for the tenant's platform billing dashboard.
 *
 * The route handler is intentionally unaware of Prisma shapes and Stripe
 * snapshots. All queries are executed through the tenant transaction client,
 * and every platform-billing record is constrained by contaId.
 */
export async function getPlatformBillingSummary(params: {
  tx: TenantTransactionClient;
  contaId: string;
  userId: string;
  environment: 'TEST' | 'LIVE';
}): Promise<PlatformBillingSummaryResult> {
  const actor = await resolvePlatformBillingActor(params);
  if (!actor.canManagePlatformBilling) return { ok: false, reason: 'FORBIDDEN' };

  const store = createPrismaPlatformBillingStore(params.tx);
  const [account, invoices, activeStudents, planChanges, issues, latestWebhook, webhookStats, latestReconciliation] = await Promise.all([
    store.findAccount({ contaId: params.contaId, environment: params.environment }),
    store.listInvoices({ contaId: params.contaId, environment: params.environment, limit: 24 }),
    countActivePlatformBillingStudents({ tx: params.tx, contaId: params.contaId }),
    params.tx.platformBillingPlanChange.findMany({
      where: {
        contaId: params.contaId,
        environment: params.environment,
        status: { in: ['PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE', 'FAILED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        type: true,
        status: true,
        fromPlanCode: true,
        toPlanCode: true,
        effectiveAt: true,
        requestedAt: true,
        lastError: true,
      },
    }),
    params.tx.platformBillingIssue.findMany({
      where: {
        contaId: params.contaId,
        environment: params.environment,
        status: 'OPEN',
      },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        severity: true,
        code: true,
        title: true,
        message: true,
        detectedAt: true,
      },
    }),
    params.tx.platformBillingWebhookEvent.findFirst({
      where: { environment: params.environment, contaId: params.contaId },
      orderBy: { receivedAt: 'desc' },
      select: {
        id: true,
        eventId: true,
        eventType: true,
        status: true,
        receivedAt: true,
        processedAt: true,
        lastErrorCode: true,
      },
    }),
    params.tx.platformBillingWebhookEvent.groupBy({
      by: ['status'],
      where: {
        environment: params.environment,
        contaId: params.contaId,
        status: { in: ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'] },
      },
      _count: { _all: true },
    }),
    params.tx.platformBillingAuditLog.findFirst({
      where: {
        contaId: params.contaId,
        action: 'PLATFORM_BILLING_RECONCILIATION_CORRECTED',
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, correlationId: true },
    }),
  ]);

  const now = new Date();
  const summaryPayload = {
    environment: params.environment,
    canManage: actor.canManagePlatformBilling,
    billingInfo: {
      contaName: actor.conta?.nome ?? 'Conta Alusa',
      email: actor.user?.email ?? null,
    },
    activeStudents,
    account: account ? serializeAccount(account) : null,
    access: serializeAccessSnapshot(account, now),
    paymentMethod: resolvePaymentMethodSummary(account),
    plans: Object.values(PLATFORM_PLANS).filter((plan) => plan.publicCheckoutEnabled),
    invoices: invoices.map(serializeInvoice),
    health: {
      contaId: params.contaId,
      stripeCustomerId: account?.stripeCustomerId ?? null,
      stripeSubscriptionId: account?.stripeSubscriptionId ?? null,
      lastWebhook: latestWebhook
        ? {
            id: latestWebhook.id,
            eventId: latestWebhook.eventId,
            eventType: latestWebhook.eventType,
            status: latestWebhook.status,
            receivedAt: latestWebhook.receivedAt.toISOString(),
            processedAt: latestWebhook.processedAt?.toISOString() ?? null,
            lastErrorCode: latestWebhook.lastErrorCode ?? null,
          }
        : null,
      webhookStats: webhookStats.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = item._count._all;
        return acc;
      }, {}),
      lastReconciliation: account?.lastReconciledAt?.toISOString() ?? latestReconciliation?.createdAt.toISOString() ?? null,
      pendingChanges: planChanges.filter((change) =>
        change.status === 'PENDING_PAYMENT' || change.status === 'PENDING_EFFECTIVE_DATE',
      ).length,
      openIssues: issues.length,
    },
    planChanges: planChanges.map((change) => ({
      id: change.id,
      type: change.type,
      status: change.status,
      fromPlanCode: change.fromPlanCode ?? null,
      toPlanCode: change.toPlanCode ?? null,
      effectiveAt: change.effectiveAt?.toISOString() ?? null,
      requestedAt: change.requestedAt.toISOString(),
      lastError: change.lastError ? change.lastError.slice(0, 500) : null,
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      code: issue.code,
      title: issue.title,
      message: issue.message,
      detectedAt: issue.detectedAt.toISOString(),
    })),
  };

  const parsedSummary = platformBillingSummaryDTOSchema.safeParse(summaryPayload);
  if (!parsedSummary.success) {
    console.error('[platform-billing][summary] invalid response DTO', {
      contaId: params.contaId,
      issues: parsedSummary.error.issues.map(({ path, code, message }) => ({
        path: path.join('.'),
        code,
        message,
      })),
    });
    throw new Error('O resumo de faturamento retornou dados inválidos.');
  }

  return { ok: true, summary: parsedSummary.data };
}

function resolvePaymentMethodSummary(account: PlatformBillingAccountRecord | null) {
  if (!account || account.paymentMethodStatus === 'MISSING') return { status: 'missing' as const };
  if (account.paymentMethodStatus !== 'PRESENT' || account.paymentMethodType !== 'card') {
    return { status: 'unknown' as const };
  }
  return {
    status: 'present' as const,
    type: 'card' as const,
    brand: account.paymentMethodBrand ?? null,
    last4: account.paymentMethodLast4 ?? '****',
    expMonth: account.paymentMethodExpMonth ?? null,
    expYear: account.paymentMethodExpYear ?? null,
  };
}

function serializeAccount(account: PlatformBillingAccountRecord) {
  const status = normalizeAccountStatusForSummary(account);
  return {
    id: account.id,
    status,
    planCode: account.planCode ?? null,
    stripeCustomerId: account.stripeCustomerId ?? null,
    stripeSubscriptionId: account.stripeSubscriptionId ?? null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    accessStatus: derivePlatformAccessStatus({ account: { ...account, status } }),
    stripePriceId: account.stripePriceId ?? null,
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
    trialWillEndNotifiedAt: account.trialWillEndNotifiedAt?.toISOString() ?? null,
    gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
    restrictedAt: account.restrictedAt?.toISOString() ?? null,
    canceledAt: account.canceledAt?.toISOString() ?? null,
    lastPaymentFailedAt: account.lastPaymentFailedAt?.toISOString() ?? null,
    firstPaidAt: account.firstPaidAt?.toISOString() ?? null,
    lastSuccessfulPaymentAt: account.lastSuccessfulPaymentAt?.toISOString() ?? null,
    paymentMethodStatus: account.paymentMethodStatus ?? 'UNKNOWN',
    paymentMethodType: account.paymentMethodType ?? null,
    paymentMethodBrand: account.paymentMethodBrand ?? null,
    paymentMethodLast4: account.paymentMethodLast4 ?? null,
    paymentMethodExpMonth: account.paymentMethodExpMonth ?? null,
    paymentMethodExpYear: account.paymentMethodExpYear ?? null,
    restrictionReason: derivePlatformRestrictionReason({ account: { ...account, status } }),
    gracePeriodStartedAt: account.gracePeriodStartedAt?.toISOString() ?? null,
    accessStateVersion: account.accessStateVersion ?? 0,
    lastProviderEventCreatedAt: account.lastProviderEventCreatedAt?.toISOString() ?? null,
    lastReconciledAt: account.lastReconciledAt?.toISOString() ?? null,
    pendingPlanCode: account.pendingPlanCode ?? null,
    pendingChangeType: account.pendingChangeType ?? null,
    pendingChangeEffectiveAt: account.pendingChangeEffectiveAt?.toISOString() ?? null,
  };
}

function serializeAccessSnapshot(account: PlatformBillingAccountRecord | null, now: Date) {
  const accessStatus = account ? derivePlatformAccessStatus({ account, now }) : 'PENDING';
  const billingStatus = account?.status ?? null;
  const capabilities = Object.fromEntries(
    PLATFORM_BILLING_CAPABILITIES.map((capability) => [
      capability,
      canUsePlatformCapability({ accessStatus, capability }),
    ]),
  );
  return {
    accountId: account?.id ?? null,
    billingStatus,
    accessStatus,
    planCode: account?.planCode ?? null,
    restrictionReason: account ? derivePlatformRestrictionReason({ account, now }) : null,
    trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
    gracePeriodEndsAt: account?.gracePeriodEndsAt?.toISOString() ?? null,
    currentPeriodEnd: account?.currentPeriodEnd?.toISOString() ?? null,
    hasPaymentMethod: account?.paymentMethodStatus === 'PRESENT',
    firstPaidAt: account?.firstPaidAt?.toISOString() ?? null,
    capabilities,
    communication: derivePlatformBillingCommunication({ account, now }),
    generatedAt: now.toISOString(),
  };
}

function normalizeAccountStatusForSummary(account: PlatformBillingAccountRecord) {
  if (account.pendingChangeType === 'REACTIVATE' && account.status === 'CHECKOUT_PENDING') {
    return 'CANCELED' as const;
  }
  if (account.status === 'ACTIVE' && account.trialEndsAt && account.trialEndsAt.getTime() > Date.now()) {
    return 'TRIALING' as const;
  }
  return account.status;
}

function serializeInvoice(invoice: PlatformBillingInvoiceRecord) {
  return {
    id: invoice.id,
    stripeInvoiceId: invoice.stripeInvoiceId,
    planCode: invoice.planCode ?? null,
    number: invoice.number ?? null,
    status: invoice.status,
    amountPaid: invoice.amountPaid,
    amountDue: invoice.amountDue,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null,
    invoicePdf: invoice.invoicePdf ?? null,
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    failedAt: invoice.failedAt?.toISOString() ?? null,
    attempted: invoice.attempted,
    attemptCount: invoice.attemptCount,
    nextPaymentAttempt: invoice.nextPaymentAttempt?.toISOString() ?? null,
    lastPaymentErrorCode: invoice.lastPaymentErrorCode ?? null,
    lastPaymentErrorMessage: invoice.lastPaymentErrorMessage ?? null,
  };
}
