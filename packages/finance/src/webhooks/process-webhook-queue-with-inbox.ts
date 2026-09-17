import type { BillingNotificationCandidate } from '@alusa/lib/notifications/emit-billing-notifications';

import {
  drainFinanceWebhookSideEffectOutbox,
  enqueueBillingNotificationSideEffects,
} from './finance-side-effect-outbox.service';
import { processAsaasWebhookQueue } from './asaas-webhook-handler.server';

export type ProcessAsaasWebhookQueueParams = Parameters<typeof processAsaasWebhookQueue>[0];
export type ProcessAsaasWebhookQueueResult = Awaited<ReturnType<typeof processAsaasWebhookQueue>>;

export type ProcessAsaasWebhookQueueWithInboxOptions = ProcessAsaasWebhookQueueParams & {
  /**
   * Mantém compatibilidade para chamadas inline, mas permite que o scheduler
   * faça o drain de side effects exatamente uma vez em um passo próprio.
   */
  drainSideEffects?: boolean;
};

function groupCandidatesByConta(
  processedPayments: ProcessAsaasWebhookQueueResult['processedPayments'],
): Map<string, BillingNotificationCandidate[]> {
  const grouped = new Map<string, BillingNotificationCandidate[]>();

  for (const payment of processedPayments) {
    if (!payment.contaId) continue;
    const list = grouped.get(payment.contaId) ?? [];
    list.push({
      contaId: payment.contaId,
      event: payment.event,
      eventId: payment.eventId,
      asaasPaymentId: payment.asaasPaymentId,
      occurredAt: payment.occurredAt,
    });
    grouped.set(payment.contaId, list);
  }

  return grouped;
}

/**
 * Processa fila de webhooks Asaas e enfileira efeitos colaterais (inbox) via outbox.
 */
export async function processAsaasWebhookQueueWithInbox(
  params?: ProcessAsaasWebhookQueueWithInboxOptions,
): Promise<ProcessAsaasWebhookQueueResult> {
  const result = await processAsaasWebhookQueue(params);

  try {
    const grouped = groupCandidatesByConta(result.processedPayments);
    for (const [contaId, candidates] of grouped) {
      await enqueueBillingNotificationSideEffects({
        contaId,
        candidates,
        sourceType: 'ASAAS_WEBHOOK',
        webhookBatchId: result.workerId,
      });
    }

    if (params?.drainSideEffects !== false) {
      await drainFinanceWebhookSideEffectOutbox({
        contaId: params?.contaId,
        limit: Math.max(50, params?.limit ?? 100),
      });
    }
  } catch (error) {
    console.warn('[processAsaasWebhookQueueWithInbox] Falha não crítica ao enfileirar outbox', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
