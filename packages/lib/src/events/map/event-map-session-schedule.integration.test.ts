import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../prisma';
import { preparePublicEventMapCheckout } from './public-event-map-checkout-persistence';
import { getPublicEventMap, listEventMaps, reservePublicEventMapSeats } from './event-map.service';
import { getPublicEventMapOrderStatus } from './public-event-map-order-status.service';
import { createSeatedTicketSale, getPublicStaffSaleTickets, getStaffEventMapSalesView, reserveStaffEventMapSeats } from './staff-map-sales.service';
import { updateTicketLot } from '../events.service';
import { cancelPublicEventMapOrder } from './event-map-order-operations';

const validLocal = '2026-11-14T20:00';
const ctx = (contaId: string, userId: string) => ({ contaId, userId });

async function createFixture(options: {
  startsAtLocal?: string;
  seatStatus?: 'AVAILABLE' | 'HELD';
  lot?: boolean;
  lotStatus?: 'ACTIVE' | 'CLOSED';
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
} = {}) {
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
      status: options.lotStatus ?? 'ACTIVE',
      saleStartsAt: options.saleStartsAt ?? null,
      saleEndsAt: options.saleEndsAt ?? null,
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
  it('keeps public and staff DTOs intact with narrow Prisma seat projections', async () => {
    const fixture = await createFixture({ lot: true });
    try {
      await prisma.eventMapPublicSeat.create({
        data: {
          contaId: fixture.conta.id,
          eventId: fixture.event.id,
          eventMapId: fixture.map.id,
          versionId: fixture.version.id,
          originalSeatId: `hidden-${randomUUID()}`,
          sectionName: 'Pista',
          lotId: fixture.lot?.id,
          lotName: fixture.lot?.name,
          unitPrice: 20,
          technicalCode: `H-${randomUUID()}`,
          displayLabel: 'A2',
          status: 'AVAILABLE',
          publicVisible: false,
          x: 20,
          y: 10,
        },
      });

      const publicView = await getPublicEventMap(fixture.map.publicSlug!);
      expect(publicView).toMatchObject({
        publicSlug: fixture.map.publicSlug,
        mapId: fixture.map.id,
        versionId: fixture.version.id,
        version: fixture.version.version,
        name: fixture.map.name,
        event: { id: fixture.event.id, name: fixture.event.name, status: fixture.event.status },
        counts: { seats: 1, availableSeats: 1, soldSeats: 0, heldSeats: 0 },
      });
      expect(publicView.seats).toEqual([expect.objectContaining({
        id: fixture.seat.id,
        originalSeatId: fixture.seat.originalSeatId,
        status: 'AVAILABLE',
        publicVisible: true,
        technicalCode: fixture.seat.technicalCode,
        displayLabel: fixture.seat.displayLabel,
        unitPrice: 20,
        x: 10,
        y: 10,
      })]);

      const staffView = await getStaffEventMapSalesView(ctx(fixture.conta.id, fixture.user.id), fixture.event.id, fixture.map.id);
      expect(staffView).toMatchObject({
        mapId: fixture.map.id,
        versionId: fixture.version.id,
        version: fixture.version.version,
        name: fixture.map.name,
        event: { id: fixture.event.id, name: fixture.event.name, status: fixture.event.status, ticketMode: fixture.event.ticketMode },
        counts: { seats: 2, availableSeats: 2, soldSeats: 0, heldSeats: 0 },
      });
      expect(staffView.seats).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: fixture.seat.id, publicVisible: true, isOwnHold: false }),
        expect.objectContaining({ displayLabel: 'A2', publicVisible: false, isOwnHold: false }),
      ]));
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

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

  it.each([
    ['before the lot sale starts', { saleStartsAt: new Date(Date.now() + 3_600_000) }, 'VENDA_FORA_DO_PERIODO'],
    ['during the lot sale window', { saleStartsAt: new Date(Date.now() - 3_600_000), saleEndsAt: new Date(Date.now() + 3_600_000) }, null],
    ['after the lot sale ends', { saleEndsAt: new Date(Date.now() - 3_600_000) }, 'VENDA_FORA_DO_PERIODO'],
    ['when the lot is inactive', { lotStatus: 'CLOSED' as const }, 'LOTE_INATIVO'],
  ])('applies the lot sale window to public seat holds %s', async (_label, lotOptions, expectedCode) => {
    const fixture = await createFixture({ lot: true, ...lotOptions });
    try {
      const attempt = reservePublicEventMapSeats(fixture.map.publicSlug!, { seatIds: [fixture.seat.id] });
      if (expectedCode) {
        await expect(attempt).rejects.toMatchObject({ code: expectedCode, status: 409 });
        expect(await prisma.eventMapReservation.count({ where: { contaId: fixture.conta.id } })).toBe(0);
        expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('AVAILABLE');
      } else {
        await expect(attempt).resolves.toMatchObject({ reservationId: expect.any(String) });
      }
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('reuses an existing public reservation idempotently after its lot closes', async () => {
    const fixture = await createFixture({
      lot: true,
      saleStartsAt: new Date(Date.now() - 3_600_000),
      saleEndsAt: new Date(Date.now() + 3_600_000),
    });
    const checkoutKey = `checkout-${randomUUID()}`;
    try {
      const initial = await reservePublicEventMapSeats(fixture.map.publicSlug!, { seatIds: [fixture.seat.id], checkoutKey });
      await updateTicketLot(ctx(fixture.conta.id, fixture.user.id), fixture.lot!.id, {
        status: 'CLOSED', saleEndsAt: new Date(Date.now() - 60_000),
      });
      await expect(reservePublicEventMapSeats(fixture.map.publicSlug!, { seatIds: [fixture.seat.id], checkoutKey }))
        .resolves.toMatchObject({ reservationId: initial.reservationId, holdToken: initial.holdToken });
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

  it('rejects buyer identity changes on an existing order before a payment claim exists', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id,
          eventId: fixture.event.id,
          eventMapId: fixture.map.id,
          versionId: fixture.version.id,
          reservationId: reservation.id,
          buyerName: 'Comprador Teste',
          buyerEmail: 'persisted@example.test',
          buyerDocument: '52998224725',
          buyerPhone: '11987654321',
          totalAmount: 20,
          status: 'PAYMENT_PENDING',
          paymentMethod: 'PIX',
          paymentStatus: null,
          expiresAt: reservation.expiresAt,
          accessToken: `order-${randomUUID()}`,
        },
      });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'IDENTIDADE_DO_COMPRADOR_FIXA', status: 409 });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('records and audits explicit WhatsApp consent changes on retries', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await preparePublicEventMapCheckout(fixture.map.publicSlug!, {
        ...checkoutInput(reservation), whatsappConsent: true,
      });
      const order = await prisma.eventMapOrder.findFirstOrThrow({ where: { contaId: fixture.conta.id } });
      expect(order.whatsappOptInAt).toBeInstanceOf(Date);
      expect(order.whatsappOptInSource).toBe('PUBLIC_CHECKOUT');

      await preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation));
      const retried = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: order.id, contaId: fixture.conta.id } });
      expect(retried.whatsappOptInAt).toEqual(order.whatsappOptInAt);
      expect(retried.whatsappOptInSource).toBe('PUBLIC_CHECKOUT');
      expect(retried.whatsappOptOutAt).toBeInstanceOf(Date);
      expect(retried.whatsappOptOutSource).toBe('PUBLIC_CHECKOUT');
      expect(await prisma.auditLog.count({ where: {
        contaId: fixture.conta.id,
        entityType: 'EventMapOrder',
        entityId: order.id,
        action: 'events.map.public.checkout.whatsapp_consent_revoked',
      } })).toBe(1);

      await preparePublicEventMapCheckout(fixture.map.publicSlug!, {
        ...checkoutInput(reservation), whatsappConsent: true,
      });
      const renewed = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: order.id, contaId: fixture.conta.id } });
      expect(renewed.whatsappOptInAt!.getTime()).toBeGreaterThan(order.whatsappOptInAt!.getTime());
      expect(renewed.whatsappOptOutAt).toBeNull();
      expect(renewed.whatsappOptOutSource).toBeNull();
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('fails closed when a reservation relation points to an order owned by another tenant', async () => {
    const fixtureA = await createFixture({ seatStatus: 'HELD' });
    const fixtureB = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservationA = await createReservation(fixtureA, 'PUBLIC_CHECKOUT');
      const expiresAt = new Date('2026-11-20T12:00:00.000Z');
      const orderB = await prisma.eventMapOrder.create({
        data: {
          contaId: fixtureB.conta.id,
          eventId: fixtureB.event.id,
          eventMapId: fixtureB.map.id,
          versionId: fixtureB.version.id,
          reservationId: reservationA.id,
          buyerName: 'Outro tenant',
          buyerEmail: 'other-tenant@example.test',
          buyerDocument: '12345678901',
          buyerPhone: '11999999999',
          totalAmount: 20,
          status: 'PAYMENT_PENDING',
          paymentMethod: 'PIX',
          expiresAt,
          accessToken: `order-${randomUUID()}`,
        },
      });
      const auditCountBefore = await prisma.auditLog.count({ where: { contaId: fixtureA.conta.id } });

      await expect(preparePublicEventMapCheckout(fixtureA.map.publicSlug!, checkoutInput(reservationA)))
        .rejects.toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO', status: 404 });

      const [persistedOrder, persistedReservation, auditCountAfter] = await Promise.all([
        prisma.eventMapOrder.findFirstOrThrow({ where: { id: orderB.id, contaId: fixtureB.conta.id } }),
        prisma.eventMapReservation.findFirstOrThrow({ where: { id: reservationA.id, contaId: fixtureA.conta.id } }),
        prisma.auditLog.count({ where: { contaId: fixtureA.conta.id } }),
      ]);
      expect(persistedOrder).toMatchObject({
        contaId: fixtureB.conta.id,
        buyerEmail: 'other-tenant@example.test',
        status: 'PAYMENT_PENDING',
        expiresAt,
      });
      expect(persistedReservation).toMatchObject({ status: 'HELD', expiresAt: reservationA.expiresAt });
      expect(auditCountAfter).toBe(auditCountBefore);
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [fixtureA.conta.id, fixtureB.conta.id] } } });
    }
  });

  it('fails closed when the public map points to an event owned by another tenant', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture();
    try {
      await prisma.eventMap.update({ where: { id: tenantA.map.id }, data: { eventId: tenantB.event.id } });
      const reservation = await createReservation(tenantA, 'PUBLIC_CHECKOUT');
      const before = await prisma.eventMapReservation.findFirstOrThrow({ where: { id: reservation.id, contaId: tenantA.conta.id } });
      await expect(preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'MAPA_PUBLICO_NAO_ENCONTRADO', status: 404 });
      expect(await prisma.eventMapOrder.count({ where: { contaId: tenantA.conta.id } })).toBe(0);
      expect(await prisma.eventMapReservation.findFirstOrThrow({ where: { id: reservation.id, contaId: tenantA.conta.id } }))
        .toMatchObject({ status: 'HELD', expiresAt: before.expiresAt });
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantA.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [tenantA.conta.id, tenantB.conta.id] } } });
    }
  });

  it('fails closed when the held reservation event does not match its map', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const otherEvent = await prisma.schoolEvent.create({
        data: { contaId: fixture.conta.id, name: 'Different event', type: 'CULTURAL_SHOW', status: 'ACTIVE', startsAt: new Date('2026-11-15T00:00:00.000Z'), ticketMode: 'NUMBERED_SEATS', hasTickets: true },
      });
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await prisma.eventMapReservation.update({ where: { id: reservation.id }, data: { eventId: otherEvent.id } });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'RESERVA_NAO_ENCONTRADA', status: 404 });
      expect(await prisma.eventMapOrder.count({ where: { contaId: fixture.conta.id } })).toBe(0);
      expect((await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } })).eventId).toBe(otherEvent.id);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('fails closed when a HELD reservation seat points to another tenant seat', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture({ seatStatus: 'AVAILABLE' });
    try {
      const reservation = await createReservation(tenantA, 'PUBLIC_CHECKOUT');
      const link = await prisma.eventMapReservationSeat.findFirstOrThrow({ where: { reservationId: reservation.id } });
      await prisma.eventMapReservationSeat.update({ where: { id: link.id }, data: { publicSeatId: tenantB.seat.id } });
      const auditCount = await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } });

      await expect(preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'RESERVA_INVALIDA', status: 409 });
      expect(await prisma.eventMapOrder.count({ where: { contaId: tenantA.conta.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } })).toBe(auditCount);
      expect((await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe('HELD');
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } })).status).toBe('AVAILABLE');
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [tenantA.conta.id, tenantB.conta.id] } } });
    }
  });

  it('fails closed when a finalized reservation seat relation points outside its map', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture({ seatStatus: 'AVAILABLE' });
    try {
      const reservation = await createReservation(tenantA, 'PUBLIC_CHECKOUT');
      const started = await preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation));
      await prisma.$transaction(async (tx) => {
        await tx.eventMapOrder.update({ where: { id: started.order.id }, data: { status: 'CONFIRMED', paymentStatus: 'RECEIVED', asaasPaymentId: `pay_${randomUUID()}` } });
        await tx.eventMapReservation.update({ where: { id: reservation.id }, data: { status: 'CONSUMED' } });
        await tx.eventMapPublicSeat.update({ where: { id: tenantA.seat.id }, data: { status: 'SOLD' } });
      });
      const link = await prisma.eventMapReservationSeat.findFirstOrThrow({ where: { reservationId: reservation.id } });
      await prisma.eventMapReservationSeat.update({ where: { id: link.id }, data: { publicSeatId: tenantB.seat.id } });
      const beforeOrder = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: started.order.id, contaId: tenantA.conta.id } });
      const auditCount = await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } });

      await expect(preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'RESERVA_INVALIDA', status: 409 });
      expect(await prisma.eventMapOrder.findFirstOrThrow({ where: { id: started.order.id, contaId: tenantA.conta.id } }))
        .toMatchObject({ status: beforeOrder.status, paymentStatus: beforeOrder.paymentStatus, asaasPaymentId: beforeOrder.asaasPaymentId });
      expect(await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } })).toBe(auditCount);
      expect((await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe('CONSUMED');
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } })).status).toBe('AVAILABLE');
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [tenantA.conta.id, tenantB.conta.id] } } });
    }
  });

  it('rejects a HELD order item linked to a seat outside the reservation before writes', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture({ seatStatus: 'AVAILABLE' });
    try {
      const reservation = await createReservation(tenantA, 'PUBLIC_CHECKOUT');
      const checkout = await preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation));
      await prisma.eventMapOrderItem.create({ data: {
        contaId: tenantA.conta.id, orderId: checkout.order.id, publicSeatId: tenantB.seat.id,
        unitPriceSnapshot: 20, sectionName: 'Pista', seatLabel: 'B1', technicalCode: 'cross-tenant-seat',
      } });
      const before = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: checkout.order.id, contaId: tenantA.conta.id } });
      const auditCount = await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } });
      let failure: unknown;
      try { await preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation)); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO', status: 404 });
      expect(String(failure)).not.toContain('cross-tenant-seat');
      expect(await prisma.eventMapOrder.findFirstOrThrow({ where: { id: checkout.order.id, contaId: tenantA.conta.id } }))
        .toMatchObject({ status: before.status, paymentStatus: before.paymentStatus, totalAmount: before.totalAmount });
      expect(await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } })).toBe(auditCount);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } })).status).toBe('AVAILABLE');
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [tenantA.conta.id, tenantB.conta.id] } } });
    }
  });

  it('rejects a finalized ticket linked to another tenant before exposing ticket data', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture({ seatStatus: 'AVAILABLE' });
    try {
      const reservation = await createReservation(tenantA, 'PUBLIC_CHECKOUT');
      const checkout = await preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation));
      const item = await prisma.eventMapOrderItem.create({ data: {
        contaId: tenantA.conta.id, orderId: checkout.order.id, publicSeatId: tenantA.seat.id,
        unitPriceSnapshot: 20, sectionName: 'Pista', seatLabel: 'A1', technicalCode: 'A1',
      } });
      const ticketCode = `secret-${randomUUID()}`;
      await prisma.eventTicket.create({ data: {
        contaId: tenantB.conta.id, eventId: tenantB.event.id, eventMapOrderId: checkout.order.id,
        orderItemId: item.id, ticketCode,
      } });
      await prisma.$transaction(async (tx) => {
        await tx.eventMapOrder.update({ where: { id: checkout.order.id }, data: { status: 'CONFIRMED', paymentStatus: 'RECEIVED', asaasPaymentId: `pay-${randomUUID()}` } });
        await tx.eventMapReservation.update({ where: { id: reservation.id }, data: { status: 'CONSUMED' } });
        await tx.eventMapPublicSeat.update({ where: { id: tenantA.seat.id }, data: { status: 'SOLD' } });
      });
      const auditCount = await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } });
      let failure: unknown;
      try { await preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(reservation)); }
      catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO', status: 404 });
      expect(String(failure)).not.toContain(ticketCode);
      expect(await prisma.auditLog.count({ where: { contaId: tenantA.conta.id } })).toBe(auditCount);
      expect(await prisma.eventMapOrder.findFirstOrThrow({ where: { id: checkout.order.id, contaId: tenantA.conta.id } }))
        .toMatchObject({ status: 'CONFIRMED', paymentStatus: 'RECEIVED' });
    } finally {
      await prisma.conta.deleteMany({ where: { id: { in: [tenantA.conta.id, tenantB.conta.id] } } });
    }
  });

  it('fails closed when a held reservation is linked to an order for another map version', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      const checkout = await preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation));
      const otherVersion = await prisma.eventMapVersion.create({
        data: { contaId: fixture.conta.id, eventMapId: fixture.map.id, version: 2, status: 'DRAFT', snapshot: { startsAt: '2026-11-15T00:00:00.000Z' } },
      });
      await prisma.eventMapOrder.update({ where: { id: checkout.order.id }, data: { versionId: otherVersion.id } });
      const before = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: checkout.order.id, contaId: fixture.conta.id } });
      const auditCountBefore = await prisma.auditLog.count({ where: { contaId: fixture.conta.id } });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'PEDIDO_NAO_ENCONTRADO', status: 404 });
      const [after, auditCountAfter] = await Promise.all([
        prisma.eventMapOrder.findFirstOrThrow({ where: { id: checkout.order.id, contaId: fixture.conta.id } }),
        prisma.auditLog.count({ where: { contaId: fixture.conta.id } }),
      ]);
      expect(after).toMatchObject({ versionId: otherVersion.id, status: before.status, expiresAt: before.expiresAt });
      expect(auditCountAfter).toBe(auditCountBefore);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('cancels an already-deleted pending order and releases its held reservation seats', async () => {
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
          paymentStatus: 'DELETED',
          asaasPaymentId: 'pay-deleted-test',
          accessToken: `order-${randomUUID()}`,
        },
      });

      await expect(cancelPublicEventMapOrder(fixture.conta.id, order.id, 'ASAAS_PAYMENT_ALREADY_DELETED'))
        .resolves.toMatchObject({ ok: true });

      expect(await prisma.eventMapOrder.findFirstOrThrow({ where: { id: order.id, contaId: fixture.conta.id } }))
        .toMatchObject({ status: 'CANCELLED', paymentStatus: 'DELETED', asaasPaymentId: 'pay-deleted-test', cancelledAt: expect.any(Date) });
      expect(await prisma.eventMapReservation.findFirstOrThrow({ where: { id: reservation.id, contaId: fixture.conta.id } }))
        .toMatchObject({ status: 'CANCELLED', checkoutKey: null });
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('AVAILABLE');
      expect(await prisma.auditLog.count({ where: {
        contaId: fixture.conta.id, entityId: order.id, action: 'events.map.public.order.cancelled',
      } })).toBe(1);
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('resumes an expired hold only for its original unknown order and keeps buyer details', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      const order = await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id, eventId: fixture.event.id, eventMapId: fixture.map.id,
          versionId: fixture.version.id, reservationId: reservation.id, buyerName: 'Comprador Teste',
          buyerEmail: 'ticket@example.test', buyerDocument: '52998224725', buyerPhone: '11987654321',
          totalAmount: 20, status: 'PAYMENT_PENDING', paymentMethod: 'PIX', paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
          accessToken: `order-${randomUUID()}`,
        },
      });
      await prisma.eventMapReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

      const result = await preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation));
      const persisted = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: order.id, contaId: fixture.conta.id } });
      const heldReservation = await prisma.eventMapReservation.findFirstOrThrow({ where: { id: reservation.id, contaId: fixture.conta.id } });

      expect(result.order.id).toBe(order.id);
      expect(heldReservation.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(persisted).toMatchObject({ buyerName: 'Comprador Teste', buyerEmail: 'ticket@example.test', buyerPhone: '11987654321' });
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
      expect(await prisma.auditLog.count({ where: { contaId: fixture.conta.id, entityId: order.id, action: 'events.map.public.checkout.hold_resumed' } })).toBe(1);
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('does not resume an expired hold without an unresolved payment', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await prisma.eventMapReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      await prisma.eventMapOrder.create({
        data: {
          contaId: fixture.conta.id, eventId: fixture.event.id, eventMapId: fixture.map.id,
          versionId: fixture.version.id, reservationId: reservation.id, buyerName: 'Nome', buyerEmail: 'buyer@example.test',
          buyerDocument: '52998224725', buyerPhone: '11987654321', totalAmount: 20, status: 'PAYMENT_PENDING',
          paymentMethod: 'PIX', accessToken: `order-${randomUUID()}`,
        },
      });
      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'RESERVA_EXPIRADA' });
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('rejects checkout when an original reserved seat is no longer held', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD' });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      await prisma.eventMapPublicSeat.update({ where: { id: fixture.seat.id }, data: { status: 'AVAILABLE' } });
      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .rejects.toMatchObject({ code: 'RESERVA_INVALIDA' });
      expect(await prisma.eventMapOrder.count({ where: { contaId: fixture.conta.id } })).toBe(0);
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('does not accept a reservation token from another tenant', async () => {
    const tenantA = await createFixture({ seatStatus: 'HELD' });
    const tenantB = await createFixture({ seatStatus: 'HELD' });
    try {
      const foreignReservation = await createReservation(tenantB, 'PUBLIC_CHECKOUT');
      await expect(preparePublicEventMapCheckout(tenantA.map.publicSlug!, checkoutInput(foreignReservation)))
        .rejects.toMatchObject({ code: 'RESERVA_NAO_ENCONTRADA' });
      expect(await prisma.eventMapOrder.count({ where: { contaId: tenantA.conta.id } })).toBe(0);
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: tenantB.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: tenantA.conta.id } });
      await prisma.conta.deleteMany({ where: { id: tenantB.conta.id } });
    }
  });

  it('preserves an initiated public order when its lot later closes', async () => {
    const fixture = await createFixture({
      seatStatus: 'HELD',
      lot: true,
      saleStartsAt: new Date(Date.now() - 3_600_000),
      saleEndsAt: new Date(Date.now() + 3_600_000),
    });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      const started = await preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation));
      const paymentIdentity = started.order.id;
      const asaasPaymentId = `pay_${randomUUID()}`;
      await prisma.eventMapOrder.update({
        where: { id: paymentIdentity },
        data: { asaasPaymentId, paymentStatus: 'PENDING' },
      });
      const orderBeforeClose = await prisma.eventMapOrder.findFirstOrThrow({ where: { id: paymentIdentity, contaId: fixture.conta.id } });
      await updateTicketLot(ctx(fixture.conta.id, fixture.user.id), fixture.lot!.id, {
        status: 'CLOSED', saleEndsAt: new Date(Date.now() - 60_000),
      });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .resolves.toMatchObject({ order: { id: paymentIdentity, asaasPaymentId, paymentStatus: 'PENDING' } });
      expect(await prisma.eventMapOrder.count({ where: { contaId: fixture.conta.id } })).toBe(1);
      expect(await prisma.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: paymentIdentity } })).toBe(0);
      expect(await prisma.eventMapOrder.findFirstOrThrow({ where: { id: paymentIdentity, contaId: fixture.conta.id } }))
        .toMatchObject({ asaasPaymentId: orderBeforeClose.asaasPaymentId, paymentStatus: orderBeforeClose.paymentStatus, status: orderBeforeClose.status });
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('HELD');
    } finally {
      await prisma.conta.deleteMany({ where: { id: fixture.conta.id } });
    }
  });

  it('recovers a confirmed order after its webhook consumed the reservation', async () => {
    const fixture = await createFixture({ seatStatus: 'HELD', startsAtLocal: validLocal });
    try {
      const reservation = await createReservation(fixture, 'PUBLIC_CHECKOUT');
      const started = await preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation));
      const paymentId = `pay_${randomUUID()}`;
      await prisma.$transaction(async (tx) => {
        await tx.eventMapOrder.update({
          where: { id: started.order.id },
          data: { status: 'CONFIRMED', paymentStatus: 'RECEIVED', asaasPaymentId: paymentId },
        });
        await tx.eventMapReservation.update({ where: { id: reservation.id }, data: { status: 'CONSUMED' } });
        await tx.eventMapPublicSeat.update({ where: { id: fixture.seat.id }, data: { status: 'SOLD' } });
      });

      await expect(preparePublicEventMapCheckout(fixture.map.publicSlug!, checkoutInput(reservation)))
        .resolves.toMatchObject({ order: { id: started.order.id, status: 'CONFIRMED', paymentStatus: 'RECEIVED', asaasPaymentId: paymentId } });
      expect(await prisma.eventMapOrder.count({ where: { id: started.order.id, contaId: fixture.conta.id } })).toBe(1);
      expect(await prisma.eventTicket.count({ where: { contaId: fixture.conta.id, eventMapOrderId: started.order.id } })).toBe(0);
      expect((await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe('CONSUMED');
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('SOLD');
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

  it('lets a valid short staff hold finish after its lot sale window closes', async () => {
    const fixture = await createFixture({
      lot: true,
      saleStartsAt: new Date(Date.now() - 3_600_000),
      saleEndsAt: new Date(Date.now() + 3_600_000),
    });
    try {
      const reservation = await reserveStaffEventMapSeats(ctx(fixture.conta.id, fixture.user.id), fixture.event.id, fixture.map.id, { seatIds: [fixture.seat.id] });
      await updateTicketLot(ctx(fixture.conta.id, fixture.user.id), fixture.lot!.id, {
        status: 'CLOSED', saleEndsAt: new Date(Date.now() - 60_000),
      });
      const sale = await createSeatedTicketSale(ctx(fixture.conta.id, fixture.user.id), {
        eventId: fixture.event.id,
        buyerName: 'Comprador Teste',
        paymentMethod: 'COMPLIMENTARY',
        status: 'COMPLIMENTARY',
        holdToken: reservation.holdToken,
      });
      expect(sale.primarySaleId).toBeTruthy();
      expect(await prisma.eventTicketSale.count({ where: { contaId: fixture.conta.id } })).toBe(1);
      expect(await prisma.eventTicket.count({ where: { contaId: fixture.conta.id } })).toBe(1);
      expect((await prisma.eventMapReservation.findUniqueOrThrow({ where: { id: reservation.reservationId } })).status).toBe('CONSUMED');
      expect((await prisma.eventMapPublicSeat.findUniqueOrThrow({ where: { id: fixture.seat.id } })).status).toBe('SOLD');
      expect((await prisma.eventTicketLot.findFirstOrThrow({ where: { id: fixture.lot!.id, contaId: fixture.conta.id } })).status).toBe('CLOSED');
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
