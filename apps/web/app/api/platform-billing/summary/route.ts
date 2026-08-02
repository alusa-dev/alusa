import { NextResponse } from 'next/server';
import { getStripeClient, retrieveStripeDefaultPaymentMethod } from '@alusa/stripe';
import {
  PLATFORM_PLANS,
  createPrismaPlatformBillingStore,
  derivePlatformAccessStatus,
  type PlatformBillingAccountRecord,
  type PlatformBillingInvoiceRecord,
} from '@alusa/platform-billing';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { privateJson } from '@/lib/private-cache';
import { platformBillingSummaryDTOSchema } from '@/features/platform-billing/dtos/platform-billing-summary';
import {
  assertCanManagePlatformBilling,
  countActivePlatformBillingStudents,
  resolvePlatformBillingActor,
  resolvePlatformBillingEnvironment,
} from '@/src/server/platform-billing/platform-billing-server';

export async function GET() {
  try {
    const environment = resolvePlatformBillingEnvironment();

    return withTenantSession(async ({ contaId, userId, tx }) => {
      const store = createPrismaPlatformBillingStore(tx);
      const [actor, account, invoices, activeStudents, planChanges, issues, latestWebhook, webhookStats, latestReconciliation] = await Promise.all([
        resolvePlatformBillingActor({ tx, contaId, userId }),
        store.findAccount({ contaId, environment }),
        store.listInvoices({ contaId, environment, limit: 24 }),
        countActivePlatformBillingStudents({ tx, contaId }),
        tx.platformBillingPlanChange.findMany({
          where: {
            contaId,
            environment,
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
        tx.platformBillingIssue.findMany({
          where: {
            contaId,
            environment,
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
        tx.platformBillingWebhookEvent.findFirst({
          where: {
            environment,
            contaId,
          },
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
        tx.platformBillingWebhookEvent.groupBy({
          by: ['status'],
          where: {
            environment,
            contaId,
            status: { in: ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'] },
          },
          _count: { _all: true },
        }),
        tx.platformBillingAuditLog.findFirst({
          where: {
            contaId,
            action: 'PLATFORM_BILLING_RECONCILIATION_CORRECTED',
          },
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            correlationId: true,
          },
        }),
      ]);

      const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
      if (forbidden) return forbidden;

      const paymentMethod = await resolvePaymentMethodSummary(account);

      const summary = platformBillingSummaryDTOSchema.parse({
          environment,
          canManage: actor.canManagePlatformBilling,
          billingInfo: {
            contaName: actor.conta?.nome ?? 'Conta Alusa',
            email: actor.user?.email ?? null,
          },
          activeStudents,
          account: account ? serializeAccount(account) : null,
          paymentMethod,
          plans: Object.values(PLATFORM_PLANS).filter((plan) => plan.publicCheckoutEnabled),
          invoices: invoices.map(serializeInvoice),
          health: {
            contaId,
            stripeCustomerId: account?.stripeCustomerId ?? null,
            stripeSubscriptionId: account?.stripeSubscriptionId ?? null,
            lastWebhook: latestWebhook ? {
              ...latestWebhook,
              receivedAt: latestWebhook.receivedAt.toISOString(),
              processedAt: latestWebhook.processedAt?.toISOString() ?? null,
            } : null,
            webhookStats: webhookStats.reduce<Record<string, number>>((acc, item) => {
              acc[item.status] = item._count._all;
              return acc;
            }, {}),
            lastReconciliation: account?.lastReconciledAt
              ? account.lastReconciledAt.toISOString()
              : latestReconciliation?.createdAt.toISOString() ?? null,
            pendingChanges: planChanges.filter((change) =>
              change.status === 'PENDING_PAYMENT' || change.status === 'PENDING_EFFECTIVE_DATE'
            ).length,
            openIssues: issues.length,
          },
          planChanges: planChanges.map((change) => ({
            ...change,
            effectiveAt: change.effectiveAt?.toISOString() ?? null,
            requestedAt: change.requestedAt.toISOString(),
            lastError: change.lastError ? change.lastError.slice(0, 500) : null,
          })),
          issues: issues.map((issue) => ({
            ...issue,
            detectedAt: issue.detectedAt.toISOString(),
          })),
      });

      return privateJson(
        summary,
        {
          maxAgeSeconds: 30,
          staleWhileRevalidateSeconds: 120,
          cacheState: 'MISS',
        },
      );
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'PLATFORM_BILLING_SUMMARY_FAILED',
        message: error instanceof Error ? error.message : 'Falha ao carregar faturamento.',
      },
      { status: 500 },
    );
  }
}

async function resolvePaymentMethodSummary(account: PlatformBillingAccountRecord | null) {
  if (!account?.stripeCustomerId) return { status: 'missing' as const };

  try {
    const paymentMethod = await retrieveStripeDefaultPaymentMethod(getStripeClient(process.env), {
      customerId: account.stripeCustomerId,
      subscriptionId: account.stripeSubscriptionId,
    });

    if (!paymentMethod) return { status: 'missing' as const };

    return {
      status: 'present' as const,
      type: paymentMethod.type,
      brand: paymentMethod.brand,
      last4: paymentMethod.last4,
      expMonth: paymentMethod.expMonth,
      expYear: paymentMethod.expYear,
    };
  } catch {
    return { status: 'unknown' as const };
  }
}

function serializeAccount(account: PlatformBillingAccountRecord) {
  const status = normalizeAccountStatusForSummary(account);
  return {
    ...account,
    status,
    accessStatus: derivePlatformAccessStatus({ account: { ...account, status } }),
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
    trialWillEndNotifiedAt: account.trialWillEndNotifiedAt?.toISOString() ?? null,
    gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
    restrictedAt: account.restrictedAt?.toISOString() ?? null,
    canceledAt: account.canceledAt?.toISOString() ?? null,
    lastPaymentFailedAt: account.lastPaymentFailedAt?.toISOString() ?? null,
    lastReconciledAt: account.lastReconciledAt?.toISOString() ?? null,
    pendingChangeEffectiveAt: account.pendingChangeEffectiveAt?.toISOString() ?? null,
  };
}

function normalizeAccountStatusForSummary(account: PlatformBillingAccountRecord) {
  if (account.pendingChangeType === 'REACTIVATE' && account.status === 'CHECKOUT_PENDING') {
    return 'CANCELED';
  }
  if (
    account.status === 'ACTIVE' &&
    account.trialEndsAt &&
    account.trialEndsAt.getTime() > Date.now()
  ) {
    return 'TRIALING';
  }
  return account.status;
}

function serializeInvoice(invoice: PlatformBillingInvoiceRecord) {
  return {
    ...invoice,
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    failedAt: invoice.failedAt?.toISOString() ?? null,
    nextPaymentAttempt: invoice.nextPaymentAttempt?.toISOString() ?? null,
  };
}
