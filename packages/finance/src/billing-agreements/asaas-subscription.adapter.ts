import {
  createSubscription as createAsaasSubscription,
  listSubscriptions as listAsaasSubscriptions,
  type AsaasPayment,
  type AsaasSubscription,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';

import { buildSafeAsaasIdempotencyKey } from '../core/idempotency.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import {
  deletePayment,
  deleteSubscription,
  getPayment,
  getSubscription,
  listSubscriptionPayments,
  updatePayment,
  updateSubscription,
} from '../use-cases/asaas-ops';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { decimalToCents, centsToDecimal } from './money';
import type {
  AsaasSubscriptionPaymentSnapshot,
  AsaasSubscriptionPort,
  AsaasSubscriptionSnapshot,
} from './ports';

async function getApiKey(contaId: string): Promise<string> {
  const credentials = await loadAsaasCredentials(contaId);
  if (!credentials) throw new Error('Credenciais Asaas não configuradas para a conta.');
  return credentials.apiKey;
}

async function assertMutationOperational(contaId: string): Promise<void> {
  const kyc = await requireKycApproved(contaId);
  if (!kyc.success) throw new Error('KYC da subconta não permite mutação financeira.');
  await ensureWebhookConfigOperational(contaId);
}

function mapSubscription(subscription: AsaasSubscription): AsaasSubscriptionSnapshot {
  return {
    id: subscription.id,
    customerId: subscription.customer,
    valueCents: decimalToCents(subscription.value),
    billingType: subscription.billingType,
    cycle: subscription.cycle,
    status: subscription.status,
    nextDueDate: subscription.nextDueDate,
    endDate: subscription.endDate ?? null,
    externalReference: subscription.externalReference ?? null,
    deleted: subscription.deleted,
  };
}

function mapPayment(payment: AsaasPayment): AsaasSubscriptionPaymentSnapshot {
  return {
    id: payment.id,
    status: payment.status,
    valueCents: decimalToCents(payment.value),
    dueDate: payment.dueDate,
    billingType: payment.billingType,
    deleted: payment.deleted ?? false,
  };
}

export function createAsaasBillingAgreementPort(): AsaasSubscriptionPort {
  return {
    async getSubscription(input) {
      return mapSubscription(
        await getSubscription(input.subscriptionId, { contaId: input.contaId }),
      );
    },

    async listSubscriptionPayments(input) {
      const payments: AsaasSubscriptionPaymentSnapshot[] = [];
      let offset = 0;
      for (;;) {
        const page = await listSubscriptionPayments(input.subscriptionId, {
          contaId: input.contaId,
          limit: 100,
          offset,
        });
        payments.push(...page.data.map(mapPayment));
        if (!page.hasMore) return payments;
        offset += page.limit || page.data.length;
      }
    },

    async findSubscriptionByExternalReference(input) {
      const apiKey = await getApiKey(input.contaId);
      const page = await listAsaasSubscriptions({
        apiKey,
        externalReference: input.externalReference,
        includeDeleted: input.includeDeleted,
        limit: 10,
      });
      const exact = page.data.find(
        (subscription) => subscription.externalReference === input.externalReference,
      );
      return exact ? mapSubscription(exact) : null;
    },

    async createSubscription(input) {
      await assertMutationOperational(input.contaId);
      const apiKey = await getApiKey(input.contaId);
      const created = await createAsaasSubscription({
        apiKey,
        idempotencyKey: buildSafeAsaasIdempotencyKey(input.idempotencyKey),
        data: {
          customer: input.customerId,
          value: centsToDecimal(input.valueCents),
          billingType: input.billingType,
          cycle: input.cycle,
          nextDueDate: input.nextDueDate,
          endDate: input.endDate ?? undefined,
          description: input.description ?? undefined,
          externalReference: input.externalReference,
        },
      });
      return mapSubscription(created);
    },

    async updateSubscription(input) {
      const updated = await updateSubscription(
        input.subscriptionId,
        {
          value: centsToDecimal(input.valueCents),
          updatePendingPayments: input.updatePendingPayments,
          status: input.status,
          nextDueDate: input.nextDueDate,
          endDate: input.endDate,
        },
        { contaId: input.contaId },
      );
      return mapSubscription(updated);
    },

    async deleteSubscription(input) {
      const deleted = await deleteSubscription(input.subscriptionId, { contaId: input.contaId });
      return { id: deleted.id, deleted: deleted.deleted };
    },

    async getPayment(input) {
      return mapPayment(await getPayment(input.paymentId, { contaId: input.contaId }));
    },

    async updatePayment(input) {
      const updated = await updatePayment(
        input.paymentId,
        {
          value: centsToDecimal(input.valueCents),
          billingType: input.billingType,
          dueDate: input.dueDate,
        },
        { contaId: input.contaId },
      );
      return mapPayment(updated);
    },

    async deletePayment(input) {
      const deleted = await deletePayment(input.paymentId, { contaId: input.contaId });
      return { id: deleted.id, deleted: deleted.deleted ?? true };
    },
  };
}
