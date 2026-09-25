import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';
import { encryptSecret } from '../../../packages/lib/src/security/encryption';

const prisma = new PrismaClient();
const cronSecret = process.env.CRON_SECRET ?? 'test-cron-secret';

type JobResponse<T> = {
  success: boolean;
  job: T;
};

async function seedEventMapBase(
  page: import('@playwright/test').Page,
  options: { reset?: boolean } = {},
) {
  if (options.reset !== false) await resetDb(prisma);
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
  test('completes public checkout and webhook confirmation for PIX, card and boleto', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);
    const lot = await prisma.eventTicketLot.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        name: 'Lote dos métodos E2E',
        ticketType: 'FULL',
        unitPrice: 25,
        quantityTotal: 10,
        quantitySold: 0,
        saleStartsAt: new Date(Date.now() - 60_000),
        saleEndsAt: new Date(Date.now() + 24 * 60 * 60_000),
        status: 'ACTIVE',
      },
    });
    await prisma.conta.update({
      where: { id: contaId },
      data: { asaasApiKeyEncrypted: encryptSecret('playwright-event-map-key') },
    });
    const extraSeats = await prisma.eventMapPublicSeat.createManyAndReturn({
      data: ['A2', 'A3'].map((technicalCode, index) => ({
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        originalSeatId: randomUUID(),
        sectionName: 'Plateia',
        unitPrice: 25,
        technicalCode,
        displayLabel: technicalCode,
        rowLabel: 'A',
        seatNumber: String(index + 2),
        status: 'AVAILABLE' as const,
        x: 150 + index * 50,
        y: 100,
        publicVisible: true,
      })),
    });
    await prisma.eventMapPublicSeat.updateMany({
      where: { contaId, eventMapId: map.id, versionId: version.id },
      data: { status: 'AVAILABLE', lotId: lot.id, lotName: lot.name },
    });
    const webhookToken = `events-methods-${randomUUID()}`;
    const financeProfile = await prisma.financeProfile.upsert({
      where: { contaId },
      update: {},
      create: { contaId },
      select: { id: true },
    });
    await prisma.asaasAccount.upsert({
      where: { financeProfileId: financeProfile.id },
      update: {
        apiKeyEncrypted: encryptSecret('playwright-event-map-key'),
        apiKeyStatus: 'CONNECTED',
        webhookAuthTokenHash: createHash('sha256').update(webhookToken).digest('hex'),
      },
      create: {
        financeProfileId: financeProfile.id,
        apiKeyEncrypted: encryptSecret('playwright-event-map-key'),
        apiKeyStatus: 'CONNECTED',
        webhookAuthTokenHash: createHash('sha256').update(webhookToken).digest('hex'),
      },
    });

    const paymentChannels = [
      { method: 'PIX', seatId: seat.id },
      { method: 'CREDIT_CARD', seatId: extraSeats[0]!.id },
      { method: 'BOLETO', seatId: extraSeats[1]!.id },
    ] as const;

    const lookupFailureReservationResponse = await page.request.post(
      `/api/public/event-maps/${map.publicSlug}/reserve`,
      { data: { seatIds: [seat.id], checkoutKey: `customer-lookup-${randomUUID()}` } },
    );
    expect(lookupFailureReservationResponse.status(), await lookupFailureReservationResponse.text()).toBe(200);
    const lookupFailureReservation = (await lookupFailureReservationResponse.json()).data;
    const lookupFailureCheckoutResponse = await page.request.post(
      `/api/public/event-maps/${map.publicSlug}/checkout`,
      {
        data: {
          reservationId: lookupFailureReservation.reservationId,
          holdToken: lookupFailureReservation.holdToken,
          buyerName: 'Comprador com consulta de cliente indisponível',
          buyerEmail: 'asaas-lookup-unavailable@e2e.test',
          buyerDocument: '11144477735',
          buyerPhone: '11987654321',
          paymentMethod: 'PIX',
        },
      },
    );
    expect(lookupFailureCheckoutResponse.status()).toBe(500);
    const lookupFailureOrder = await prisma.eventMapOrder.findFirstOrThrow({
      where: { contaId, buyerEmail: 'asaas-lookup-unavailable@e2e.test' },
    });
    expect(lookupFailureOrder).toMatchObject({
      status: 'CANCELLED',
      asaasPaymentId: null,
    });
    const releasedLookupFailureSeat = await prisma.eventMapPublicSeat.findFirstOrThrow({
      where: { id: seat.id, contaId },
      select: { status: true },
    });
    expect(releasedLookupFailureSeat.status).toBe('AVAILABLE');

    for (const [index, channel] of paymentChannels.entries()) {
      const reservationResponse = await page.request.post(`/api/public/event-maps/${map.publicSlug}/reserve`, {
        data: { seatIds: [channel.seatId], checkoutKey: `method-${channel.method}-${randomUUID()}` },
      });
      expect(reservationResponse.status(), await reservationResponse.text()).toBe(200);
      const reservation = (await reservationResponse.json()).data;
      const checkoutResponse = await page.request.post(`/api/public/event-maps/${map.publicSlug}/checkout`, {
        data: {
          reservationId: reservation.reservationId,
          holdToken: reservation.holdToken,
          buyerName: channel.method === 'PIX' ? 'Comprador com resposta perdida' : `Comprador ${channel.method}`,
          buyerEmail: `comprador-${index}@e2e.test`,
          buyerDocument: '52998224725',
          buyerPhone: '11987654321',
          paymentMethod: channel.method,
        },
      });
      expect(checkoutResponse.status(), await checkoutResponse.text()).toBe(200);
      const checkout = (await checkoutResponse.json()).data;
      expect(checkout.asaasPaymentId).toBeTruthy();
      expect(checkout.status).toBe('PAYMENT_PENDING');
      if (channel.method === 'PIX') expect(checkout.pixQrCode?.payload).toBe('playwright-pix-payload');
      if (channel.method === 'CREDIT_CARD') expect(checkout.invoiceUrl).toContain('playwright.invalid');
      if (channel.method === 'BOLETO') {
        expect(checkout.bankSlipCode).toContain('34191');
        expect(checkout.bankSlipBarcode).toContain('341910');
      }

      await page.goto(`/m/${map.publicSlug}?orderId=${checkout.orderId}&token=${encodeURIComponent(checkout.accessToken)}`);
      if (channel.method === 'PIX') {
        await expect(page.getByRole('heading', { name: 'Aponte a câmera do seu celular' })).toBeVisible();
        await expect(page.getByLabel('Código Copia e Cola')).toHaveValue('playwright-pix-payload');
      }
      if (channel.method === 'BOLETO') {
        await expect(page.getByRole('heading', { name: 'Aponte a câmera para o código de barras' })).toBeVisible();
        await expect(page.locator('#boleto-copia-cola-desktop')).toHaveValue(/34191/);
      }

      const pendingSync = await page.request.post(
        `/api/public/event-map-orders/${checkout.orderId}/sync-payment?token=${encodeURIComponent(checkout.accessToken)}`,
      );
      expect(pendingSync.status(), await pendingSync.text()).toBe(200);
      expect((await pendingSync.json()).data).toMatchObject({
        synced: false,
        paymentStatus: 'PENDING',
      });

      const paymentWebhook = {
        id: `evt-method-${channel.method}-${randomUUID()}`,
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: checkout.asaasPaymentId,
          customer: channel.method === 'PIX' ? 'playwright-lost-response-customer' : 'playwright-customer',
          billingType: channel.method,
          status: 'RECEIVED',
          value: Number(checkout.totalAmount),
          netValue: Number(checkout.totalAmount),
          paymentDate: new Date().toISOString().slice(0, 10),
          externalReference: `event-map-order:${checkout.orderId}`,
        },
      };
      const deliveries = await Promise.all(Array.from({ length: 3 }, () => page.request.post('/api/webhooks/asaas', {
        headers: { 'asaas-access-token': webhookToken },
        data: paymentWebhook,
      })));
      expect(deliveries.map((response) => response.status())).toEqual([200, 200, 200]);
      const stalePendingDelivery = await page.request.post('/api/webhooks/asaas', {
        headers: { 'asaas-access-token': webhookToken },
        data: {
          ...paymentWebhook,
          id: 'evt-stale-pending-' + channel.method + '-' + randomUUID(),
          event: 'PAYMENT_CREATED',
          payment: { ...paymentWebhook.payment, status: 'PENDING' },
        },
      });
      expect(stalePendingDelivery.status()).toBe(200);
      await expect.poll(async () => (await prisma.eventMapOrder.findUniqueOrThrow({
        where: { id: checkout.orderId },
        select: { status: true, paymentMethod: true, ticketFulfillmentStatus: true },
      }))).toEqual({
        status: 'CONFIRMED',
        paymentMethod: channel.method,
        ticketFulfillmentStatus: 'ISSUED',
      });
      await expect.poll(async () => (await prisma.eventMapPublicSeat.findUniqueOrThrow({
        where: { id: channel.seatId },
        select: { status: true },
      })).status).toBe('SOLD');
      expect(await prisma.eventTicketSale.count({ where: { contaId, eventMapOrderId: checkout.orderId } })).toBe(1);
      expect(await prisma.financeReconciliationIssue.count({
        where: { contaId, asaasId: checkout.asaasPaymentId, issueType: 'PAYMENT_MISSING_LOCAL_ENTITY' },
      })).toBe(0);
    }
  });

  test('does not expose or synchronize another institution’s public order with a foreign access token', async ({ page }) => {
    const tenantA = await seedEventMapBase(page);
    const tenantB = await seedEventMapBase(page, { reset: false });
    const makeOrder = (tenant: typeof tenantA, token: string) => prisma.eventMapOrder.create({
      data: {
        id: randomUUID(),
        contaId: tenant.contaId,
        eventId: tenant.event.id,
        eventMapId: tenant.map.id,
        versionId: tenant.version.id,
        buyerName: 'Comprador de teste cross-tenant',
        buyerEmail: `${tenant.contaId}@e2e.test`,
        totalAmount: 25,
        status: 'PAYMENT_PENDING',
        paymentProvider: 'ASAAS',
        paymentMethod: 'PIX',
        paymentStatus: 'PENDING',
        accessToken: token,
      },
    });
    const orderA = await makeOrder(tenantA, `access_${randomUUID()}`);
    const orderB = await makeOrder(tenantB, `access_${randomUUID()}`);

    const ownOrder = await page.request.get(
      `/api/public/event-map-orders/${orderA.id}/status?token=${encodeURIComponent(orderA.accessToken)}`,
    );
    expect(ownOrder.status()).toBe(200);

    const foreignStatus = await page.request.get(
      `/api/public/event-map-orders/${orderB.id}/status?token=${encodeURIComponent(orderA.accessToken)}`,
    );
    expect(foreignStatus.status()).toBe(404);
    expect(JSON.stringify(await foreignStatus.json())).not.toContain(orderB.buyerEmail);

    const foreignSync = await page.request.post(
      `/api/public/event-map-orders/${orderB.id}/sync-payment?token=${encodeURIComponent(orderA.accessToken)}`,
    );
    expect(foreignSync.status()).toBe(404);
    expect(await prisma.auditLog.count({
      where: { contaId: tenantB.contaId, entityId: orderB.id, action: 'events.map.public.sync_payment' },
    })).toBe(0);
    expect(await prisma.eventMapOrder.findUniqueOrThrow({
      where: { id: orderB.id },
      select: { asaasPaymentId: true, paymentStatus: true, status: true },
    })).toEqual({ asaasPaymentId: null, paymentStatus: 'PENDING', status: 'PAYMENT_PENDING' });
  });

  test('does not release an expired hold after an empty lookup for an ambiguous payment creation', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);
    await prisma.conta.update({
      where: { id: contaId },
      data: { asaasApiKeyEncrypted: encryptSecret('playwright-event-map-key') },
    });
    const expiredAt = new Date(Date.now() - 60_000);
    const reservation = await prisma.eventMapReservation.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        holdToken: `hold_${randomUUID().replaceAll('-', '')}`,
        status: 'HELD',
        expiresAt: expiredAt,
        seats: { create: { contaId, publicSeatId: seat.id } },
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
        buyerName: 'Comprador com cobrança incerta',
        buyerEmail: 'incerto@example.com',
        totalAmount: 25,
        status: 'PAYMENT_PENDING',
        paymentProvider: 'ASAAS',
        paymentStatus: 'PAYMENT_CREATION_UNKNOWN',
        accessToken: `order_${randomUUID().replaceAll('-', '')}`,
        expiresAt: expiredAt,
      },
    });
    await prisma.eventMapOrder.update({
      where: { id: order.id },
      data: { updatedAt: new Date(Date.now() - 20 * 60_000) },
    });

    const first = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}&limit=10`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(first.status()).toBe(200);
    expect((await first.json() as JobResponse<{ expired: number; skipped: number }>).job)
      .toMatchObject({ expired: 0, skipped: 1 });

    await expect.poll(async () => prisma.financeReconciliationIssue.count({
      where: {
        contaId,
        entityId: order.id,
        issueType: 'BILLING_OPERATION_UNCERTAIN',
        status: 'OPEN',
      },
    })).toBe(1);
    await expect.poll(async () => prisma.eventMapReservation.findUnique({
      where: { id: reservation.id },
      select: { status: true },
    })).toEqual({ status: 'HELD' });
    expect((await prisma.eventMapPublicSeat.findUnique({ where: { id: seat.id }, select: { status: true } }))?.status)
      .toBe('HELD');

    const second = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}&limit=10`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(second.status()).toBe(200);
    expect((await second.json() as JobResponse<{ expired: number }>).job.expired).toBe(0);
    expect(await prisma.financeReconciliationIssue.count({
      where: { contaId, entityId: order.id, status: 'OPEN' },
    })).toBe(1);
  });

  test('protects and idempotently expires stale public reservations without external payment', async ({ page, request }) => {
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

    const unauthorized = await request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}`);
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

  test('rolls back every seat release if any seat changed while an expired reservation is being processed', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);
    const competingSeat = await prisma.eventMapPublicSeat.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        originalSeatId: randomUUID(),
        sectionName: 'Plateia',
        unitPrice: 25,
        technicalCode: 'A2',
        displayLabel: 'A2',
        rowLabel: 'A',
        seatNumber: '2',
        status: 'SOLD',
        x: 150,
        y: 100,
        publicVisible: true,
      },
    });
    const expiredAt = new Date('2026-01-01T10:00:00.000Z');
    const reservation = await prisma.eventMapReservation.create({
      data: {
        id: randomUUID(),
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        holdToken: `hold_${randomUUID().replaceAll('-', '')}`,
        status: 'HELD',
        expiresAt: expiredAt,
        seats: {
          create: [
            { contaId, publicSeatId: seat.id },
            { contaId, publicSeatId: competingSeat.id },
          ],
        },
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
        buyerName: 'Comprador de assentos múltiplos',
        buyerEmail: 'multi-seat@example.com',
        totalAmount: 50,
        status: 'PAYMENT_PENDING',
        paymentProvider: 'ASAAS',
        accessToken: `order_${randomUUID().replaceAll('-', '')}`,
        expiresAt: expiredAt,
      },
    });

    const response = await page.request.get(`/api/jobs/events-expire-reservations?contaId=${contaId}&limit=10`, {
      headers: { 'x-cron-token': cronSecret },
    });
    expect(response.status()).toBe(200);
    expect((await response.json() as JobResponse<{ expired: number; skipped: number }>).job)
      .toMatchObject({ expired: 0, skipped: 1 });
    expect(await prisma.eventMapReservation.findUnique({
      where: { id: reservation.id },
      select: { status: true },
    })).toEqual({ status: 'HELD' });
    expect(await prisma.eventMapOrder.findUnique({
      where: { id: order.id },
      select: { status: true },
    })).toEqual({ status: 'PAYMENT_PENDING' });
    expect(await prisma.eventMapPublicSeat.findMany({
      where: { id: { in: [seat.id, competingSeat.id] } },
      orderBy: { technicalCode: 'asc' },
      select: { technicalCode: true, status: true },
    })).toEqual([
      { technicalCode: 'A1', status: 'HELD' },
      { technicalCode: 'A2', status: 'SOLD' },
    ]);
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

  test('promotes exhausted persisted side effects into the durable DLQ during job preflight', async ({ page }) => {
    const { contaId } = await seedEventMapBase(page);
    const effect = await prisma.financeWebhookSideEffectOutbox.create({
      data: {
        contaId,
        effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
        dedupeKey: `${contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${randomUUID()}`,
        payload: { asaasPaymentId: 'pay-dlq-e2e', value: 25, description: 'Estorno de teste' },
        status: 'FAILED',
        attempts: 5,
        lastError: 'Falha permanente simulada antes de entrar na DLQ.',
      },
    });

    const response = await page.request.post(
      `/api/jobs/process-finance-webhooks?contaId=${contaId}&limit=1`,
      { headers: { 'x-cron-token': cronSecret } },
    );
    expect(response.status(), await response.text()).toBe(200);
    await expect.poll(async () => prisma.financeWebhookSideEffectOutbox.findUnique({
      where: { id: effect.id },
      select: { status: true, attempts: true, lastError: true },
    })).toEqual({
      status: 'EXHAUSTED',
      attempts: 5,
      lastError: 'Falha permanente simulada antes de entrar na DLQ.',
    });
  });

  test('sends a rejected automatic refund to the DLQ without retrying the declined request', async ({ page }) => {
    const { contaId, event, map, version, seat } = await seedEventMapBase(page);
    const orderId = randomUUID();
    const reservationId = randomUUID();
    const expiredAt = new Date(Date.now() - 24 * 60 * 60_000);
    await prisma.eventMapPublicSeat.update({ where: { id: seat.id }, data: { status: 'SOLD' } });
    const reservation = await prisma.eventMapReservation.create({
      data: {
        id: reservationId,
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        holdToken: `refund_${randomUUID().replaceAll('-', '')}`,
        status: 'EXPIRED',
        expiresAt: expiredAt,
        cancelledAt: expiredAt,
        seats: { create: { contaId, publicSeatId: seat.id } },
      },
    });
    await prisma.eventMapOrder.create({
      data: {
        id: orderId,
        contaId,
        eventId: event.id,
        eventMapId: map.id,
        versionId: version.id,
        reservationId: reservation.id,
        buyerName: 'Comprador do estorno recusado',
        buyerEmail: 'refund-rejection@e2e.test',
        totalAmount: 25,
        status: 'CONFIRMED',
        ticketFulfillmentStatus: 'REQUIRES_RECONCILIATION',
        ticketFulfillmentLastError: 'ASSENTOS_INDISPONIVEIS: assento revendido',
        paymentProvider: 'ASAAS',
        paymentMethod: 'PIX',
        paymentStatus: 'RECEIVED',
        asaasPaymentId: 'pay-refund-rejection-e2e',
        expiresAt: expiredAt,
        cancelledAt: expiredAt,
        accessToken: `access_${randomUUID().replaceAll('-', '')}`,
        items: {
          create: {
            contaId,
            publicSeatId: seat.id,
            unitPriceSnapshot: 25,
            sectionName: seat.sectionName,
            seatLabel: seat.displayLabel,
            technicalCode: seat.technicalCode,
          },
        },
      },
    });
    const effect = await prisma.financeWebhookSideEffectOutbox.create({
      data: {
        contaId,
        effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
        dedupeKey: `${contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:refund-rejection-e2e`,
        payload: {
          orderId,
          asaasPaymentId: 'pay-refund-rejection-e2e',
          value: 25,
          description: 'Estorno automático recusado no teste E2E.',
        },
      },
    });

    const firstAttempt = await page.request.post(
      `/api/jobs/process-finance-webhooks?contaId=${contaId}&limit=1`,
      { headers: { 'x-cron-token': cronSecret } },
    );
    expect(firstAttempt.status(), await firstAttempt.text()).toBe(200);
    await expect.poll(async () => prisma.financeWebhookSideEffectOutbox.findUnique({
      where: { id: effect.id },
      select: { status: true, attempts: true, lastError: true },
    })).toEqual({
      status: 'EXHAUSTED',
      attempts: 1,
      lastError: 'PLAYWRIGHT_REFUND_REJECTED',
    });

    const retryAttempt = await page.request.post(
      `/api/jobs/process-finance-webhooks?contaId=${contaId}&limit=1`,
      { headers: { 'x-cron-token': cronSecret } },
    );
    expect(retryAttempt.status(), await retryAttempt.text()).toBe(200);
    expect(await prisma.financeWebhookSideEffectOutbox.findUnique({
      where: { id: effect.id },
      select: { status: true, attempts: true },
    })).toEqual({ status: 'EXHAUSTED', attempts: 1 });
  });
});
