import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '@alusa/database';
import { refundPublicEventMapOrderByPayment } from './event-map-payment-transitions';

describe('Event Map cumulative refund serialization (database)', () => {
  it('serializes concurrent cumulative snapshots and leaves the same payment in another tenant untouched', async () => {
    const suffix = randomUUID();
    const contaA = await prisma.conta.create({ data: { nome: `Event refund ${suffix}` } });
    const contaB = await prisma.conta.create({ data: { nome: `Event refund other ${suffix}` } });
    const paymentId = `pay-${suffix}`;

    async function createOrder(contaId: string, label: string) {
      const event = await prisma.schoolEvent.create({ data: {
        contaId, name: `Event ${label} ${suffix}`, type: 'OTHER', status: 'ACTIVE', startsAt: new Date(),
      } });
      const map = await prisma.eventMap.create({ data: { contaId, eventId: event.id, name: `Map ${label}` } });
      const version = await prisma.eventMapVersion.create({ data: {
        contaId, eventMapId: map.id, version: 1, status: 'PUBLISHED', snapshot: {},
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId, eventId: event.id, eventMapId: map.id, name: `Lot ${label}`, ticketType: 'FULL',
        unitPrice: 100, quantityTotal: 1,
      } });
      const order = await prisma.eventMapOrder.create({ data: {
        contaId, eventId: event.id, eventMapId: map.id, versionId: version.id,
        buyerName: `Buyer ${label}`, buyerEmail: `buyer-${label}-${suffix}@test.invalid`,
        totalAmount: 100, status: 'CONFIRMED', paymentStatus: 'RECEIVED',
        asaasPaymentId: paymentId, accessToken: `order-${label}-${suffix}`,
      } });
      const sale = await prisma.eventTicketSale.create({ data: {
        contaId, eventId: event.id, lotId: lot.id, eventMapOrderId: order.id,
        buyerName: `Buyer ${label}`, quantity: 1, unitPriceSnapshot: 100, totalAmount: 100,
        paymentMethod: 'MANUAL_PIX', status: 'PAID', paymentStatus: 'RECEIVED', asaasPaymentId: paymentId,
      } });
      return { order, sale };
    }

    try {
      const [tenantA, tenantB] = await Promise.all([
        createOrder(contaA.id, 'A'),
        createOrder(contaB.id, 'B'),
      ]);
      const [olderSnapshot, newerSnapshot] = await Promise.all([
        refundPublicEventMapOrderByPayment({ contaId: contaA.id, asaasPaymentId: paymentId, refundedAmount: 30, partial: true }),
        refundPublicEventMapOrderByPayment({ contaId: contaA.id, asaasPaymentId: paymentId, refundedAmount: 60, partial: true }),
      ]);

      expect(olderSnapshot?.status).toBe('PARTIALLY_REFUNDED');
      expect(newerSnapshot?.status).toBe('PARTIALLY_REFUNDED');
      const persistedA = await prisma.eventMapOrder.findFirst({ where: { id: tenantA.order.id, contaId: contaA.id } });
      const persistedSaleA = await prisma.eventTicketSale.findFirst({ where: { id: tenantA.sale.id, contaId: contaA.id } });
      const persistedB = await prisma.eventMapOrder.findFirst({ where: { id: tenantB.order.id, contaId: contaB.id } });
      const persistedSaleB = await prisma.eventTicketSale.findFirst({ where: { id: tenantB.sale.id, contaId: contaB.id } });

      expect(persistedA?.refundedAmount.toNumber()).toBe(60);
      expect(persistedSaleA?.refundedAmount.toNumber()).toBe(60);
      expect(persistedB?.refundedAmount.toNumber()).toBe(0);
      expect(persistedSaleB?.refundedAmount.toNumber()).toBe(0);
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [contaA.id, contaB.id] } } });
    }
  }, 30_000);
});
