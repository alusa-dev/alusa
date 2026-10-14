import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBillingWebhookNotification: vi.fn(),
}));

vi.mock('../services/notifications.service', () => ({
  createBillingWebhookNotification: mocks.createBillingWebhookNotification,
  isBillingNotificationEvent: vi.fn(() => true),
}));

const { emitBillingNotificationCandidate } = await import('./emit-billing-notifications');

describe('emit billing notification candidate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('propaga origem inconsistente para a outbox registrar falha auditável', async () => {
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'inconsistent', reason: 'event_order_sale_link_conflict', notificationId: null,
      created: false, recipientCount: 0,
    });

    await expect(emitBillingNotificationCandidate({
      contaId: 'conta-a', event: 'PAYMENT_RECEIVED', asaasPaymentId: 'pay-1',
    }, 'ASAAS_WEBHOOK')).rejects.toThrow('Origem financeira inconsistente: event_order_sale_link_conflict');
  });

  it('considera evento não aplicável concluído pela política', async () => {
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'not_applicable', reason: 'event_ticket_payment', notificationId: null,
      created: false, recipientCount: 0,
    });

    await expect(emitBillingNotificationCandidate({
      contaId: 'conta-a', event: 'PAYMENT_RECEIVED', asaasPaymentId: 'pay-1',
    }, 'ASAAS_WEBHOOK')).resolves.toEqual({ emitted: true });
  });
});
