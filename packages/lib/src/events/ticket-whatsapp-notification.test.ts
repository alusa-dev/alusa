import { EventTicketWhatsAppPurchaseType, Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { enqueueEventTicketWhatsAppNotification } from './ticket-whatsapp-notification';

describe('enqueueEventTicketWhatsAppNotification', () => {
  it('creates an idempotent public-order notification and stores consent evidence', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { eventTicketWhatsAppNotification: { createMany } } as unknown as Prisma.TransactionClient;
    const consentRecordedAt = new Date('2026-10-10T12:00:00.000Z');

    const result = await enqueueEventTicketWhatsAppNotification(tx, {
      contaId: 'conta-1',
      purchaseType: EventTicketWhatsAppPurchaseType.PUBLIC_ORDER,
      purchaseId: 'order-1',
      recipientPhone: '5511999999999',
      consentVersion: 'event-ticket-whatsapp-v1',
      consentSource: 'PUBLIC_CHECKOUT',
      consentRecordedAt,
    });

    expect(result).toEqual({
      queued: true,
      idempotencyKey: 'event-ticket-whatsapp:conta-1:PUBLIC_ORDER:order-1:initial',
    });
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: expect.objectContaining({
        contaId: 'conta-1',
        eventMapOrderId: 'order-1',
        recipientPhone: '5511999999999',
        consentVersion: 'event-ticket-whatsapp-v1',
        consentSource: 'PUBLIC_CHECKOUT',
        consentRecordedAt,
      }),
    }));
  });

  it('does not report a duplicate initial notification as newly queued', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const tx = { eventTicketWhatsAppNotification: { createMany } } as unknown as Prisma.TransactionClient;

    const result = await enqueueEventTicketWhatsAppNotification(tx, {
      contaId: 'conta-1',
      purchaseType: EventTicketWhatsAppPurchaseType.STAFF_SALE,
      purchaseId: 'sale-1',
      recipientPhone: '5511999999999',
    });

    expect(result.queued).toBe(false);
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventTicketSaleId: 'sale-1' }),
    }));
  });

  it('uses the same initial idempotency key on repeated enqueue attempts', async () => {
    const createMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = { eventTicketWhatsAppNotification: { createMany } } as unknown as Prisma.TransactionClient;
    const input = {
      contaId: 'conta-a',
      purchaseType: EventTicketWhatsAppPurchaseType.STAFF_SALE,
      purchaseId: 'sale-1',
      recipientPhone: '5511999999999',
      consentVersion: 'event-ticket-whatsapp-v1',
      consentSource: 'STAFF_SALE',
    };

    const first = await enqueueEventTicketWhatsAppNotification(tx, input);
    const retry = await enqueueEventTicketWhatsAppNotification(tx, input);

    expect(first).toEqual({ queued: true, idempotencyKey: 'event-ticket-whatsapp:conta-a:STAFF_SALE:sale-1:initial' });
    expect(retry).toEqual({ queued: false, idempotencyKey: first.idempotencyKey });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0].data.idempotencyKey).toBe(createMany.mock.calls[1][0].data.idempotencyKey);
  });
});
