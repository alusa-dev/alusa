import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from '../utils/auth';
import { resetDb } from '../utils/reset-db';

import { assertNoSeatOverlaps, type SeatGeometry } from './geometry';

const prisma = new PrismaClient();

export type EditorScenario = {
  contaId: string;
  eventId: string;
  mapId: string;
  mapName: string;
};

export type EditorGeometry = {
  seats: SeatGeometry[];
  objects: Array<{ id: string; type: string; x: number; y: number; width: number; height: number; rotation: number; data: Record<string, unknown>; bounds: SeatGeometry['bounds'] }>;
  sections: Array<{ id: string; x: number; y: number; width: number; height: number }>;
};

export async function createMapEditorScenario(contaId: string, label: string): Promise<EditorScenario> {
  const event = await prisma.schoolEvent.create({
    data: {
      id: randomUUID(),
      contaId,
      name: `Evento ${label}`,
      type: 'GRADUATION',
      status: 'PLANNING',
      startsAt: addDays(new Date(), 30),
    },
    select: { id: true },
  });

  const mapName = `Mapa ${label}`;
  const map = await prisma.eventMap.create({
    data: {
      id: randomUUID(),
      contaId,
      eventId: event.id,
      name: mapName,
      status: 'DRAFT',
    },
    select: { id: true },
  });

  await prisma.eventMapLevel.create({
    data: {
      id: randomUUID(),
      contaId,
      eventMapId: map.id,
      name: 'Ambiente 1',
      sortOrder: 0,
      widthPx: 1440,
      heightPx: 900,
      unit: 'px',
      scale: '1m = 50px',
    },
  });

  return { contaId, eventId: event.id, mapId: map.id, mapName };
}

export async function seedEmptyMapEditor(page: Page, label: string): Promise<EditorScenario> {
  await resetDb(prisma);

  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `seat-layout-${label}-${Date.now()}@e2e.test`,
  });

  return createMapEditorScenario(contaId, label);
}

export async function openEventMapEditor(page: Page, scenario: EditorScenario) {
  await page.goto(`/events/${scenario.eventId}/maps/${scenario.mapId}/editor`);
  await expect(page.getByTestId('event-map-editor')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: scenario.mapName })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('map-canvas')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
  await waitForEditorBridge(page);
}

export async function waitForEditorBridge(page: Page) {
  await page.waitForFunction(
    () => typeof window.__ALUSA_EVENT_MAP_EDITOR_E2E__?.getGeometry === 'function',
    { timeout: 20_000 },
  );
}

export async function getEditorState(page: Page) {
  return page.evaluate(() => window.__ALUSA_EVENT_MAP_EDITOR_E2E__!.getState());
}

export async function getEditorGeometry(page: Page): Promise<EditorGeometry> {
  return page.evaluate(() => window.__ALUSA_EVENT_MAP_EDITOR_E2E__!.getGeometry());
}

export async function getRenderedEditorGeometry(page: Page): Promise<EditorGeometry> {
  return page.evaluate(() => window.__ALUSA_EVENT_MAP_EDITOR_E2E__!.getRenderGeometry());
}

export async function fitArtboard(page: Page) {
  const before = await getEditorState(page);
  await page.getByTestId('fit-artboard-button').click();
  await expect
    .poll(async () => {
      const next = await getEditorState(page);
      return next.zoom !== before.zoom || next.pan.x !== before.pan.x || next.pan.y !== before.pan.y;
    }, { timeout: 3_000 })
    .toBe(true)
    .catch(() => undefined);
}

export async function getCanvasBox(page: Page) {
  const box = await page.getByTestId('map-canvas').boundingBox();
  expect(box).toBeTruthy();
  return box!;
}

export async function mapPointToViewport(page: Page, point: { x: number; y: number }) {
  const box = await getCanvasBox(page);
  const { pan, zoom } = await getEditorState(page);
  return {
    x: box.x + pan.x + point.x * zoom,
    y: box.y + pan.y + point.y * zoom,
  };
}

export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 20,
) {
  const start = await mapPointToViewport(page, from);
  const end = await mapPointToViewport(page, to);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  for (let step = 1; step <= steps; step += 1) {
    const x = start.x + ((end.x - start.x) * step) / steps;
    const y = start.y + ((end.y - start.y) * step) / steps;
    await page.mouse.move(x, y);
  }

  await page.mouse.up();
}

export async function clickMapPoint(page: Page, point: { x: number; y: number }) {
  const viewport = await mapPointToViewport(page, point);
  await page.mouse.click(viewport.x, viewport.y);
}

export async function openPresetsMenu(page: Page) {
  await page.getByRole('button', { name: 'Presets' }).click();
}

export async function activateTool(page: Page, toolId: 'seat' | 'select') {
  if (toolId === 'select') {
    await page.getByRole('button', { name: 'Selecionar' }).click();
    return;
  }
  await openPresetsMenu(page);
  await page.getByTestId(`toolbar-${toolId}-tool`).click();
}

export async function createSeatBlock(
  page: Page,
  options: {
    origin: { x: number; y: number };
    totalSeats: number;
    rows: number;
    columns: number;
    seatSize?: number;
    horizontalSpacing?: number;
    verticalSpacing?: number;
  },
) {
  const seatsBefore = (await getEditorGeometry(page)).seats.length;
  await activateTool(page, 'seat');
  const seatSize = options.seatSize ?? 28;
  const horizontalSpacing = options.horizontalSpacing ?? seatSize + 10;
  const verticalSpacing = options.verticalSpacing ?? seatSize + 14;
  const seatGap = Math.max(0, horizontalSpacing - seatSize);
  const rowGap = Math.max(0, verticalSpacing - seatSize);
  const width = options.columns * horizontalSpacing - seatGap;
  const height = options.rows * verticalSpacing - rowGap;
  await dragOnCanvas(
    page,
    options.origin,
    { x: options.origin.x + width, y: options.origin.y + height },
    12,
  );
  await fitArtboard(page);

  await expect
    .poll(async () => (await getEditorGeometry(page)).seats.length, { timeout: 10_000 })
    .toBe(seatsBefore + options.totalSeats);
}

export async function marqueeSelect(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await activateTool(page, 'select');
  await dragOnCanvas(page, from, to, 12);
}

export async function expectSeatCount(page: Page, count: number) {
  await expect.poll(async () => (await getEditorGeometry(page)).seats.length).toBe(count);
}

export async function expectNoOverlaps(page: Page) {
  const geometry = await getEditorGeometry(page);
  assertNoSeatOverlaps(geometry.seats);
}

export async function saveMap(page: Page) {
  await page.getByTestId('save-map-button').click();
  await page.waitForResponse(
    (response) =>
      response.url().includes('/api/events/') &&
      response.url().includes('/maps/') &&
      response.request().method() === 'PATCH' &&
      response.ok(),
    { timeout: 20_000 },
  );
}

export async function deleteSelection(page: Page) {
  await page.keyboard.press('Backspace');
}

export async function undo(page: Page) {
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+Z' : 'Control+Z');
}

export async function redo(page: Page) {
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+Shift+Z' : 'Control+Shift+Z');
}

export async function getMapSnapshotViaApi(page: Page, scenario: EditorScenario) {
  const response = await page.request.get(`/api/events/${scenario.eventId}/maps/${scenario.mapId}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.data ?? body;
}
