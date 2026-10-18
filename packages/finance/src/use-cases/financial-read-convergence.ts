import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { prisma } from '@alusa/database';

import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { handleSubscriptionWebhook } from '../webhooks/subscription-webhook-handler';
import { getSubscription, listInstallmentPayments, listSubscriptionPayments } from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';
import { assertCompleteAsaasPage } from './asaas-pagination';

const TERMINAL_CHARGE_STATUSES = new Set(['PAID', 'CANCELED', 'REFUNDED']);
const INSTALLMENT_PAYMENT_PAGE_SIZE = 100;
const INSTALLMENT_PAYMENT_MAX_PAGES = 100;

type StandaloneSubscriptionMutableDelegate = {
  update?: (args: {
    where: { id: string };
    data: {
      status?: string;
      statusUpdatedAt?: Date;
      nextDueDate?: Date | null;
    };
  }) => Promise<unknown>;
};

function getStandaloneSubscriptionMutableDelegate(): StandaloneSubscriptionMutableDelegate | null {
  return (
    (prisma as unknown as { standaloneSubscription?: StandaloneSubscriptionMutableDelegate })
      .standaloneSubscription ?? null
  );
}

function buildSyntheticSubscriptionEvent(params: {
  status?: string | null;
  deleted?: boolean | null;
}): string {
  if (params.deleted) return 'SUBSCRIPTION_DELETED';
  if (params.status === 'INACTIVE') return 'SUBSCRIPTION_INACTIVATED';
  return 'SUBSCRIPTION_UPDATED';
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function convergePaymentIds(params: {
  contaId: string;
  asaasPaymentIds: Iterable<string>;
}): Promise<boolean> {
  const uniquePaymentIds = Array.from(new Set(params.asaasPaymentIds)).filter(Boolean);
  let converged = false;

  for (const asaasPaymentId of uniquePaymentIds) {
    try {
      const syncResult = await syncPaymentStateFromAsaas({
        contaId: params.contaId,
        asaasPaymentId,
      });
      if (syncResult.success) {
        converged = true;
      }
    } catch (error) {
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.use_cases.financial_read_convergence.degraded',
        error: error,
        throttleMs: 60_000,
      });
    }
  }

  return converged;
}

export async function convergeStandaloneChargesWithAsaas(params: {
  contaId: string;
  charges: Array<{
    asaasPaymentId: string | null;
    status: string;
  }>;
}): Promise<boolean> {
  const pendingPaymentIds = params.charges
    .filter((charge) => charge.asaasPaymentId && !TERMINAL_CHARGE_STATUSES.has(charge.status))
    .map((charge) => charge.asaasPaymentId as string);

  if (pendingPaymentIds.length === 0) {
    return false;
  }

  return convergePaymentIds({ contaId: params.contaId, asaasPaymentIds: pendingPaymentIds });
}

export async function convergeInstallmentPlansWithAsaas(params: {
  contaId: string;
  plans: Array<{
    id: string;
    asaasInstallmentId: string | null;
  }>;
}): Promise<boolean> {
  let converged = false;
  const uniqueInstallmentIds = Array.from(
    new Set(params.plans.map((plan) => plan.asaasInstallmentId).filter(Boolean)),
  ) as string[];

  for (const installmentId of uniqueInstallmentIds) {
    try {
      const paymentIds: string[] = [];
      const seenPaymentIds = new Set<string>();
      let lookupComplete = false;
      let expectedTotalCount: number | undefined;
      for (let page = 0; page < INSTALLMENT_PAYMENT_MAX_PAGES; page += 1) {
        const offset = page * INSTALLMENT_PAYMENT_PAGE_SIZE;
        const response = await listInstallmentPayments(installmentId, {
          contaId: params.contaId,
          limit: INSTALLMENT_PAYMENT_PAGE_SIZE,
          offset,
        });
        if (
          !response ||
          !Array.isArray(response.data) ||
          typeof response.hasMore !== 'boolean' ||
          response.offset !== offset ||
          response.limit !== INSTALLMENT_PAYMENT_PAGE_SIZE ||
          response.data.some((payment) => {
            const id = typeof payment?.id === 'string' ? payment.id.trim() : '';
            if (!id || seenPaymentIds.has(id)) return true;
            seenPaymentIds.add(id);
            return false;
          })
        ) {
          throw new Error(`INSTALLMENT_PAYMENT_LOOKUP_INCOMPLETE:${installmentId}:invalid_page:${page}`);
        }
        try {
          expectedTotalCount = assertCompleteAsaasPage(response, offset, INSTALLMENT_PAYMENT_PAGE_SIZE, expectedTotalCount);
        } catch (error) {
          throw new Error(`INSTALLMENT_PAYMENT_LOOKUP_INCOMPLETE:${installmentId}:total_count:${page}`, { cause: error });
        }
        for (const payment of response.data) {
          paymentIds.push(payment.id.trim());
        }
        if (!response.hasMore) {
          lookupComplete = true;
          break;
        }
        if (response.data.length === 0) {
          throw new Error(`INSTALLMENT_PAYMENT_LOOKUP_INCOMPLETE:${installmentId}:empty_page_with_more:${page}`);
        }
        if (page === INSTALLMENT_PAYMENT_MAX_PAGES - 1) {
          throw new Error(`INSTALLMENT_PAYMENT_LOOKUP_INCOMPLETE:${installmentId}:max_pages_reached:${INSTALLMENT_PAYMENT_MAX_PAGES}`);
        }
      }
      if (!lookupComplete) {
        throw new Error(`INSTALLMENT_PAYMENT_LOOKUP_INCOMPLETE:${installmentId}:not_complete`);
      }

      const synced = await convergePaymentIds({
        contaId: params.contaId,
        asaasPaymentIds: paymentIds,
      });

      converged = synced || converged;
    } catch (error) {
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.use_cases.financial_read_convergence.degraded',
        error: error,
        throttleMs: 60_000,
      });
    }
  }

  return converged;
}

