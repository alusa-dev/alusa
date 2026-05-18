import { emitBillingNotifications } from '@alusa/lib';
import { processAsaasWebhookQueue } from './asaas-webhook-handler.server';

export type ProcessAsaasWebhookQueueParams = Parameters<typeof processAsaasWebhookQueue>[0];
export type ProcessAsaasWebhookQueueResult = Awaited<ReturnType<typeof processAsaasWebhookQueue>>;

/**
 * Processa fila de webhooks Asaas e emite notificações internas da inbox.
 */
export async function processAsaasWebhookQueueWithInbox(
  params?: ProcessAsaasWebhookQueueParams,
): Promise<ProcessAsaasWebhookQueueResult> {
  const result = await processAsaasWebhookQueue(params);

  try {
    await emitBillingNotifications(result.processedPayments, 'ASAAS_WEBHOOK');
  } catch (error) {
    console.warn('[processAsaasWebhookQueueWithInbox] Falha não crítica ao emitir inbox', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
