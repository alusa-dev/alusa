import { prisma } from '@alusa/database';

import { mapAsaasSubscriptionStatus } from '../mappers/asaas-subscription-status';
import { handleSubscriptionWebhook } from '../webhooks/subscription-webhook-handler';
import {
  getSubscription,
  listInstallmentPayments,
  listSubscriptionPayments,
} from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

const TERMINAL_CHARGE_STATUSES = new Set(['PAID', 'CANCELED', 'REFUNDED']);

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
  return ((prisma as unknown as { standaloneSubscription?: StandaloneSubscriptionMutableDelegate })
    .standaloneSubscription ?? null);
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
      console.warn('[finance][convergePaymentIds] falha ao sincronizar payment', {
        contaId: params.contaId,
        asaasPaymentId,
        error: error instanceof Error ? error.message : String(error),
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
    .filter(
      (charge) =>
        charge.asaasPaymentId &&
        !TERMINAL_CHARGE_STATUSES.has(charge.status),
    )
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
      const remotePayments = await listInstallmentPayments(installmentId, {
        contaId: params.contaId,
        limit: 100,
        offset: 0,
      });

      const synced = await convergePaymentIds({
        contaId: params.contaId,
        asaasPaymentIds: remotePayments.data.map((payment) => payment.id),
      });

      converged = synced || converged;
    } catch (error) {
      console.warn('[finance][convergeInstallmentPlansWithAsaas] falha ao reconciliar parcelamento', {
        contaId: params.contaId,
        installmentId,
        error: error instanceof Error ? error.message : String(error),
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
      console.warn('[finance][convergeSubscriptionsWithAsaas] falha ao reconciliar assinatura', {
        contaId: params.contaId,
        asaasSubscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return converged;
}