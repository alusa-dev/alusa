import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../prisma';
import { preparePublicEventMapCheckout } from './public-event-map-checkout-persistence';
import { getPublicEventMap, listEventMaps, reservePublicEventMapSeats } from './event-map.service';
import { getPublicEventMapOrderStatus } from './public-event-map-order-status.service';
import { createSeatedTicketSale, getPublicStaffSaleTickets, reserveStaffEventMapSeats } from './staff-map-sales.service';

const validLocal = '2026-11-14T20:00';
const ctx = (contaId: string, userId: string) => ({ contaId, userId });

async function createFixture(options: { startsAtLocal?: string; seatStatus?: 'AVAILABLE' | 'HELD'; lot?: boolean } = {}) {
  const tag = randomUUID();
  const conta = await prisma.conta.create({ data: { nome: `Ticket schedule ${tag}` } });
  const user = await prisma.usuario.create({
    data: { contaId: conta.id, nome: 'Schedule User', email: `schedule-${tag}@example.test`, senhaHash: 'integration-test', role: 'ADMIN', status: 'ATIVO' },
  });
  const event = await prisma.schoolEvent.create({
    data: {
      contaId: conta.id,
      name: `Ticket schedule ${tag}`,
      type: 'CULTURAL_SHOW',
      status: 'ACTIVE',
      startsAt: new Date('2026-11-15T00:00:00.000Z'),
      ticketMode: 'NUMBERED_SEATS',
      hasTickets: true,
    },
  });
  const map = await prisma.eventMap.create({
    data: {
      contaId: conta.id,
      eventId: event.id,
      name: 'Sessão noite',
      startsAt: new Date('2026-11-15T00:00:00.000Z'),
      startsAtLocal: options.startsAtLocal ?? null,
      status: 'PUBLISHED',
      publicSlug: `schedule-${tag}`,
      publicEnabled: true,
    },
  });
  const version = await prisma.eventMapVersion.create({
    data: {
      contaId: conta.id,
      eventMapId: map.id,
      version: 1,
      status: 'PUBLISHED',
      snapshot: {
        name: map.name,
        startsAt: options.startsAtLocal ? `${options.startsAtLocal}:00.000Z` : '2026-11-15T00:00:00.000Z',
        ...(options.startsAtLocal ? { startsAtLocal: options.startsAtLocal } : {}),
      },
    },
  });
  await prisma.eventMap.update({ where: { id: map.id }, data: { publishedVersionId: version.id } });
  const lot = options.lot ? await prisma.eventTicketLot.create({
    data: {
      contaId: conta.id,
      eventId: event.id,
      eventMapId: map.id,
      name: 'Inteira',
      ticketType: 'FULL',
      unitPrice: 20,
      quantityTotal: 10,
      status: 'ACTIVE',
    },
  }) : null;
  const seat = await prisma.eventMapPublicSeat.create({
    data: {
      contaId: conta.id,
      eventId: event.id,
      eventMapId: map.id,
      versionId: version.id,
      originalSeatId: `original-${tag}`,
      sectionName: 'Pista',
      lotId: lot?.id ?? null,
      lotName: lot?.name ?? null,
      unitPrice: 20,
      technicalCode: `A-${tag}`,
      displayLabel: 'A1',
      status: options.seatStatus ?? 'AVAILABLE',
      x: 10,
      y: 10,
    },
  });
  return { conta, user, event, map, version, seat, lot };
}