export async function convergeSubscriptionsWithAsaas(params: {
  contaId: string;
  subscriptions: Array<{
    id: string;
    source: 'ACADEMIC' | 'STANDALONE' | 'LEGACY_MANUAL';
    asaasSubscriptionId: string | null;
    externalReference?: string | null;
  }>;
  paymentLimit?: number;
}): Promise<boolean> {
  const grouped = new Map<
    string,
    Array<{
      id: string;
      source: 'ACADEMIC' | 'STANDALONE' | 'LEGACY_MANUAL';
      externalReference?: string | null;
    }>
  >();

  for (const subscription of params.subscriptions) {
    if (!subscription.asaasSubscriptionId) continue;
    const current = grouped.get(subscription.asaasSubscriptionId) ?? [];
    current.push({
      id: subscription.id,
      source: subscription.source,
      externalReference: subscription.externalReference ?? null,
    });
    grouped.set(subscription.asaasSubscriptionId, current);
  }

  if (grouped.size === 0) {
    return false;
  }

  let converged = false;
  const standaloneDelegate = getStandaloneSubscriptionMutableDelegate();

  for (const [asaasSubscriptionId, descriptors] of grouped.entries()) {
    try {
      const remoteSubscription = await getSubscription(asaasSubscriptionId, {
        contaId: params.contaId,
      });

      for (const descriptor of descriptors) {
        if (descriptor.source === 'ACADEMIC') {
          const result = await handleSubscriptionWebhook(params.contaId, {
            event: buildSyntheticSubscriptionEvent({
              status: remoteSubscription.status,
              deleted: remoteSubscription.deleted,
            }),
            eventId: `read-convergence:${remoteSubscription.id}:${remoteSubscription.status ?? 'unknown'}:${remoteSubscription.deleted ? 'deleted' : 'active'}`,
            subscription: {
              id: remoteSubscription.id,
              status: remoteSubscription.status,
              externalReference:
                remoteSubscription.externalReference ?? descriptor.externalReference ?? undefined,
              deleted: remoteSubscription.deleted,
            },
          });

          converged = result.success || converged;
          continue;
        }

        if (descriptor.source === 'STANDALONE' && standaloneDelegate?.update) {
          await standaloneDelegate.update({
            where: { id: descriptor.id },
            data: {
              status: mapAsaasSubscriptionStatus({
                status: remoteSubscription.status,
                deleted: remoteSubscription.deleted,
              }),
              statusUpdatedAt: new Date(),
              nextDueDate: parseDateOnly(remoteSubscription.nextDueDate),
            },
          });
          converged = true;
        }
      }

      const remotePayments = await listSubscriptionPayments(asaasSubscriptionId, {
        contaId: params.contaId,
        limit: params.paymentLimit ?? 12,
        offset: 0,
      });

      const syncedPayments = await convergePaymentIds({
        contaId: params.contaId,
        asaasPaymentIds: remotePayments.data.map((payment) => payment.id),
      });

      converged = syncedPayments || converged;
    } catch (error) {
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.use_cases.financial_read_convergence.degraded',
        error: error,
        throttleMs: 60_000,
      });
    }
  }

  return converged;
}
