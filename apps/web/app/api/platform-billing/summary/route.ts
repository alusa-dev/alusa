import { NextResponse } from 'next/server';
import {
  PLATFORM_PLANS,
  createPrismaPlatformBillingStore,
  type PlatformBillingAccountRecord,
  type PlatformBillingInvoiceRecord,
} from '@alusa/platform-billing';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { privateJson } from '@/lib/private-cache';
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
      const [actor, account, invoices, activeStudents, planChanges, issues] = await Promise.all([
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
      ]);

      const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
      if (forbidden) return forbidden;

      return privateJson(
        {
          environment,
          canManage: actor.canManagePlatformBilling,
          billingInfo: {
            contaName: actor.conta?.nome ?? 'Conta Alusa',
            email: actor.user?.email ?? null,
          },
          activeStudents,
          account: account ? serializeAccount(account) : null,
          plans: Object.values(PLATFORM_PLANS).filter((plan) => plan.publicCheckoutEnabled),
          invoices: invoices.map(serializeInvoice),
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
        },
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

function serializeAccount(account: PlatformBillingAccountRecord) {
  return {
    ...account,
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: account.trialEndsAt?.toISOString() ?? null,
    gracePeriodEndsAt: account.gracePeriodEndsAt?.toISOString() ?? null,
    restrictedAt: account.restrictedAt?.toISOString() ?? null,
    canceledAt: account.canceledAt?.toISOString() ?? null,
    lastPaymentFailedAt: account.lastPaymentFailedAt?.toISOString() ?? null,
    pendingChangeEffectiveAt: account.pendingChangeEffectiveAt?.toISOString() ?? null,
  };
}

function serializeInvoice(invoice: PlatformBillingInvoiceRecord) {
  return {
    ...invoice,
    periodStart: invoice.periodStart?.toISOString() ?? null,
    periodEnd: invoice.periodEnd?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    paidAt: invoice.paidAt?.toISOString() ?? null,
  };
}
