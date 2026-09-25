import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays, subDays } from 'date-fns';
import { createHash, randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';
import { encryptSecret } from '../../../packages/lib/src/security/encryption';

const prisma = new PrismaClient();

async function seedPublishedMapScenario(page: import('@playwright/test').Page) {
  await resetDb(prisma);
  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `event-map-public-${Date.now()}@e2e.test`,
  });
  await prisma.conta.update({
    where: { id: contaId },
    data: { asaasApiKeyEncrypted: encryptSecret('playwright-event-map-key') },
  });

  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: 'Mostra de Dança Publicação E2E',
      type: 'PRESENTATION',
      status: 'PLANNING',
      startsAt: addDays(new Date(), 20),
      locationName: 'Teatro E2E',
      hasTickets: true,
      ticketMode: 'NUMBERED_SEATS',
    },
  });

  const lot = await prisma.eventTicketLot.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: 'Plateia',
      ticketType: 'FULL',
      unitPrice: 25,
      quantityTotal: 40,
      quantitySold: 0,
      saleStartsAt: subDays(new Date(), 1),
      saleEndsAt: addDays(new Date(), 19),
      status: 'ACTIVE',
    },
  });

  const map = await prisma.eventMap.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: 'Mapa público E2E',
      status: 'DRAFT',
    },
  });
  const level = await prisma.eventMapLevel.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      name: 'Ambiente 1',
      sortOrder: 0,
      widthPx: 800,
      heightPx: 500,
      unit: 'px',
    },
  });
  const section = await prisma.eventMapSection.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      levelId: level.id,
      lotId: lot.id,
      name: 'Plateia A',
      color: '#6d28d9',
      capacity: 4,
      status: 'ACTIVE',
    },
  });
  await prisma.eventMapObject.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      levelId: level.id,
      sectionId: section.id,
      type: 'SECTION',
      data: { fill: '#ede9fe', opacity: 0.25 },
      x: 120,
      y: 120,
      width: 360,
      height: 120,
      rotation: 0,
      sortOrder: 0,
    },
  });

  await prisma.eventSeat.createMany({
    data: Array.from({ length: 4 }, (_, index) => ({
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      levelId: level.id,
      sectionId: section.id,
      technicalCode: `A${index + 1}`,
      displayLabel: `A${index + 1}`,
      rowLabel: 'A',
      seatNumber: String(index + 1),
      status: 'AVAILABLE' as const,
      accessible: false,
      publicVisible: true,
      x: 180 + index * 70,
      y: 180,
      size: 34,
      rotation: 0,
    })),
  });

  return { event, map, level, section };
}

