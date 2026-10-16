import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBillingWebhookNotification: vi.fn(),
}));

vi.mock('../services/notifications.service', () => ({
  createBillingWebhookNotification: mocks.createBillingWebhookNotification,
  isBillingNotificationEvent: vi.fn(() => true),
}));

const {
  emitBillingNotificationCandidate,
  selectFirstBillingNotificationOccurredAt,
} = await import('./emit-billing-notifications');

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

  it('usa o primeiro timestamp parseável sem tratar data civil isolada como instante', async () => {
    mocks.createBillingWebhookNotification.mockResolvedValue({
      outcome: 'not_applicable', reason: 'event_ticket_payment', notificationId: null,
      created: false, recipientCount: 0,
    });

    expect(selectFirstBillingNotificationOccurredAt([
      'not-a-date',
      '2026-03-27',
      '2026-03-28 10:30:00',
      '2026-03-29T12:00:00Z',
    ])).toEqual(new Date('2026-03-28T13:30:00.000Z'));
  });
});
