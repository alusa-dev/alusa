import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays, subDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function seedPublishedMapScenario(page: import('@playwright/test').Page) {
  await resetDb(prisma);
  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `event-map-public-${Date.now()}@e2e.test`,
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

test.describe('event map publication, public sales and ticket delivery', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('publishes a map, sells selected seats, generates PDF tickets and preserves draft/public version rules', async ({ page }) => {
    const { event, map } = await seedPublishedMapScenario(page);

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
    await page.waitForResponse((response) => response.url().includes(`/api/events/${event.id}/maps/${map.id}/publish`) && response.ok());

    const published = await getAdminMap(page, event.id, map.id);
    expect(published.status).toBe('PUBLISHED');
    expect(published.publicUrl).toMatch(/^\/m\/map_/);
    await expect(page.getByRole('button', { name: /Copiar link público/ })).toBeEnabled();

    await page.goto(published.publicUrl);
    await expect(page.getByTestId('public-event-map-canvas')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('public-seat-A1').click();
    await page.getByTestId('public-seat-A2').click();
    await page.getByLabel('Nome').fill('Cliente E2E');
    await page.getByLabel('E-mail').fill('cliente.e2e@example.com');
    await page.getByLabel('Documento').fill('12345678900');
    await page.getByRole('button', { name: /Confirmar compra/ }).click();
    await expect(page.getByText('Compra confirmada')).toBeVisible({ timeout: 20_000 });

    const download = page.getByRole('link', { name: /Baixar ingressos/ });
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

    const draft = await getAdminMap(page, event.id, map.id);
    const extraSeat = {
      ...draft.seats[0],
      id: randomUUID(),
      technicalCode: 'A5',
      displayLabel: 'A5',
      seatNumber: '5',
      x: 460,
    };
    const patchResponse = await page.request.patch(`/api/events/${event.id}/maps/${map.id}`, {
      data: {
        name: draft.name,
        levels: draft.levels,
        sections: draft.sections,
        objects: draft.objects,
        seatGroups: draft.seatGroups,
        seats: [...draft.seats, extraSeat],
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
    const publicSeats = (await publicAfterRepublish.json()).data.seats as Array<{ technicalCode: string; status: string }>;
    expect(publicSeats).toHaveLength(5);
    expect(publicSeats.find((seat) => seat.technicalCode === 'A1')?.status).toBe('SOLD');

    const archiveResponse = await page.request.delete(`/api/events/${event.id}/maps/${map.id}`);
    expect(archiveResponse.status()).toBe(200);
    expect((await archiveResponse.json()).action).toBe('ARCHIVE');
    const unavailablePublic = await page.request.get(`/api/public/event-maps/${published.publicSlug}`);
    expect(unavailablePublic.status()).toBe(404);
  });
});
