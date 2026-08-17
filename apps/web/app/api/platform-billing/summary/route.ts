import { NextResponse } from 'next/server';
import {
  PLATFORM_PLANS,
  PLATFORM_BILLING_CAPABILITIES,
  canUsePlatformCapability,
  createPrismaPlatformBillingStore,
  derivePlatformBillingCommunication,
  derivePlatformAccessStatus,
  derivePlatformRestrictionReason,
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

      const paymentMethod = resolvePaymentMethodSummary(account);

      const summaryPayload = {
          environment,
          canManage: actor.canManagePlatformBilling,
          billingInfo: {
            contaName: actor.conta?.nome ?? 'Conta Alusa',
            email: actor.user?.email ?? null,
          },
          activeStudents,
          account: account ? serializeAccount(account) : null,
          access: serializeAccessSnapshot(account),
          paymentMethod,
          plans: Object.values(PLATFORM_PLANS).filter((plan) => plan.publicCheckoutEnabled),
          invoices: invoices.map(serializeInvoice),
          health: {
            contaId,
            stripeCustomerId: account?.stripeCustomerId ?? null,
            stripeSubscriptionId: account?.stripeSubscriptionId ?? null,
            lastWebhook: latestWebhook ? {
              id: latestWebhook.id,
              eventId: latestWebhook.eventId,
              eventType: latestWebhook.eventType,
              status: latestWebhook.status,
              receivedAt: latestWebhook.receivedAt.toISOString(),
              processedAt: latestWebhook.processedAt?.toISOString() ?? null,
              lastErrorCode: latestWebhook.lastErrorCode ?? null,
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
          contaId,
          issues: parsedSummary.error.issues.map(({ path, code, message }) => ({
            path: path.join('.'),
            code,
            message,
          })),
        });
        throw new Error('O resumo de faturamento retornou dados inválidos.');
      }

      const summary = parsedSummary.data;

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

function resolvePaymentMethodSummary(account: PlatformBillingAccountRecord | null) {
  if (!account || account.paymentMethodStatus === 'MISSING') return { status: 'missing' as const };
  // O resumo público suporta somente cartão. Dados legados podem registrar outro
  // tipo de método como PRESENT; nesse caso, não inventamos um cartão e tratamos
  // o método como desconhecido até a reconciliação atualizar o snapshot.
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
    accessStatus: derivePlatformAccessStatus({
      account: { ...account, status },
    }),
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

function serializeAccessSnapshot(account: PlatformBillingAccountRecord | null) {
  const now = new Date();
  const accessStatus = account
    ? derivePlatformAccessStatus({ account, now })
    : 'PENDING';
  const billingStatus = account?.status ?? null;
  const capabilities = Object.fromEntries(
    PLATFORM_BILLING_CAPABILITIES.map((capability) => [
      capability,
      canUsePlatformCapability({ accessStatus, capability }),
    ]),
  );
  const restrictionReason = account ? derivePlatformRestrictionReason({ account, now }) : null;
  return {
    accountId: account?.id ?? null,
    billingStatus,
    accessStatus,
    planCode: account?.planCode ?? null,
    restrictionReason,
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
