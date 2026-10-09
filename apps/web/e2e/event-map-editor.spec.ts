import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from './utils/auth';
import { resetDb } from './utils/reset-db';

const prisma = new PrismaClient();

async function seedEditorScenario(page: import('@playwright/test').Page) {
  await resetDb(prisma);

  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `admin-map-editor-${Date.now()}@e2e.test`,
  });

  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: 'Formatura E2E',
      type: 'GRADUATION',
      status: 'PLANNING',
      startsAt: addDays(new Date(), 30),
    },
    select: { id: true, name: true },
  });

  const map = await prisma.eventMap.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: 'Planta Principal',
      status: 'DRAFT',
    },
    select: { id: true, name: true },
  });

  const level = await prisma.eventMapLevel.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      name: 'Plano de fundo',
      sortOrder: 0,
      widthPx: 1600,
      heightPx: 1000,
      unit: 'px',
      scale: '1m = 50px',
    },
    select: { id: true, name: true },
  });

  return { contaId, event, map, level };
}

async function openEditorWithCanvas(page: import('@playwright/test').Page) {
  const { event, map } = await seedEditorScenario(page);
  await page.goto(`/events/${event.id}/maps/${map.id}/editor`);
  await expect(page.getByRole('heading', { name: map.name })).toBeVisible({ timeout: 15_000 });
  const canvas = page.getByTestId('map-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  return { event, map, canvas, box: box! };
}

test.describe('Event Map Editor', () => {
  test('editor page loads without ReactCurrentOwner error', async ({ page }) => {
    const criticalErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Captura erros críticos de React/react-konva
        if (
          text.includes('ReactCurrentOwner') ||
          text.includes('Cannot read properties of undefined') ||
          text.includes('Module not found') ||
          text.includes('ChunkLoadError')
        ) {
          criticalErrors.push(text);
        }
      }
    });

    page.on('pageerror', (err) => {
      if (
        err.message.includes('ReactCurrentOwner') ||
        err.message.includes('Cannot read properties of undefined')
      ) {
        criticalErrors.push(err.message);
      }
    });

    const { event, map } = await seedEditorScenario(page);

    await page.goto(`/events/${event.id}/maps/${map.id}/editor`);

    // Header deve aparecer com nome do mapa
    await expect(page.getByRole('heading', { name: map.name })).toBeVisible({ timeout: 15_000 });

    // Botão de voltar deve estar presente
    await expect(page.getByRole('link').filter({ hasText: '' }).first()).toBeVisible();

    expect(criticalErrors).toHaveLength(0);
  });

  test('editor canvas area renders without crashing', async ({ page }) => {
    const { event, map } = await seedEditorScenario(page);

    await page.goto(`/events/${event.id}/maps/${map.id}/editor`);

    await expect(page.getByRole('heading', { name: map.name })).toBeVisible({ timeout: 15_000 });

    // O canvas Konva renderiza como <canvas> ou o loading placeholder some
    // Aguarda o estado inicial: ou o <canvas> aparece, ou o skeleton some
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('canvas');
        const skeleton = document.querySelector('.animate-pulse');
        return canvas !== null || skeleton === null;
      },
      { timeout: 20_000 },
    );

    // Não deve ter mensagem de erro crítico na tela
    await expect(page.getByText('ReactCurrentOwner')).not.toBeVisible();
    await expect(page.getByText('Application error')).not.toBeVisible();
  });

  test('map settings are grouped into compact sections', async ({ page }) => {
    const { event, map } = await seedEditorScenario(page);
    await page.goto(`/events/${event.id}/maps/${map.id}/editor`);
    await expect(page.getByRole('heading', { name: map.name })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Configurações do mapa' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Sessão' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Venda pública' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Planta de referência' })).toBeVisible();

    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.height).toBeLessThanOrEqual(viewport!.height - 32);
  });

  test('API GET /events/:eventId/maps/:mapId returns map data', async ({ page }) => {
    const { event, map } = await seedEditorScenario(page);

    const res = await page.request.get(`/api/events/${event.id}/maps/${map.id}`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    const data = body.data ?? body;
    expect(data.id).toBe(map.id);
    expect(data.name).toBe(map.name);
    expect(data.status).toBe('DRAFT');
  });

  test('API GET /events/:eventId/maps lists maps', async ({ page }) => {
    const { event, map } = await seedEditorScenario(page);

    const res = await page.request.get(`/api/events/${event.id}/maps`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    const maps: { id: string }[] = Array.isArray(body) ? body : (body.data ?? []);
    expect(maps.some((m) => m.id === map.id)).toBe(true);
  });

  test('map creation flow creates independent sessions in one event', async ({ page }) => {
    await resetDb(prisma);
    const { contaId } = await seedAdminAndAuthenticate(page, {
      email: `admin-map-sessions-${Date.now()}@e2e.test`,
    });
    const firstSessionDate = addDays(new Date(), 30);
    firstSessionDate.setHours(19, 0, 0, 0);
    const secondSessionDate = addDays(new Date(), 30);
    secondSessionDate.setHours(20, 0, 0, 0);
    const event = await prisma.schoolEvent.create({
      data: {
        id: randomUUID(),
        contaId,
        name: 'Festival de Dança E2E',
        type: 'PRESENTATION',
        status: 'PLANNING',
        startsAt: firstSessionDate,
        hasTickets: true,
        ticketMode: 'NUMBERED_SEATS',
      },
      select: { id: true },
    });
    const firstSessionStartsAt = firstSessionDate.toISOString();
    const secondSessionStartsAt = secondSessionDate.toISOString();

    const lotsResponse = await page.request.get(`/api/events/ticket-lots?eventId=${event.id}`);
    expect(lotsResponse.status()).toBe(200);

    await page.goto(`/events/${event.id}/maps/new`);
    const blankMapOption = page.getByRole('radio', { name: /Em branco/ });
    await blankMapOption.check({ force: true });
    await expect(blankMapOption).toBeChecked();
    await page.getByLabel('Nome da sessão').fill('1ª Sessão - 19h00');
    const localSessionStart = new Date(
      firstSessionDate.getTime() - firstSessionDate.getTimezoneOffset() * 60_000,
    ).toISOString().slice(0, 16);
    await page.getByLabel('Início').fill(localSessionStart);
    const continueButton = page.getByRole('button', { name: 'Continuar' });
    await expect(continueButton).toBeEnabled();
    const firstMapCreationResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/events/${event.id}/maps`) &&
      response.request().method() === 'POST',
    );
    await continueButton.click();
    expect((await firstMapCreationResponse).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/events/${event.id}/maps/[^/]+/editor`), { timeout: 20_000 });
    const firstMapId = page.url().match(/\/maps\/([^/]+)\/editor/)?.[1];
    expect(firstMapId).toBeTruthy();
    const firstMapResponse = await page.request.get(`/api/events/${event.id}/maps/${firstMapId}`);
    expect(firstMapResponse.status()).toBe(200);
    const firstMap = (await firstMapResponse.json()).data;
    expect(firstMap.name).toBe('1ª Sessão - 19h00');
    expect(firstMap.startsAt).toBe(firstSessionStartsAt);

    const secondResponse = await page.request.post(`/api/events/${event.id}/maps`, {
      data: {
        name: '2ª Sessão - 20h00',
        startsAt: secondSessionStartsAt,
        locationName: 'Teatro E2E',
      },
    });
    expect(secondResponse.status()).toBe(201);
    const secondMap = (await secondResponse.json()).data;

    expect(secondMap.id).not.toBe(firstMap.id);
    expect(secondMap.name).toBe('2ª Sessão - 20h00');
    expect(secondMap.startsAt).toBe(secondSessionStartsAt);
    expect(secondMap.counts.seats).toBe(0);

    const listResponse = await page.request.get(`/api/events/${event.id}/maps`);
    expect(listResponse.status()).toBe(200);
    const sessions = (await listResponse.json()).data;
    expect(sessions.map((map: { name: string }) => map.name)).toEqual(
      expect.arrayContaining(['1ª Sessão - 19h00', '2ª Sessão - 20h00']),
    );
  });

  test('text tool creates free text from a single click', async ({ page }) => {
    const { box } = await openEditorWithCanvas(page);

    await page.getByLabel('Adicionar texto').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const editor = page.getByTestId('map-text-editor');
    await expect(editor).toBeFocused();
    await editor.pressSequentially('Texto livre E2E');
    const singleLineBox = await editor.boundingBox();
    expect(singleLineBox).not.toBeNull();

    await editor.press('Shift+Enter');
    await editor.pressSequentially('segunda linha');

    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Texto livre E2E\nsegunda linha');
    const multilineBox = await editor.boundingBox();
    expect(multilineBox).not.toBeNull();
    expect(multilineBox!.height).toBeGreaterThan(singleLineBox!.height);
    await editor.evaluate((node) => node.blur());

    await expect(editor).toBeHidden();
  });

  test('text tool creates bounded text when dragging an area', async ({ page }) => {
    const { box } = await openEditorWithCanvas(page);

    const start = { x: box.x + box.width / 2 - 120, y: box.y + box.height / 2 - 40 };
    const end = { x: start.x + 260, y: start.y + 90 };

    await page.getByLabel('Adicionar texto').click();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const editor = page.getByTestId('map-text-editor');
    await expect(editor).toBeFocused();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox!.width).toBeGreaterThan(180);
    expect(editorBox!.height).toBeGreaterThan(60);
    await editor.pressSequentially('Texto em area E2E');
    await expect(editor).toHaveValue('Texto em area E2E');
    await editor.evaluate((node) => node.blur());

    await expect(page.getByRole('button', { name: 'Texto em area E2E', exact: true })).toBeVisible();
    await expect(page.locator('textarea').filter({ hasText: 'Texto em area E2E' })).toBeVisible();
  });
});