async function getAdminMap(page: import('@playwright/test').Page, eventId: string, mapId: string) {
  const response = await page.request.get(`/api/events/${eventId}/maps/${mapId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}

async function seedReleasedPaidOrder(params: {
  contaId: string;
  eventId: string;
  mapId: string;
  versionId: string;
  seatCode: string;
  conflictingSeatStatus?: 'HELD' | 'SOLD';
  paymentMethod?: 'PIX' | 'BOLETO';
  releasedStatus?: 'EXPIRED' | 'CANCELLED';
}) {
  const seat = await prisma.eventMapPublicSeat.findFirstOrThrow({
    where: { contaId: params.contaId, versionId: params.versionId, technicalCode: params.seatCode },
  });
  if (params.conflictingSeatStatus) {
    await prisma.eventMapPublicSeat.update({
      where: { id: seat.id },
      data: { status: params.conflictingSeatStatus },
    });
  }
  const orderId = randomUUID();
  const reservationId = randomUUID();
  const expiredAt = subDays(new Date(), 1);
  const releasedStatus = params.releasedStatus ?? 'EXPIRED';
  const reservation = await prisma.eventMapReservation.create({
    data: {
      id: reservationId,
      contaId: params.contaId,
      eventId: params.eventId,
      eventMapId: params.mapId,
      versionId: params.versionId,
      holdToken: `late_${randomUUID().replaceAll('-', '')}`,
      status: releasedStatus,
      expiresAt: expiredAt,
      cancelledAt: expiredAt,
      seats: { create: { contaId: params.contaId, publicSeatId: seat.id } },
    },
  });
  const order = await prisma.eventMapOrder.create({
    data: {
      id: orderId,
      contaId: params.contaId,
      eventId: params.eventId,
      eventMapId: params.mapId,
      versionId: params.versionId,
      reservationId: reservation.id,
      buyerName: 'Comprador com pagamento tardio',
      buyerEmail: `late-${orderId}@e2e.test`,
      totalAmount: 25,
      status: releasedStatus,
      paymentProvider: 'ASAAS',
      paymentMethod: params.paymentMethod ?? 'PIX',
      paymentStatus: 'DELETED',
      asaasPaymentId: `late-${orderId}`,
      expiresAt: expiredAt,
      cancelledAt: expiredAt,
      accessToken: `access_${randomUUID().replaceAll('-', '')}`,
      items: {
        create: {
          contaId: params.contaId,
          publicSeatId: seat.id,
          lotId: seat.lotId,
          unitPriceSnapshot: seat.unitPrice,
          sectionName: seat.sectionName,
          seatLabel: seat.displayLabel,
          technicalCode: seat.technicalCode,
        },
      },
    },
  });
  return order;
}

test.describe('event map publication, public sales and ticket delivery', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('publishes a map, sells selected seats, generates PDF tickets and preserves draft/public version rules', async ({ page }) => {
    const { event, map } = await seedPublishedMapScenario(page);
    // Keep this unrelated account-KYC widget offline; the seat-sale flow uses
    // its deterministic Asaas adapter and must never contact a live API.
    await page.route('**/api/account/verification-status**', (route) => route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ data: null, reason: 'NOT_READY' }),
    }));

    await page.goto(`/events/${event.id}/maps/${map.id}/editor`);
    await expect(page.getByTestId('event-map-editor')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Copiar link público/ })).toBeDisabled();

    const previewPopupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: /Pré-visualizar/ }).click();
    const preview = await previewPopupPromise;
    await expect(preview.getByTestId('public-event-map-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByText('Pré-visualização')).toBeVisible();
    await preview.close();

    await page.getByTestId('save-map-button').click();
    await page.waitForResponse((response) => response.url().includes(`/api/events/${event.id}/maps/${map.id}`) && response.request().method() === 'PATCH');

    await page.getByRole('button', { name: /Publicar/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Confirmar publicação/ }).click();
    await page.waitForResponse((response) => response.url().includes(`/api/events/${event.id}/maps/${map.id}/publish`) && response.ok());

    const published = await getAdminMap(page, event.id, map.id);
    expect(published.status).toBe('PUBLISHED');
    expect(published.publicUrl).toMatch(/^\/m\/map_/);
    await expect(page.getByRole('button', { name: /Copiar link público/ })).toBeEnabled();

    await page.goto(published.publicUrl);
    await expect(page.getByTestId('public-event-map-canvas')).toBeVisible({ timeout: 20_000 });

    const malformedCheckout = await page.request.post(
      `/api/public/event-maps/${published.publicSlug}/checkout`,
      { data: '{', headers: { 'content-type': 'application/json' } },
    );
    expect(malformedCheckout.status()).toBe(422);
    expect((await malformedCheckout.json()).error.code).toBe('ERRO_VALIDACAO');

    // Real PostgreSQL race: two independent checkout attempts compete for the
    // same last seat. Exactly one request must acquire the hold.
    const publicMapResponse = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    expect(publicMapResponse.status()).toBe(200);
    const publicMap = (await publicMapResponse.json()).data;
    const contestedSeat = publicMap.seats.find((seat: { technicalCode: string }) => seat.technicalCode === 'A4');
    expect(contestedSeat).toBeTruthy();
    const competingReservations = await Promise.all([
      page.request.post(`/api/public/event-maps/${published.publicSlug}/reserve`, {
        data: { seatIds: [contestedSeat.id], checkoutKey: `race-${randomUUID()}` },
      }),
      page.request.post(`/api/public/event-maps/${published.publicSlug}/reserve`, {
        data: { seatIds: [contestedSeat.id], checkoutKey: `race-${randomUUID()}` },
      }),
    ]);
    expect(competingReservations.map((response) => response.status()).sort()).toEqual([200, 409]);

    await page.getByTestId('public-seat-A1').click();
    await page.getByTestId('public-seat-A2').click();
    await page.getByRole('button', { name: /Continuar compra/ }).click();
    await page.getByLabel('Nome Completo').fill('Cliente E2E');
    await page.getByLabel('E-mail').fill('cliente.e2e@example.com');
    await page.getByLabel('CPF ou CNPJ').fill('52998224725');
    await page.getByLabel('Número (Whatsapp)').fill('11987654321');
    await page.getByRole('button', { name: /^Avançar$/ }).click();
    const checkoutResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/public/event-maps/${published.publicSlug}/checkout`) &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Confirmar e Reservar/ }).click();
    const checkoutResponse = await checkoutResponsePromise;
    expect(checkoutResponse.status(), await checkoutResponse.text()).toBe(200);

    const pendingOrder = await prisma.eventMapOrder.findFirstOrThrow({
      where: { contaId: event.contaId, buyerEmail: 'cliente.e2e@example.com' },
      select: { id: true, asaasPaymentId: true, totalAmount: true },
    });
    expect(pendingOrder.asaasPaymentId).toBeTruthy();
    const webhookToken = 'event-map-e2e-webhook-token';
    const financeProfile = await prisma.financeProfile.upsert({
      where: { contaId: event.contaId },
      update: {},
      create: { contaId: event.contaId },
      select: { id: true },
    });
    await prisma.asaasAccount.upsert({
      where: { financeProfileId: financeProfile.id },
      update: { webhookAuthTokenHash: createHash('sha256').update(webhookToken).digest('hex') },
      create: {
        financeProfileId: financeProfile.id,
        webhookAuthTokenHash: createHash('sha256').update(webhookToken).digest('hex'),
      },
    });
    const paymentWebhook = {
      id: `evt-event-map-${randomUUID()}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: pendingOrder.asaasPaymentId,
        customer: 'playwright-customer',
        billingType: 'PIX',
        status: 'RECEIVED',
        value: Number(pendingOrder.totalAmount),
        netValue: Number(pendingOrder.totalAmount),
        paymentDate: new Date().toISOString().slice(0, 10),
        externalReference: `event-map-order:${pendingOrder.id}`,
      },
    };
    const webhookResponses = await Promise.all(Array.from({ length: 3 }, () =>
      page.request.post('/api/webhooks/asaas', {
        headers: { 'asaas-access-token': webhookToken },
        data: paymentWebhook,
      }),
    ));
    expect(webhookResponses.map((response) => response.status())).toEqual([200, 200, 200]);

    await expect.poll(async () => (await prisma.eventMapOrder.findUniqueOrThrow({
      where: { id: pendingOrder.id },
      select: { status: true },
    })).status).toBe('CONFIRMED');
    await page.reload();
    await expect(page.getByText(/Pagamento confirmado|Reserva criada/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: /Ver ingressos/ })).toBeVisible({ timeout: 20_000 });

    const download = page.getByRole('link', { name: /Ver ingressos/ });
    const ticketsUrl = await download.getAttribute('href');
    expect(ticketsUrl).toBeTruthy();
    const pdfResponse = await page.request.get(ticketsUrl!);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
    const pdfBytes = await pdfResponse.body();
    expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF');

    const publicAfterSale = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    expect(publicAfterSale.status()).toBe(200);
    const soldSeats = ((await publicAfterSale.json()).data.seats as Array<{ technicalCode: string; status: string }>)
      .filter((seat) => ['A1', 'A2'].includes(seat.technicalCode));
    expect(soldSeats.map((seat) => seat.status)).toEqual(['SOLD', 'SOLD']);

    // A payment can arrive after release. Reclaim all seats if still free;
    // otherwise preserve the provider's paid truth and enqueue exactly one
    // automatic refund, including while a competing checkout merely holds a
    // seat (before that checkout completes a resale).
    const lateOrders = await Promise.all([
      seedReleasedPaidOrder({
        contaId: event.contaId,
        eventId: event.id,
        mapId: map.id,
        versionId: publicMap.versionId,
        seatCode: 'A3',
        conflictingSeatStatus: 'SOLD',
        releasedStatus: 'CANCELLED',
      }),
      seedReleasedPaidOrder({
        contaId: event.contaId,
        eventId: event.id,
        mapId: map.id,
        versionId: publicMap.versionId,
        seatCode: 'A4',
        conflictingSeatStatus: 'HELD',
        paymentMethod: 'BOLETO',
      }),
    ]);
    for (const lateOrder of lateOrders) {
      const latePaymentWebhook = {
        id: `evt-late-${lateOrder.id}`,
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: lateOrder.asaasPaymentId,
          customer: 'playwright-customer',
          billingType: lateOrder.paymentMethod,
          status: 'RECEIVED',
          value: Number(lateOrder.totalAmount),
          netValue: Number(lateOrder.totalAmount),
          paymentDate: new Date().toISOString().slice(0, 10),
          externalReference: `event-map-order:${lateOrder.id}`,
        },
      };
      const repeatedDeliveries = await Promise.all(Array.from({ length: 3 }, () =>
        page.request.post('/api/webhooks/asaas', {
          headers: { 'asaas-access-token': webhookToken },
          data: latePaymentWebhook,
        }),
      ));
      expect(repeatedDeliveries.map((response) => response.status())).toEqual([200, 200, 200]);
      await expect.poll(async () => (await prisma.eventMapOrder.findUniqueOrThrow({
        where: { id: lateOrder.id },
        select: { status: true, paymentStatus: true, ticketFulfillmentStatus: true },
      })), { timeout: 20_000, message: `late refund reconciliation for ${lateOrder.id}` }).toEqual({
        status: 'CONFIRMED',
        paymentStatus: 'RECEIVED',
        ticketFulfillmentStatus: 'REQUIRES_RECONCILIATION',
      });
      const queuedRefund = await prisma.financeWebhookSideEffectOutbox.findFirst({
        where: {
          contaId: event.contaId,
          effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
          dedupeKey: `${event.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${lateOrder.id}`,
        },
        select: { status: true, attempts: true },
      });
      expect(queuedRefund).toEqual({ status: 'PENDING', attempts: 0 });
      const lateItems = await prisma.eventMapOrderItem.findMany({
        where: { contaId: event.contaId, orderId: lateOrder.id },
        include: { ticket: { select: { id: true } } },
      });
      expect(lateItems.every((item) => item.ticket === null)).toBe(true);
    }

    const refundDispatch = await page.request.post(
      `/api/jobs/process-finance-webhooks?contaId=${event.contaId}&limit=10&effectType=EVENT_MAP_LATE_PAYMENT_REFUND`,
      { headers: { 'x-cron-token': process.env.CRON_SECRET ?? 'test-cron-secret' } },
    );
    expect(refundDispatch.status(), await refundDispatch.text()).toBe(200);
    await expect.poll(async () => {
      const rows = await prisma.financeWebhookSideEffectOutbox.findMany({
        where: {
          contaId: event.contaId,
          effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
          dedupeKey: { in: lateOrders.map((order) => `${event.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`) },
        },
        select: { status: true, attempts: true, payload: true, providerMessageId: true },
      });
      return rows.length === lateOrders.length && rows.every((row) => {
        const payload = row.payload as { requestState?: string; bankSlipRefundRequestUrl?: string };
        if (payload.requestState === 'AWAITING_CUSTOMER_ACTION') {
          return row.status === 'PROCESSED'
            && typeof payload.bankSlipRefundRequestUrl === 'string'
            && row.providerMessageId === 'playwright-bank-slip-refund-email';
        }
        return row.status === 'PENDING' && row.attempts === 1 && payload.requestState === 'SUBMITTING';
      });
    }).toBe(true);
    const boletoOrder = lateOrders[1]!;
    const boletoStatusResponse = await page.request.get(
      `/api/public/event-map-orders/${boletoOrder.id}/status?token=${encodeURIComponent(boletoOrder.accessToken)}`,
    );
    expect(boletoStatusResponse.status()).toBe(200);
    expect((await boletoStatusResponse.json()).data.refundRequestUrl).toBe(
      `https://sandbox.asaas.com/solicitar-estorno/${encodeURIComponent(boletoOrder.asaasPaymentId!)}`,
    );
    await page.goto(`/m/${published.publicSlug}?orderId=${boletoOrder.id}&token=${encodeURIComponent(boletoOrder.accessToken)}`);
    await expect(page.getByRole('heading', { name: 'Ação necessária para concluir o estorno' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Informar dados para o estorno' })).toHaveAttribute(
      'href',
      `https://sandbox.asaas.com/solicitar-estorno/${encodeURIComponent(boletoOrder.asaasPaymentId!)}`,
    );
    const refundOutboxRows = await prisma.financeWebhookSideEffectOutbox.findMany({
      where: {
        contaId: event.contaId,
        effectType: 'EVENT_MAP_LATE_PAYMENT_REFUND',
        dedupeKey: { in: lateOrders.map((order) => `${event.contaId}:EVENT_MAP_LATE_PAYMENT_REFUND:${order.id}`) },
      },
      select: { id: true },
    });
    expect(refundOutboxRows).toHaveLength(lateOrders.length);

    for (const [index, lateOrder] of lateOrders.entries()) {
      const refundDenied = index === 0;
      const refundWebhook = await page.request.post('/api/webhooks/asaas', {
        headers: { 'asaas-access-token': webhookToken },
        data: {
          id: `evt-refund-${lateOrder.id}`,
          event: refundDenied ? 'PAYMENT_REFUND_DENIED' : 'PAYMENT_REFUNDED',
          payment: {
            id: lateOrder.asaasPaymentId,
            customer: 'playwright-customer',
            billingType: lateOrder.paymentMethod,
            status: refundDenied ? 'REFUND_DENIED' : 'REFUNDED',
            value: Number(lateOrder.totalAmount),
            netValue: refundDenied ? Number(lateOrder.totalAmount) : 0,
            externalReference: `event-map-order:${lateOrder.id}`,
          },
        },
      });
      expect(refundWebhook.status()).toBe(200);
      await expect.poll(async () => prisma.eventMapOrder.findUniqueOrThrow({
        where: { id: lateOrder.id },
        select: { status: true, paymentStatus: true, ticketFulfillmentStatus: true },
      })).toEqual({
        status: refundDenied ? 'CONFIRMED' : 'REFUNDED',
        paymentStatus: refundDenied ? 'REFUND_DENIED' : 'REFUNDED',
        ticketFulfillmentStatus: 'REQUIRES_RECONCILIATION',
      });
    }

    await page.goto(`/m/${published.publicSlug}?orderId=${lateOrders[0]!.id}&token=${encodeURIComponent(lateOrders[0]!.accessToken)}`);
    await expect(page.getByRole('heading', { name: 'Estorno não concluído' })).toBeVisible();
    await expect(page.getByText(/Fale com a direção da instituição para acompanhar a devolução/)).toBeVisible();
    await page.goto(`/m/${published.publicSlug}?orderId=${lateOrders[1]!.id}&token=${encodeURIComponent(lateOrders[1]!.accessToken)}`);
    await expect(page.getByRole('heading', { name: 'Estornado' })).toBeVisible();
    await expect(page.getByText(/O estorno foi confirmado pelo Asaas/)).toBeVisible();

    const ticket = await prisma.eventTicket.findFirst({
      where: { contaId: event.contaId, eventId: event.id },
      select: { checkInCode: true, ticketCode: true, status: true },
    });
    expect(ticket).toBeTruthy();
    expect(ticket?.status).toBe('VALID');
    expect(await prisma.eventTicket.count({ where: { contaId: event.contaId, eventId: event.id } })).toBe(2);
    expect(await prisma.eventTicketSale.count({ where: { contaId: event.contaId, eventId: event.id } })).toBe(1);
    const checkInCode = ticket?.checkInCode ?? ticket?.ticketCode;
    const verifyCheckIn = await page.request.post(`/api/events/${event.id}/public-orders/verify-ticket`, {
      data: { ticketCode: checkInCode },
    });
    expect(verifyCheckIn.status()).toBe(200);
    expect((await verifyCheckIn.json()).data.ticket.status).toBe('VALID');

    const confirmCheckIn = await page.request.post(`/api/events/${event.id}/public-orders/verify-ticket`, {
      data: { ticketCode: checkInCode, confirm: true },
    });
    expect(confirmCheckIn.status()).toBe(200);
    expect((await confirmCheckIn.json()).data.ticket.status).toBe('USED');

    const duplicateCheckIn = await page.request.post(`/api/events/${event.id}/public-orders/verify-ticket`, {
      data: { ticketCode: checkInCode, confirm: true },
    });
    expect(duplicateCheckIn.status()).toBe(200);
    expect((await duplicateCheckIn.json()).data.alreadyUsed).toBe(true);

    const draft = await getAdminMap(page, event.id, map.id);
    const extraSeat = {
      ...draft.seats[0],
      id: randomUUID(),
      technicalCode: 'A5',
      displayLabel: 'A5',
      seatNumber: '5',
      x: 460,
    };
    const secondExtraSeat = {
      ...extraSeat,
      id: randomUUID(),
      technicalCode: 'A6',
      displayLabel: 'A6',
      seatNumber: '6',
      x: 520,
    };
    const patchResponse = await page.request.patch(`/api/events/${event.id}/maps/${map.id}`, {
      data: {
        name: draft.name,
        levels: draft.levels,
        sections: draft.sections,
        objects: draft.objects,
        seats: [...draft.seats, extraSeat, secondExtraSeat],
      },
    });
    expect(patchResponse.status()).toBe(200);

    const stillOldPublic = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    expect(((await stillOldPublic.json()).data.seats as unknown[])).toHaveLength(4);

    const republishResponse = await page.request.post(`/api/events/${event.id}/maps/${map.id}/publish`);
    expect(republishResponse.status()).toBe(200);
    const republished = (await republishResponse.json()).data;
    expect(republished.versions[0].version).toBe(2);

    const publicAfterRepublish = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    const republishedPublicData = (await publicAfterRepublish.json()).data;
    const publicSeats = republishedPublicData.seats as Array<{ technicalCode: string; status: string }>;
    expect(publicSeats).toHaveLength(6);
    expect(publicSeats.find((seat) => seat.technicalCode === 'A1')?.status).toBe('SOLD');

    const latePaymentWithAvailableSeat = await seedReleasedPaidOrder({
      contaId: event.contaId,
      eventId: event.id,
      mapId: map.id,
      versionId: republishedPublicData.versionId,
      seatCode: 'A5',
    });
    const cancelledPaymentWithAvailableSeat = await seedReleasedPaidOrder({
      contaId: event.contaId,
      eventId: event.id,
      mapId: map.id,
      versionId: republishedPublicData.versionId,
      seatCode: 'A6',
      releasedStatus: 'CANCELLED',
    });
    const recoveredPaymentOrders = [latePaymentWithAvailableSeat, cancelledPaymentWithAvailableSeat];
    const recoveredPaymentWebhooks = recoveredPaymentOrders.map((order) => ({
      id: `evt-late-recovered-${order.id}`,
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: order.asaasPaymentId,
        customer: 'playwright-customer',
        billingType: 'PIX',
        status: 'RECEIVED',
        value: Number(order.totalAmount),
        netValue: Number(order.totalAmount),
        paymentDate: new Date().toISOString().slice(0, 10),
        externalReference: `event-map-order:${order.id}`,
      },
    }));
    const recoveredWebhookDeliveries = await Promise.all(recoveredPaymentWebhooks.flatMap((webhook) => Array.from({ length: 3 }, () =>
      page.request.post('/api/webhooks/asaas', {
        headers: { 'asaas-access-token': webhookToken },
        data: webhook,
      }),
    )));
    expect(recoveredWebhookDeliveries.map((response) => response.status())).toEqual(Array(6).fill(200));
    for (const [index, order] of recoveredPaymentOrders.entries()) {
      await expect.poll(async () => prisma.eventMapOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true, ticketFulfillmentStatus: true },
      }), { timeout: 20_000, message: `released-seat payment recovery for ${order.id}` })
        .toEqual({ status: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED' });
      expect((await prisma.eventMapPublicSeat.findFirstOrThrow({
        where: {
          contaId: event.contaId,
          versionId: republishedPublicData.versionId,
          technicalCode: index === 0 ? 'A5' : 'A6',
        },
        select: { status: true },
      })).status).toBe('SOLD');
      const recoveredOrderItems = await prisma.eventMapOrderItem.findMany({
        where: { contaId: event.contaId, orderId: order.id },
        include: { ticket: { select: { id: true } } },
      });
      expect(recoveredOrderItems).toHaveLength(1);
      expect(recoveredOrderItems[0]?.ticket).toBeTruthy();
      expect(await prisma.eventTicketSale.count({
        where: { contaId: event.contaId, eventMapOrderId: order.id },
      })).toBe(1);
    }

    const archiveResponse = await page.request.delete(`/api/events/${event.id}/maps/${map.id}`);
    expect(archiveResponse.status()).toBe(200);
    expect((await archiveResponse.json()).action).toBe('ARCHIVE');
    const unavailablePublic = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    expect(unavailablePublic.status()).toBe(404);
  });
});
