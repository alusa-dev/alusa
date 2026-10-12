import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processQueue, findNotifications, dispatchNotification, logApiOperationalEvent } = vi.hoisted(() => ({
  processQueue: vi.fn(),
  findNotifications: vi.fn(),
  dispatchNotification: vi.fn(),
  logApiOperationalEvent: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({ processAsaasWebhookQueueWithInbox: processQueue }));
vi.mock('@/lib/observability/api-logger', () => ({ logApiOperationalEvent }));
vi.mock('@/src/server/events/event-ticket-whatsapp-outbox.service', () => ({
  findRecentlyCreatedPendingEventTicketWhatsAppNotifications: findNotifications,
  dispatchEventTicketWhatsAppNotification: dispatchNotification,
}));

import { processAsaasWebhookPostResponse } from './asaas-post-response.service';

describe('processAsaasWebhookPostResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes only the tenant-scoped webhook and dispatches only its recent notices', async () => {
    processQueue.mockResolvedValue({ processed: true });
    findNotifications.mockResolvedValue([{ id: 'notice-1', contaId: 'conta-a' }]);

    await processAsaasWebhookPostResponse({ contaId: 'conta-a', webhookId: 'webhook-a', requestId: 'request-a' });

    expect(processQueue).toHaveBeenCalledWith({
      contaId: 'conta-a', webhookId: 'webhook-a', limit: 1,
      statuses: ['PENDENTE', 'ERRO'], source: 'WEBHOOK', drainSideEffects: false,
    });
    expect(findNotifications).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', limit: 2, createdSince: expect.any(Date) }));
    expect(dispatchNotification).toHaveBeenCalledWith({ contaId: 'conta-a', notificationId: 'notice-1' });
  });

  it('leaves durable retry ownership in place and logs processing failures', async () => {
    processQueue.mockRejectedValue(new Error('queue failed'));

    await processAsaasWebhookPostResponse({ contaId: 'conta-a', webhookId: 'webhook-a', requestId: 'request-a' });

    expect(findNotifications).not.toHaveBeenCalled();
    expect(dispatchNotification).not.toHaveBeenCalled();
    expect(logApiOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'api.webhook.post_response_drain.failed', requestId: 'request-a',
    }));
  });
});
