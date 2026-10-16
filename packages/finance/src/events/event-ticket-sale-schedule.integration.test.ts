import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@alusa/database';
import { markTicketSalePaid } from './event-financial-operations';
import { createTicketSale } from './event-ticket-sale-operations';

const rejectedSimpleSaleLotCases: Array<{
  label: string;
  status: 'ACTIVE' | 'CLOSED';
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  expectedCode: 'VENDA_FORA_DO_PERIODO' | 'LOTE_INATIVO';
}> = [
  { label: 'before the sale starts', status: 'ACTIVE', saleStartsAt: new Date(Date.now() + 3_600_000), saleEndsAt: null, expectedCode: 'VENDA_FORA_DO_PERIODO' },
  { label: 'after the sale ends', status: 'ACTIVE', saleStartsAt: null, saleEndsAt: new Date(Date.now() - 3_600_000), expectedCode: 'VENDA_FORA_DO_PERIODO' },
  { label: 'with an inactive lot', status: 'CLOSED', saleStartsAt: null, saleEndsAt: null, expectedCode: 'LOTE_INATIVO' },
];

describe('ticket sale schedule (database)', () => {
  afterAll(async () => prisma.$disconnect());

  it.each(rejectedSimpleSaleLotCases)('rejects a simple ticket sale $label without creating sale or financial entry', async ({ status, saleStartsAt, saleEndsAt, expectedCode }) => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Simple ticket sale ${suffix}` } });
    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id, nome: 'Ticket sale test', email: `ticket-sale-${suffix}@test.invalid`, senhaHash: 'integration-test',
      } });
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id, name: `Event ${suffix}`, type: 'OTHER', status: 'ACTIVE', ticketMode: 'SIMPLE', hasTickets: true,
        startsAt: new Date('2026-11-15T00:00:00.000Z'),
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId: conta.id, eventId: event.id, name: `Lot ${suffix}`, ticketType: 'FULL', unitPrice: 10, quantityTotal: 10,
        status, saleStartsAt, saleEndsAt,
      } });

      await expect(createTicketSale({ contaId: conta.id, userId: user.id }, {
        eventId: event.id, lotId: lot.id, buyerName: 'Buyer', quantity: 1, paymentMethod: 'CASH',
      })).rejects.toMatchObject({ code: expectedCode, status: 409 });
      expect(await prisma.eventTicketSale.count({ where: { contaId: conta.id, lotId: lot.id } })).toBe(0);
      expect(await prisma.eventFinancialEntry.count({ where: { contaId: conta.id, eventId: event.id, originType: 'TICKET_SALE' } })).toBe(0);
    } finally {
      await prisma.conta.delete({ where: { id: conta.id } });
    }
  }, 30_000);

  it('creates a sale and financial entry while the lot sale window is open', async () => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Simple ticket sale ${suffix}` } });
    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id, nome: 'Ticket sale test', email: `ticket-sale-${suffix}@test.invalid`, senhaHash: 'integration-test',
      } });
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id, name: `Event ${suffix}`, type: 'OTHER', status: 'ACTIVE', ticketMode: 'SIMPLE', hasTickets: true,
        startsAt: new Date('2026-11-15T00:00:00.000Z'),
      } });
      const lot = await prisma.eventTicketLot.create({ data: {
        contaId: conta.id, eventId: event.id, name: `Lot ${suffix}`, ticketType: 'FULL', unitPrice: 10, quantityTotal: 10, status: 'ACTIVE',
        saleStartsAt: new Date(Date.now() - 3_600_000), saleEndsAt: new Date(Date.now() + 3_600_000),
      } });

      const sale = await createTicketSale({ contaId: conta.id, userId: user.id }, {
        eventId: event.id, lotId: lot.id, buyerName: 'Buyer', quantity: 1, paymentMethod: 'CASH', status: 'PENDING',
      });
      expect(sale).toMatchObject({ id: expect.any(String), status: 'PENDING' });
      expect(await prisma.eventTicketSale.count({ where: { contaId: conta.id, lotId: lot.id } })).toBe(1);
      expect(await prisma.eventFinancialEntry.count({ where: { contaId: conta.id, eventId: event.id, originType: 'TICKET_SALE' } })).toBe(1);
    } finally {
      await prisma.conta.delete({ where: { id: conta.id } });
    }
  }, 30_000);

  it.each([
    {
      label: 'explicit local schedule',
      snapshot: { startsAt: '2026-11-15T00:00:00.000Z', startsAtLocal: '2026-11-14T20:00' },
      expectedStartsAt: '2026-11-14T20:00:00.000Z',
      expectedStartsAtLocal: '2026-11-14T20:00',
    },
    {
      label: 'legacy snapshot UTC schedule',
      snapshot: { startsAt: '2026-11-14T20:00:00.000Z' },
      expectedStartsAt: '2026-11-14T20:00:00.000Z',
      expectedStartsAtLocal: null,
    },
  ])('uses the pinned $label when a pending seated sale is marked paid', async (schedule) => {
    const suffix = randomUUID();
    const conta = await prisma.conta.create({ data: { nome: `Ticket schedule ${suffix}` } });
    try {
      const user = await prisma.usuario.create({ data: {
        contaId: conta.id, nome: 'Ticket schedule test', email: `ticket-schedule-${suffix}@test.invalid`, senhaHash: 'integration-test',
      } });
      const pinnedStartsAtLocal = schedule.expectedStartsAtLocal;
      const event = await prisma.schoolEvent.create({ data: {
        contaId: conta.id, name: `Event ${suffix}`, type: 'OTHER', status: 'ACTIVE',
        startsAt: new Date('2026-11-15T00:00:00.000Z'),
      } });
      const map = await prisma.eventMap.create({ data: {
        contaId: conta.id, eventId: event.id, name: `Map ${suffix}`, startsAt: new Date('2026-11-15T00:00:00.000Z'), startsAtLocal: pinnedStartsAtLocal,
      } });
      const version = await prisma.eventMapVersion.create({ data: {
        contaId: conta.id, eventMapId: map.id, version: 1, status: 'PUBLISHED',
        snapshot: schedule.snapshot,
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
      await prisma.eventMap.update({ where: { id: map.id }, data: { startsAtLocal: '2026-11-14T21:00', startsAt: new Date('2026-11-15T01:00:00.000Z') } });
      await markTicketSalePaid({ contaId: conta.id, userId: user.id }, sale.id);

      const outbox = await prisma.financeWebhookSideEffectOutbox.findFirst({
        where: { contaId: conta.id, effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL', dedupeKey: { contains: sale.id } },
      });
      expect(outbox?.payload).toMatchObject({ eventStartsAt: schedule.expectedStartsAt, eventStartsAtLocal: pinnedStartsAtLocal });
    } finally {
      await prisma.conta.delete({ where: { id: conta.id } });
    }
  }, 30_000);
});