async function createReservation(fixture: Awaited<ReturnType<typeof createFixture>>, source: 'PUBLIC_CHECKOUT' | 'STAFF_MANUAL') {
  const reservation = await prisma.eventMapReservation.create({
    data: {
      contaId: fixture.conta.id,
      eventId: fixture.event.id,
      eventMapId: fixture.map.id,
      versionId: fixture.version.id,
      holdToken: `${source}-${randomUUID()}`,
      source,
      status: 'HELD',
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  await prisma.eventMapReservationSeat.create({
    data: { contaId: fixture.conta.id, reservationId: reservation.id, publicSeatId: fixture.seat.id },
  });
  return reservation;
}

const checkoutInput = (reservation: { id: string; holdToken: string }) => ({
  reservationId: reservation.id,
  holdToken: reservation.holdToken,
  buyerName: 'Comprador Teste',
  buyerEmail: 'ticket@example.test',
  buyerDocument: '52998224725',
  buyerPhone: '11987654321',
  paymentMethod: 'PIX' as const,
  whatsappConsent: false,
});

describe('event map purchase schedule snapshots', () => {
  it('returns a timezone-independent local schedule for a legacy public map snapshot', async () => {
    const fixture = await createFixture();
    try {
      const publicMap = await getPublicEventMap(fixture.map.publicSlug!);
      expect(publicMap.event).toMatchObject({
        startsAt: '2026-11-15T00:00:00.000Z',
        startsAtLocal: '2026-11-15T00:00',
      });
      expect(await prisma.eventMapVersion.findUniqueOrThrow({ where: { id: fixture.version.id } })).toMatchObject({
        snapshot: { startsAt: '2026-11-15T00:00:00.000Z' },
      });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('allows public holds for a legacy version using its UTC schedule as an automatic fallback', async () => {
    const fixture = await createFixture();
    try {
      await expect(reservePublicEventMapSeats(fixture.map.publicSlug!, { seatIds: [fixture.seat.id] }))
        .resolves.toMatchObject({ reservationId: expect.any(String) });
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
      expect(await prisma.eventMapReservation.count({ where: { contaId: fixture.conta.id } })).toBe(1);
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('allows checkout on a legacy version and snapshots its automatic fallback', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .resolves.toMatchObject({ publishedMapSchedule: { startsAtLocal: '2026-11-15T00:00' } });
      expect(await prisma.eventMapOrder.count({ where: { contaId: fixture.conta.id } })).toBe(1);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('allows a pending legacy order retry without requiring new schedule metadata', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      const order = await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id,
          eventId: fixture.event.id,
          eventMapId: fixture.map.id,
          versionId: fixture.version.id,
          reservationId: reservation.id,
          buyerName: 'Comprador Teste',
          buyerEmail: 'ticket@example.test',
          buyerDocument: '52998224725',
          buyerPhone: '11987654321',
          totalAmount: 20,
          status: 'PAYMENT_PENDING',
          paymentMethod: 'PIX',
          accessToken: `order-${randomUUID()}`,
        },
      });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .resolves.toMatchObject({ order: { id: order.id } });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('allows staff reservation and sale for a legacy schedule using its UTC fallback', async () => {
    const fixture = await createFixture({ lot: true });
    try {
      const held = await reserveStaffEventMapSeats(ctx(fixture.conta.id, fixture.user.id), fixture.event.id, fixture.map.id, { seatIds: [fixture.seat.id] });
      expect(held.reservationId).toBeTruthy();
      expect(await prisma.eventMapReservation.count({ where: { contaId: fixture.conta.id } })).toBe(1);

      const sale = await createSeatedTicketSale(ctx(fixture.conta.id, fixture.user.id), {
        eventId: fixture.event.id,
        buyerName: 'Comprador Teste',
        paymentMethod: 'COMPLIMENTARY',
        status: 'COMPLIMENTARY',
        holdToken: held.holdToken,
      });
      expect(sale.primarySaleId).toBeTruthy();
      expect(await prisma.eventTicketSale.count({ where: { contaId: fixture.conta.id } })).toBe(1);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('SOLD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('does not allow another tenant to consume a staff hold or alter its tickets', async () => {
    const tenantA = await createFixture({ startsAtLocal: validLocal });
    const tenantB = await createFixture({ startsAtLocal: validLocal, seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(tenantB, 'STAFF_MANUAL');
      const beforeReservation = await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      const beforeSeat = await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } });
      const beforeFinancialEntries = await prisma.eventFinancialEntry.count({ where: { contaId: tenantB.conta.id, eventId: tenantB.event.id } });

      await expect(createSeatedTicketSale(ctx(tenantA.conta.id, tenantA.user.id), {
        eventId: tenantB.event.id,
        buyerName: 'Comprador Teste',
        paymentMethod: 'COMPLIMENTARY',
        status: 'COMPLIMENTARY',
        holdToken: reservation.holdToken,
      })).rejects.toMatchObject({ code: 'RESERVA_INVALIDA', status: 409 });

      expect(await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({ status: beforeReservation.status, consumedAt: null });
      expect(await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } })).toMatchObject({ status: beforeSeat.status });
      expect(await prisma.eventTicketSale.count({ where: { contaId: tenantB.conta.id } })).toBe(0);
      expect(await prisma.eventFinancialEntry.count({ where: { contaId: tenantB.conta.id, eventId: tenantB.event.id } })).toBe(beforeFinancialEntries);
    } finally {
      await prisma.conta.deleteMany({ where: { id: tenantA.conta.id } });
      await prisma.conta.deleteMany({ where: { id: tenantB.conta.id } });
    }
  });

  it('prints a staff ticket from its version snapshot after the live map time changes', async () => {
    const fixture = await createFixture({ startsAtLocal: validLocal, seatStatus: 'HELD', lot: true });
    try {
      const reservation = await createReservation(fixture, 'STAFF_MANUAL');
      const sale = await createSeatedTicketSale(ctx(fixture.conta.id, fixture.user.id), {
        eventId: fixture.event.id,
        buyerName: 'Comprador Teste',
        buyerEmail: 'ticket@example.test',
        paymentMethod: 'COMPLIMENTARY',
        status: 'COMPLIMENTARY',
        holdToken: reservation.holdToken,
      });
      const persistedSale = await prisma.eventTicketSale.findFirstOrThrow({ where: { id: sale.primarySaleId, contaId: fixture.conta.id } });
      const ticketEmail = await prisma.financeWebhookSideEffectOutbox.findFirstOrThrow({
        where: { contaId: fixture.conta.id, effectType: 'EVENT_PUBLIC_ORDER_TICKET_EMAIL' },
      });
      expect(ticketEmail.payload).toMatchObject({
        eventStartsAt: '2026-11-14T20:00:00.000Z',
        eventStartsAtLocal: validLocal,
      });
      await prisma.eventMap.update({ where: { id: fixture.map.id }, data: { startsAtLocal: '2026-11-14T21:00', startsAt: new Date('2026-11-15T01:00:00.000Z') } });

      const tickets = await getPublicStaffSaleTickets(persistedSale.id, persistedSale.accessToken!);
      expect(tickets.event.startsAtLocal).toBe(validLocal);
      expect(tickets.event.startsAt).toBe('2026-11-14T20:00:00.000Z');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('returns a published session schedule for staff selectors after the draft map time changes', async () => {
    const fixture = await createFixture({ startsAtLocal: validLocal });
    try {
      await prisma.eventMap.update({
        where: { id: fixture.map.id },
        data: { startsAtLocal: '2026-11-14T21:00', startsAt: new Date('2026-11-15T01:00:00.000Z') },
      });

      const maps = await listEventMaps({ contaId: fixture.conta.id }, fixture.event.id);
      expect(maps.find(({ id }) => id === fixture.map.id)?.publishedSchedule).toEqual({
        startsAt: '2026-11-14T20:00:00.000Z',
        startsAtLocal: validLocal,
      });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('keeps public order status on its pinned version schedule after live map edits', async () => {
    const fixture = await createFixture({ startsAtLocal: validLocal });
    const accessToken = `order-${randomUUID()}`;
    try {
      const order = await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id,
          eventId: fixture.event.id,
          eventMapId: fixture.map.id,
          versionId: fixture.version.id,
          buyerName: 'Comprador Teste',
          buyerEmail: 'ticket@example.test',
          totalAmount: 20,
          paymentMethod: 'PIX',
          accessToken,
        },
      });
      await prisma.eventMap.update({
        where: { id: fixture.map.id },
        data: { startsAtLocal: '2026-11-14T21:00', startsAt: new Date('2026-11-15T01:00:00.000Z') },
      });
      await prisma.schoolEvent.update({ where: { id: fixture.event.id }, data: { startsAt: new Date('2026-11-15T01:00:00.000Z') } });

      const status = await getPublicEventMapOrderStatus(order.id, accessToken);
      expect(status.event.startsAt).toBe('2026-11-14T20:00:00.000Z');
      expect(status.event.startsAtLocal).toBe(validLocal);
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('uses the legacy version UTC schedule before mutable map/event times in public order status', async () => {
    const fixture = await createFixture();
    const accessToken = `order-${randomUUID()}`;
    try {
      await prisma.eventMapVersion.update({
        where: { id: fixture.version.id },
        data: { snapshot: { startsAt: '2026-11-14T20:00:00.000Z' } },
      });
      const order = await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id,
          eventId: fixture.event.id,
          eventMapId: fixture.map.id,
          versionId: fixture.version.id,
          buyerName: 'Comprador Teste',
          buyerEmail: 'ticket@example.test',
          totalAmount: 20,
          paymentMethod: 'PIX',
          accessToken,
        },
      });
      await prisma.eventMap.update({
        where: { id: fixture.map.id },
        data: { startsAtLocal: '2026-11-14T21:00', startsAt: new Date('2026-11-15T01:00:00.000Z') },
      });
      await prisma.schoolEvent.update({ where: { id: fixture.event.id }, data: { startsAt: new Date('2026-11-15T01:00:00.000Z') } });

      const status = await getPublicEventMapOrderStatus(order.id, accessToken);
      expect(status.event.startsAt).toBe('2026-11-14T20:00:00.000Z');
      expect(status.event.startsAtLocal).toBe('2026-11-14T20:00');
      expect(await prisma.eventMapVersion.findUniqueOrThrow({ where: { id: fixture.version.id } })).toMatchObject({
        snapshot: { startsAt: '2026-11-14T20:00:00.000Z' },
      });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });
});
