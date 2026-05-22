import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { addDays } from 'date-fns';
import { randomUUID } from 'node:crypto';

import { seedAdminAndAuthenticate } from '../utils/auth';
import { resetDb } from '../utils/reset-db';

import {
  assertNoSeatIntersectsCorridors,
  assertNoSeatOverlaps,
  type SeatGeometry,
} from './geometry';

const prisma = new PrismaClient();

export type EditorScenario = {
  contaId: string;
  eventId: string;
  mapId: string;
  mapName: string;
};

export type EditorGeometry = {
  seats: SeatGeometry[];
  corridors: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    data: Record<string, unknown>;
    coreRect: { x: number; y: number; width: number; height: number };
    clearanceRect: { x: number; y: number; width: number; height: number };
  }>;
  sections: Array<{ id: string; x: number; y: number; width: number; height: number }>;
};

export async function seedEmptyMapEditor(page: Page, label: string): Promise<EditorScenario> {
  await resetDb(prisma);

  const { contaId } = await seedAdminAndAuthenticate(page, {
    email: `smart-corridors-${label}-${Date.now()}@e2e.test`,
  });

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

export async function activateTool(page: Page, toolId: 'seat' | 'corridor' | 'select') {
  if (toolId === 'select') {
    await page.getByRole('button', { name: 'Selecionar' }).click();
    return;
  }
  await openPresetsMenu(page);
  await page.getByTestId(`toolbar-${toolId}-tool`).click();
}

export async function createSeatGrid(
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
  await activateTool(page, 'seat');
  await clickMapPoint(page, options.origin);

  const dialog = page.getByTestId('seat-grid-dialog');
  await expect(dialog).toBeVisible({ timeout: 8_000 });

  await dialog.getByTestId('seat-grid-rows').fill(String(options.rows));
  await dialog.getByTestId('seat-grid-columns').fill(String(options.columns));
  await dialog.getByTestId('seat-grid-total-seats').fill(String(options.totalSeats));

  if (options.seatSize != null) {
    await dialog.getByTestId('seat-grid-seat-size').fill(String(options.seatSize));
  }
  if (options.horizontalSpacing != null) {
    await dialog.getByTestId('seat-grid-horizontal-spacing').fill(String(options.horizontalSpacing));
  }
  if (options.verticalSpacing != null) {
    await dialog.getByTestId('seat-grid-vertical-spacing').fill(String(options.verticalSpacing));
  }

  await dialog.getByTestId('seat-grid-submit').click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await fitArtboard(page);

  await expect.poll(async () => (await getEditorGeometry(page)).seats.length, { timeout: 10_000 }).toBe(
    options.totalSeats,
  );
}

export async function createCorridor(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await activateTool(page, 'corridor');
  await dragOnCanvas(page, from, to);
  await activateTool(page, 'select');
  await expect.poll(async () => (await getEditorGeometry(page)).corridors.length, { timeout: 8_000 }).toBeGreaterThan(0);
}

export async function dragCorridorByIndex(
  page: Page,
  index: number,
  delta: { x: number; y: number },
  options?: { assertDuringDrag?: boolean; baselineSeats?: SeatGeometry[] },
) {
  const geometry = await getEditorGeometry(page);
  const corridor = geometry.corridors[index];
  if (!corridor) throw new Error(`Corridor index ${index} not found`);

  const core = corridor.coreRect;
  const from = { x: core.x + core.width / 2, y: core.y + core.height / 2 };
  const to = { x: from.x + delta.x, y: from.y + delta.y };

  const startViewport = await mapPointToViewport(page, from);
  const endViewport = await mapPointToViewport(page, to);

  await page.mouse.move(startViewport.x, startViewport.y);
  await page.mouse.down();

  let responsiveDuringDrag = false;
  for (let step = 1; step <= 16; step += 1) {
    const x = startViewport.x + ((endViewport.x - startViewport.x) * step) / 16;
    const y = startViewport.y + ((endViewport.y - startViewport.y) * step) / 16;
    await page.mouse.move(x, y);

    if (options?.assertDuringDrag && options.baselineSeats && step > 2 && step < 16) {
      const current = await getEditorGeometry(page);
      const moved = current.seats.some((seat) => {
        const baseline = options.baselineSeats!.find((entry) => entry.id === seat.id);
        return baseline && (Math.abs(seat.x - baseline.x) > 0.5 || Math.abs(seat.y - baseline.y) > 0.5);
      });
      if (moved) responsiveDuringDrag = true;
    }
  }

  await page.mouse.up();

  if (options?.assertDuringDrag) {
    expect(responsiveDuringDrag, 'Expected seats to reflow during corridor drag preview').toBe(true);
  }
}

export async function selectCorridorByIndex(page: Page, index: number) {
  const geometry = await getEditorGeometry(page);
  const corridor = geometry.corridors[index];
  if (!corridor) throw new Error(`Corridor index ${index} not found`);
  const center = {
    x: corridor.coreRect.x + corridor.coreRect.width / 2,
    y: corridor.coreRect.y + corridor.coreRect.height / 2,
  };
  await activateTool(page, 'select');
  await clickMapPoint(page, center);
}

export async function marqueeSelect(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await activateTool(page, 'select');
  await dragOnCanvas(page, from, to, 12);
}

export async function setCorridorSpacing(
  page: Page,
  spacing: { top?: number; right?: number; bottom?: number; left?: number },
) {
  if (spacing.top != null) {
    const input = page.getByTestId('corridor-seat-gap-top');
    await input.click({ clickCount: 3 });
    await input.fill(String(spacing.top));
    await input.press('Tab');
  }
  if (spacing.right != null) {
    const input = page.getByTestId('corridor-seat-gap-right');
    await input.click({ clickCount: 3 });
    await input.fill(String(spacing.right));
    await input.press('Tab');
  }
  if (spacing.bottom != null) {
    const input = page.getByTestId('corridor-seat-gap-bottom');
    await input.click({ clickCount: 3 });
    await input.fill(String(spacing.bottom));
    await input.press('Tab');
  }
  if (spacing.left != null) {
    const input = page.getByTestId('corridor-seat-gap-left');
    await input.click({ clickCount: 3 });
    await input.fill(String(spacing.left));
    await input.press('Tab');
  }
}

export async function expectSeatCount(page: Page, count: number) {
  await expect.poll(async () => (await getEditorGeometry(page)).seats.length).toBe(count);
}

export async function expectNoOverlaps(page: Page) {
  const geometry = await getEditorGeometry(page);
  assertNoSeatOverlaps(geometry.seats);
  assertNoSeatIntersectsCorridors(geometry.seats, geometry.corridors);
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

export async function assertCorridorPanelHasOnlySpacing(page: Page) {
  const panel = page.getByTestId('properties-panel');
  await expect(panel.getByRole('heading', { name: 'Espaçamento dos assentos' })).toBeVisible();
  await expect(panel.getByText('Orientação')).toHaveCount(0);
  await expect(panel.getByText('Ajustar ao gap')).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Corredor' })).toHaveCount(0);
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
