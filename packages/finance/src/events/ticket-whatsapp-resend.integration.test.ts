import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@alusa/database';
import { requestEventTicketSaleWhatsAppResend } from './event-financial-operations';
import { requestPublicOrderTicketWhatsAppResend } from '@alusa/lib/events/map/event-map.service';

describe('ticket WhatsApp resend serialization (database)', () => {
  afterAll(async () => prisma.$disconnect());

  async function cleanupConta(contaId: string) {
    const connections = await prisma.whatsAppConnection.findMany({
      where: { outboundJobs: { some: { contaId } } }, select: { id: true },
    });
    await prisma.eventTicketWhatsAppNotification.deleteMany({ where: { contaId } });
    await prisma.whatsAppOutboundJob.deleteMany({ where: { contaId } });
    await prisma.whatsAppMessage.deleteMany({ where: { contaId } });
    if (connections.length) await prisma.whatsAppConnection.deleteMany({ where: { id: { in: connections.map(({ id }) => id) } } });
    await prisma.conta.delete({ where: { id: contaId } });
  }

  async function createFixtures() {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Ticket resend ${suffix}` } });
    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id, nome: 'Ticket resend test', email: `ticket-resend-${suffix}@test.invalid`, senhaHash: 'integration-test',
      } });
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id, name: `Event ${suffix}`, type: 'OTHER', status: 'ACTIVE', startsAt: new Date(),
      } });
      const map = await prisma.eventMap.create({ data: { contaId: conta.id, eventId: event.id, name: 'Map' } });
      const version = await prisma.eventMapVersion.create({ data: {
        contaId: conta.id, eventMapId: map.id, version: 1, status: 'PUBLISHED', snapshot: {},
      } });
      const order = await prisma.eventMapOrder.create({ data: {
        contaId: conta.id, eventId: event.id, eventMapId: map.id, versionId: version.id,
        buyerName: 'Buyer', buyerEmail: `buyer-${suffix}@test.invalid`, buyerPhone: '+15555550100',
        whatsappOptInAt: new Date(), whatsappOptInSource: 'CHECKOUT', accessToken: `order_${suffix}`,
        status: 'CONFIRMED', paymentStatus: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED',
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId: conta.id, eventId: event.id, name: 'Lot', ticketType: 'FULL', unitPrice: 10, quantityTotal: 10,
      } });
      const sale = await prisma.eventTicketSale.create({ data: {
        contaId: conta.id, eventId: event.id, lotId: lot.id, buyerName: 'Buyer', buyerPhone: '+15555550100',
        whatsappOptInAt: new Date(), whatsappOptInSource: 'STAFF_SALE', accessToken: `sale_${suffix}`,
        quantity: 1, unitPriceSnapshot: 10, totalAmount: 10, paymentMethod: 'CASH', status: 'PAID',
      } });
      await prisma.eventTicket.createMany({ data: [
        { contaId: conta.id, eventId: event.id, eventMapOrderId: order.id, ticketCode: `order-${suffix}` },
        { contaId: conta.id, eventId: event.id, eventTicketSaleId: sale.id, ticketCode: `sale-${suffix}` },
      ] });
      return { conta, user, event, order, sale };
    } catch (error) {
      await prisma.conta.delete({ where: { id: conta.id } });
      throw error;
    }
  }

  it('serializes concurrent public-order and manual-sale resends into one notification each', async () => {
    const fixtures = await createFixtures();
    try {
      const ctx = { contaId: fixtures.conta.id, userId: fixtures.user.id };
      const [publicResults, saleResults] = await Promise.all([
        Promise.all([
          requestPublicOrderTicketWhatsAppResend(ctx, fixtures.event.id, fixtures.order.id),
          requestPublicOrderTicketWhatsAppResend(ctx, fixtures.event.id, fixtures.order.id),
        ]),
        Promise.all([
          requestEventTicketSaleWhatsAppResend(ctx, fixtures.sale.id),
          requestEventTicketSaleWhatsAppResend(ctx, fixtures.sale.id),
        ]),
      ]);

      for (const [results, purchaseField, purchaseId] of [
        [publicResults, 'eventMapOrderId', fixtures.order.id],
        [saleResults, 'eventTicketSaleId', fixtures.sale.id],
      ] as const) {
        expect(results.filter((result) => result.active)).toHaveLength(1);
        expect(results[0].notificationId).toBe(results[1].notificationId);
        expect(await prisma.eventTicketWhatsAppNotification.count({ where: { contaId: fixtures.conta.id, [purchaseField]: purchaseId } })).toBe(1);
      }
    } finally {
      await cleanupConta(fixtures.conta.id);
    }
  }, 30_000);

  it('keeps a retryable generic job active when its retry date is newer than the notification date', async () => {
    const fixtures = await createFixtures();
    try {
      const connection = await prisma.whatsAppConnection.create({ data: {
        phoneNumberId: `phone-${randomUUID()}`, wabaId: `waba-${randomUUID()}`,
      } });
      const message = await prisma.whatsAppMessage.create({ data: {
        connectionId: connection.id, contaId: fixtures.conta.id, direction: 'OUTBOUND', status: 'FAILED',
        messageType: 'template', payload: {},
      } });
      const retryAt = new Date(Date.now() + 60_000);
      const job = await prisma.whatsAppOutboundJob.create({ data: {
        messageId: message.id, connectionId: connection.id, contaId: fixtures.conta.id,
        idempotencyKey: `retry-${randomUUID()}`, status: 'FAILED', attempts: 1, maxAttempts: 8,
        nextAttemptAt: retryAt, payload: {},
      } });
      const notification = await prisma.eventTicketWhatsAppNotification.create({ data: {
        contaId: fixtures.conta.id, purchaseType: 'PUBLIC_ORDER', eventMapOrderId: fixtures.order.id,
        status: 'FAILED', templateName: 'ticket', recipientPhone: '+15555550100', attempts: 1,
        maxAttempts: 8, nextAttemptAt: new Date(Date.now() - 60_000),
        idempotencyKey: `notification-${randomUUID()}`, whatsappJobId: job.id,
      } });

      const result = await requestPublicOrderTicketWhatsAppResend(
        { contaId: fixtures.conta.id, userId: fixtures.user.id }, fixtures.event.id, fixtures.order.id,
      );
      expect(result).toMatchObject({ active: true, notificationId: notification.id, status: 'FAILED' });
      expect(await prisma.eventTicketWhatsAppNotification.count({ where: { contaId: fixtures.conta.id, eventMapOrderId: fixtures.order.id } })).toBe(1);

      const preparationRetry = await prisma.eventTicketWhatsAppNotification.create({ data: {
        contaId: fixtures.conta.id, purchaseType: 'STAFF_SALE', eventTicketSaleId: fixtures.sale.id,
        status: 'FAILED', templateName: 'ticket', recipientPhone: '+15555550100', attempts: 1,
        maxAttempts: 8, nextAttemptAt: new Date(Date.now() + 60_000),
        idempotencyKey: `preparation-retry-${randomUUID()}`,
      } });
      const saleResult = await requestEventTicketSaleWhatsAppResend(
        { contaId: fixtures.conta.id, userId: fixtures.user.id }, fixtures.sale.id,
      );
      expect(saleResult).toMatchObject({ active: true, notificationId: preparationRetry.id, status: 'FAILED' });
    } finally {
      await cleanupConta(fixtures.conta.id);
    }
  }, 30_000);

  it('finds an older active notification behind a newer terminal delivery failure', async () => {
    const fixtures = await createFixtures();
    try {
      const connection = await prisma.whatsAppConnection.create({ data: {
        phoneNumberId: `phone-${randomUUID()}`, wabaId: `waba-${randomUUID()}`,
      } });
      const message = await prisma.whatsAppMessage.create({ data: {
        connectionId: connection.id, contaId: fixtures.conta.id, direction: 'OUTBOUND', status: 'SENT',
        messageType: 'template', payload: {},
      } });
      const job = await prisma.whatsAppOutboundJob.create({ data: {
        messageId: message.id, connectionId: connection.id, contaId: fixtures.conta.id,
        idempotencyKey: `sent-${randomUUID()}`, status: 'SENT', payload: {},
      } });
      const olderPending = await prisma.eventTicketWhatsAppNotification.create({ data: {
        contaId: fixtures.conta.id, purchaseType: 'PUBLIC_ORDER', eventMapOrderId: fixtures.order.id,
        status: 'PENDING', templateName: 'ticket', recipientPhone: '+15555550100',
        idempotencyKey: `pending-${randomUUID()}`,
      } });
      await prisma.eventTicketWhatsAppNotification.create({ data: {
        contaId: fixtures.conta.id, purchaseType: 'PUBLIC_ORDER', eventMapOrderId: fixtures.order.id,
        status: 'FAILED', templateName: 'ticket', recipientPhone: '+15555550100', attempts: 1,
        idempotencyKey: `delivery-failed-${randomUUID()}`, whatsappJobId: job.id,
      } });

      const result = await requestPublicOrderTicketWhatsAppResend(
        { contaId: fixtures.conta.id, userId: fixtures.user.id }, fixtures.event.id, fixtures.order.id,
      );
      expect(result).toMatchObject({ active: true, notificationId: olderPending.id, status: 'PENDING' });
      expect(await prisma.eventTicketWhatsAppNotification.count({ where: { contaId: fixtures.conta.id, eventMapOrderId: fixtures.order.id } })).toBe(2);
    } finally {
      await cleanupConta(fixtures.conta.id);
    }
  }, 30_000);
});
