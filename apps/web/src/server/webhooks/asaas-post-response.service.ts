import { processAsaasWebhookQueueWithInbox } from '@alusa/finance';
import { logApiOperationalEvent } from '@/lib/observability/api-logger';
import {
  dispatchEventTicketWhatsAppNotification,
  findRecentlyCreatedPendingEventTicketWhatsAppNotifications,
} from '@/src/server/events/event-ticket-whatsapp-outbox.service';

/** Processes one persisted webhook after the HTTP response and wakes its ticket notices. */
export async function processAsaasWebhookPostResponse(input: {
  contaId: string;
  webhookId: string;
  requestId: string;
}): Promise<void> {
  const notificationCreatedAt = new Date();
  try {
    const processed = await processAsaasWebhookQueueWithInbox({
      contaId: input.contaId,
      webhookId: input.webhookId,
      limit: 1,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'WEBHOOK',
      drainSideEffects: false,
    });
    if (!processed.processed) return;

    const notifications = await findRecentlyCreatedPendingEventTicketWhatsAppNotifications({
      contaId: input.contaId,
      createdSince: notificationCreatedAt,
      limit: 2,
    });
    for (const notification of notifications) {
      try {
        await dispatchEventTicketWhatsAppNotification({ contaId: input.contaId, notificationId: notification.id });
      } catch {
        // Durable notification and scheduled worker retain retry ownership.
      }
    }
  } catch (error) {
    logApiOperationalEvent({
      severity: 'warn',
      eventName: 'api.webhook.post_response_drain.failed',
      route: '/api/webhooks/asaas',
      method: 'POST',
      requestId: input.requestId,
      error,
    });
  }
}
