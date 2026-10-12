import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getWhatsAppRuntimeConfig, assertWhatsAppConfigured, enqueueWhatsAppMessage, prisma } = vi.hoisted(() => ({
  getWhatsAppRuntimeConfig: vi.fn(),
  assertWhatsAppConfigured: vi.fn(),
  enqueueWhatsAppMessage: vi.fn(),
  prisma: {
    eventTicketWhatsAppNotification: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    whatsAppOutboundJob: { findFirst: vi.fn() },
    eventMapOrder: { findFirst: vi.fn() },
    eventTicketSale: { findFirst: vi.fn() },
  },
}));

vi.mock('@/prisma/client', () => ({ prisma }));
vi.mock('@/src/server/whatsapp/config', () => ({ getWhatsAppRuntimeConfig, assertWhatsAppConfigured }));
vi.mock('@/src/server/whatsapp/outbox.service', () => ({ enqueueWhatsAppMessage }));

import { drainEventTicketWhatsAppNotifications } from './event-ticket-whatsapp-outbox.service';

describe('drainEventTicketWhatsAppNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.eventTicketWhatsAppNotification.updateMany.mockResolvedValue({ count: 1 });
  });

  it('does not claim or mutate notifications while WhatsApp is disabled', async () => {
    getWhatsAppRuntimeConfig.mockReturnValue({ enabled: false });

    const result = await drainEventTicketWhatsAppNotifications();

    expect(result).toEqual({ claimed: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0, paused: true });
    expect(assertWhatsAppConfigured).not.toHaveBeenCalled();
  });

  it('queues a confirmed order ticket template with the opaque dynamic-link token', async () => {
    vi.stubEnv('APP_URL', 'https://alusa.app');
    vi.stubEnv('WHATSAPP_EVENT_TICKET_URL_PREFIX', 'https://alusa.app/api/public/event-ticket-links/');
    getWhatsAppRuntimeConfig.mockReturnValue({ enabled: true, phoneNumberId: 'phone-id' });
    prisma.eventTicketWhatsAppNotification.findMany.mockResolvedValue([{ id: 'notification-1', contaId: 'conta-1' }]);
    prisma.eventTicketWhatsAppNotification.findUnique.mockResolvedValue({
      id: 'notification-1',
      contaId: 'conta-1',
      purchaseType: 'PUBLIC_ORDER',
      eventMapOrderId: 'order-1',
      eventTicketSaleId: null,
      status: 'PROCESSING',
      recipientPhone: '5511999999999',
      consentVersion: 'event-ticket-whatsapp-v1',
      consentRecordedAt: new Date(),
      consentSource: 'PUBLIC_CHECKOUT',
      attempts: 1,
      maxAttempts: 8,
      templateName: 'ingresso_emitido',
      languageCode: 'pt_BR',
      correlationId: 'event-ticket:public_order:order-1',
    });
    prisma.eventMapOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      ticketFulfillmentStatus: 'ISSUED',
      buyerName: 'Ana Silva',
      buyerPhone: '5511999999999',
      whatsappOptInAt: new Date(),
      whatsappOptInSource: 'PUBLIC_CHECKOUT',
      accessToken: 'opaque-access-token',
      event: { name: 'Festival' },
      map: { name: 'Sessão 01' },
      items: [{ ticket: { id: 'ticket-1', status: 'VALID' } }],
    });
    enqueueWhatsAppMessage.mockResolvedValue({ jobId: 'job-1' });

    const result = await drainEventTicketWhatsAppNotifications();

    expect(result.queued).toBe(1);
    expect(prisma.eventTicketWhatsAppNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, contaId: true, whatsappJobId: true } }));
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'notification-1', contaId: 'conta-1' }), data: expect.objectContaining({ status: 'PROCESSING' }) }));
    expect(prisma.eventTicketWhatsAppNotification.findUnique).toHaveBeenCalledWith({ where: { id: 'notification-1', contaId: 'conta-1' } });
    expect(prisma.eventMapOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1', contaId: 'conta-1' },
    }));
    expect(enqueueWhatsAppMessage).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
      request: expect.objectContaining({
        kind: 'template',
        templateName: 'ingresso_emitido',
        languageCode: 'pt_BR',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ana Silva' }, { type: 'text', text: 'Festival · Sessão 01' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'opaque-access-token' }] },
        ],
      }),
    }));
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'notification-1', contaId: 'conta-1' }),
      data: expect.objectContaining({ status: 'QUEUED', whatsappJobId: 'job-1' }),
    }));
    vi.unstubAllEnvs();
  });

  it('skips a staff sale after WhatsApp consent is withdrawn', async () => {
    getWhatsAppRuntimeConfig.mockReturnValue({ enabled: true, phoneNumberId: 'phone-id' });
    prisma.eventTicketWhatsAppNotification.findMany.mockResolvedValue([{ id: 'notification-2', contaId: 'conta-a' }]);
    prisma.eventTicketWhatsAppNotification.findUnique.mockResolvedValue({
      id: 'notification-2', contaId: 'conta-a', purchaseType: 'STAFF_SALE',
      eventMapOrderId: null, eventTicketSaleId: 'sale-1', status: 'PROCESSING',
      recipientPhone: '5511999999999', consentVersion: 'event-ticket-whatsapp-v1',
      consentRecordedAt: new Date(), consentSource: 'STAFF_SALE', attempts: 1, maxAttempts: 8,
      templateName: 'ingresso_emitido', languageCode: 'pt_BR', correlationId: 'event-ticket:staff_sale:sale-1',
    });
    prisma.eventTicketSale.findFirst.mockResolvedValue({
      id: 'sale-1', status: 'PAID', buyerName: 'Ana', buyerPhone: '5511999999999',
      whatsappOptInAt: new Date(), whatsappOptInSource: 'STAFF_SALE', whatsappOptOutAt: new Date(),
      accessToken: 'opaque-token', quantity: 1, event: { name: 'Festival' }, saleSeats: [], tickets: [{ id: 'ticket-1' }],
    });

    const result = await drainEventTicketWhatsAppNotifications();

    expect(result).toMatchObject({ claimed: 1, queued: 0, skipped: 1 });
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'notification-2', contaId: 'conta-a' }), data: expect.objectContaining({ status: 'PROCESSING' }) }));
    expect(prisma.eventTicketWhatsAppNotification.findUnique).toHaveBeenCalledWith({ where: { id: 'notification-2', contaId: 'conta-a' } });
    expect(enqueueWhatsAppMessage).not.toHaveBeenCalled();
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'notification-2', contaId: 'conta-a' }),
      data: expect.objectContaining({ status: 'SKIPPED', lastErrorCode: 'RECIPIENT_OR_CONSENT_CHANGED' }),
    }));
  });

  it('retries the seventh failed send instead of moving it to DLQ early', async () => {
    vi.stubEnv('APP_URL', 'https://alusa.app');
    vi.stubEnv('WHATSAPP_EVENT_TICKET_URL_PREFIX', 'https://alusa.app/api/public/event-ticket-links/');
    getWhatsAppRuntimeConfig.mockReturnValue({ enabled: true, phoneNumberId: 'phone-id' });
    prisma.eventTicketWhatsAppNotification.findMany.mockResolvedValue([{ id: 'notification-3', contaId: 'conta-a' }]);
    prisma.eventTicketWhatsAppNotification.findUnique.mockResolvedValue({
      id: 'notification-3', contaId: 'conta-a', purchaseType: 'PUBLIC_ORDER',
      eventMapOrderId: 'order-3', eventTicketSaleId: null, status: 'PROCESSING',
      recipientPhone: '5511999999999', consentVersion: 'event-ticket-whatsapp-v1',
      consentRecordedAt: new Date(), consentSource: 'PUBLIC_CHECKOUT', attempts: 7, maxAttempts: 8,
      templateName: 'ingresso_emitido', languageCode: 'pt_BR', correlationId: 'event-ticket:public_order:order-3',
    });
    prisma.eventMapOrder.findFirst.mockResolvedValue({
      id: 'order-3', status: 'CONFIRMED', paymentStatus: 'PAID', ticketFulfillmentStatus: 'ISSUED',
      buyerName: 'Ana Silva', buyerPhone: '5511999999999', whatsappOptInAt: new Date(),
      whatsappOptInSource: 'PUBLIC_CHECKOUT', whatsappOptOutAt: null, accessToken: 'opaque-access-token',
      event: { name: 'Festival' }, map: { name: 'Sessão 01' }, items: [{ ticket: { id: 'ticket-3', status: 'VALID' } }],
    });
    enqueueWhatsAppMessage.mockRejectedValue(new Error('temporary provider failure'));

    const result = await drainEventTicketWhatsAppNotifications();

    expect(result).toMatchObject({ claimed: 1, retried: 1, deadLettered: 0 });
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    vi.unstubAllEnvs();
  });

  it('does not requeue a definitive delivery failure onto its already-sent job', async () => {
    getWhatsAppRuntimeConfig.mockReturnValue({ enabled: true, phoneNumberId: 'phone-id' });
    prisma.eventTicketWhatsAppNotification.findMany.mockResolvedValue([
      { id: 'notification-delivery-failed', contaId: 'conta-a', whatsappJobId: 'job-already-sent' },
    ]);
    prisma.whatsAppOutboundJob.findFirst.mockResolvedValue({ status: 'SENT' });

    const result = await drainEventTicketWhatsAppNotifications();

    expect(result).toMatchObject({ claimed: 0, queued: 0 });
    expect(prisma.whatsAppOutboundJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-already-sent', contaId: 'conta-a' },
    }));
    expect(prisma.eventTicketWhatsAppNotification.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.eventTicketWhatsAppNotification.findUnique).not.toHaveBeenCalled();
    expect(enqueueWhatsAppMessage).not.toHaveBeenCalled();
  });
});
