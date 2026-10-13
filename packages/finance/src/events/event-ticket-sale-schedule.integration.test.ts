import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@alusa/database';
import { markTicketSalePaid } from './event-financial-operations';

describe('manual seated ticket sale schedule (database)', () => {
  afterAll(async () => prisma.$disconnect());

  it('uses the published version schedule when a pending seated sale is marked paid', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Ticket schedule ${suffix}` } });
    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id, nome: 'Ticket schedule test', email: `ticket-schedule-${suffix}@test.invalid`, senhaHash: 'integration-test',
      } });
      const pinnedStartsAtLocal = '2026-11-14T20:00';
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id, name: `Event ${suffix}`, type: 'OTHER', status: 'ACTIVE',
        startsAt: new Date('2026-11-15T00:00:00.000Z'),
      } });
      const map = await prisma.eventMap.create({ data: {
        contaId: conta.id, eventId: event.id, name: `Map ${suffix}`, startsAtLocal: pinnedStartsAtLocal,
      } });
      const version = await prisma.eventMapVersion.create({ data: {
        contaId: conta.id, eventMapId: map.id, version: 1, status: 'PUBLISHED',
        snapshot: { startsAt: '2026-11-15T00:00:00.000Z', startsAtLocal: pinnedStartsAtLocal },
      } });
      const seat = await prisma.eventMapPublicSeat.create({ data: {
        contaId: conta.id, eventId: event.id, eventMapId: map.id, versionId: version.id,
        originalSeatId: randomUUID(), sectionName: 'Plateia', unitPrice: 10, technicalCode: 'A1',
        displayLabel: 'A1', rowLabel: 'A', seatNumber: '1', status: 'SOLD', x: 0, y: 0,
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId: conta.id, eventId: event.id, name: `Lot ${suffix}`, ticketType: 'FULL', unitPrice: 10, quantityTotal: 10,
      } });
      const sale = await prisma.eventTicketSale.create({ data: {
        contaId: conta.id, eventId: event.id, lotId: lot.id, buyerName: 'Buyer',
        buyerEmail: `buyer-${suffix}@test.invalid`, quantity: 1, unitPriceSnapshot: 10,
        totalAmount: 10, paymentMethod: 'CASH', status: 'PENDING', createdByUserId: user.id,
      } });
      const saleSeat = await prisma.eventTicketSaleSeat.create({ data: {
        contaId: conta.id, saleId: sale.id, publicSeatId: seat.id, unitPriceSnapshot: 10,
        sectionName: 'Plateia', seatLabel: 'A1', technicalCode: 'A1',
      } });
      await prisma.eventTicket.create({ data: {
        contaId: conta.id, eventId: event.id, eventTicketSaleId: sale.id, saleSeatId: saleSeat.id,
        ticketCode: `ticket-${suffix}`,
      } });

      await prisma.schoolEvent.update({ where: { id: event.id }, data: { startsAt: new Date('2026-11-15T01:00:00.000Z') } });
      await prisma.eventMap.update({ where: { id: map.id }, data: { startsAtLocal: '2026-11-14T21:00' } });
      await markTicketSalePaid({ contaId: conta.id, userId: user.id }, sale.id);

      const outbox = await prisma.financeWebhookSideEffectOutbox.findFirst({
        where: { contaId: conta.id, effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL', dedupeKey: { contains: sale.id } },
      });
      expect(outbox?.payload).toMatchObject({ eventStartsAt: '2026-11-14T20:00:00.000Z', eventStartsAtLocal: pinnedStartsAtLocal });
    } finally {
      await prisma.conta.delete({ where: { id: conta.id } });
    }
  }, 30_000);
});
