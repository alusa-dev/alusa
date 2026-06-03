import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();
const cronSecret = process.env.CRON_SECRET ?? 'test-cron-secret';

type JobResponse<T> = {
  success: boolean;
  job: T;
};

async function seedEventMapBase(page: import('@playwright/test').Page) {
  await resetDb(prisma);
  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `events-hardening-${Date.now()}@e2e.test`,
  });

  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: 'Evento Hardening E2E',
      type: 'PRESENTATION',
      status: 'ACTIVE',
      startsAt: new Date('2026-02-10T19:00:00.000Z'),
      locationName: 'Teatro E2E',
      hasTickets: true,
      ticketMode: 'NUMBERED_SEATS',
    },
  });

  const map = await prisma.eventMap.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: 'Mapa Hardening E2E',
      status: 'PUBLISHED',
      publicSlug: `map_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      publicEnabled: true,
      publishedAt: new Date(),
    },
  });

  const version = await prisma.eventMapVersion.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      version: 1,
      status: 'PUBLISHED',
      snapshot: { levels: [], sections: [], objects: [], seats: [] },
      seatCount: 1,
      publishedAt: new Date(),
    },
  });

  await prisma.eventMap.update({
    where: { id: map.id },
    data: { publishedVersionId: version.id },
  });

  const seat = await prisma.eventMapPublicSeat.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      eventMapId: map.id,
      versionId: version.id,
      originalSeatId: randomUUID(),
      sectionName: 'Plateia',
      unitPrice: 25,
      technicalCode: 'A1',
      displayLabel: 'A1',
      rowLabel: 'A',
      seatNumber: '1',
      status: 'HELD',
      x: 100,
      y: 100,
      publicVisible: true,
    },
  });

  return { contaId, event, map, version, seat };
}

test.describe('events production hardening jobs', () => {
  test('protects and idempotently expires stale public reservations without external payment', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);

    const reservation = await prisma.eventMapReservation.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        holdToken: `hold_${randomUUID().replaceAll('-', '')}`,
        status: 'HELD',
        expiresAt: new Date('2026-01-01T10:00:00.000Z'),
      },
    });
    await prisma.eventMapReservationSeat.create({
      data: {
        id: randomUUID(),
        contaId,
        reservationId: reservation.id,
        publicSeatId: seat.id,
      },
    });
    const order = await prisma.eventMapOrder.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        reservationId: reservation.id,
        buyerName: 'Responsável E2E',
        buyerEmail: 'responsavel.e2e@example.com',
        totalAmount: 25,
        status: 'PAYMENT_PENDING',
        paymentProvider: 'ASAAS',
        accessToken: `order_${randomUUID().replaceAll('-', '')}`,
        expiresAt: new Date('2026-01-01T10:00:00.000Z'),
      },
    });

    const unauthorized = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}`);
    expect(unauthorized.status()).toBe(401);

    const first = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}&limit=10`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json() as JobResponse<{ expired: number }>;
    expect(firstBody.job.expired).toBe(1);

    await expect.poll(async () => prisma.eventMapReservation.findUnique({
      where: { id: reservation.id },
      select: { status: true },
    })).toEqual({ status: 'EXPIRED' });
    await expect.poll(async () => prisma.eventMapPublicSeat.findUnique({
      where: { id: seat.id },
      select: { status: true },
    })).toEqual({ status: 'AVAILABLE' });
    await expect.poll(async () => prisma.eventMapOrder.findUnique({
      where: { id: order.id },
      select: { status: true, paymentStatus: true },
    })).toEqual({ status: 'EXPIRED', paymentStatus: 'EXPIRED' });

    const second = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}&limit=10`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(second.status()).toBe(200);
    const secondBody = await second.json() as JobResponse<{ expired: number }>;
    expect(secondBody.job.expired).toBe(0);
  });

  test('reports financial inconsistencies without mutating public order state', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);
    const order = await prisma.eventMapOrder.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        buyerName: 'Comprador E2E',
        buyerEmail: 'comprador.e2e@example.com',
        totalAmount: 25,
        status: 'CONFIRMED',
        paymentProvider: 'ASAAS',
        asaasPaymentId: 'pay_e2e_hardening',
        paymentMethod: 'PIX',
        paymentStatus: 'RECEIVED',
        accessToken: `order_${randomUUID().replaceAll('-', '')}`,
        paidAt: new Date('2026-01-01T10:00:00.000Z'),
        confirmedAt: new Date('2026-01-01T10:00:00.000Z'),
      },
    });
    await prisma.eventMapOrderItem.create({
      data: {
        id: randomUUID(),
        contaId,
        orderId: order.id,
        publicSeatId: seat.id,
        unitPriceSnapshot: 25,
        sectionName: 'Plateia',
        seatLabel: 'A1',
        technicalCode: 'A1',
      },
    });

    const response = await page.request.get(`/api/jobs/events-inspect-financial-inconsistencies?contaId=${contaId}`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(response.status()).toBe(200);
    const body = await response.json() as JobResponse<{ findings: Array<{ type: string }> }>;
    const types = body.job.findings.map((finding) => finding.type);
    expect(types).toContain('CONFIRMED_ORDER_WITHOUT_TICKET');
    expect(types).toContain('CONFIRMED_ORDER_WITH_UNSOLD_SEAT');

    await expect.poll(async () => prisma.eventMapOrder.findUnique({
      where: { id: order.id },
      select: { status: true, paymentStatus: true },
    })).toEqual({ status: 'CONFIRMED', paymentStatus: 'RECEIVED' });
  });
});
