import { expect, test, type Page } from '@playwright/test';

import {
  activateTool,
  clickMapPoint,
  createSeatGrid,
  dragOnCanvas,
  getCanvasBox,
  getEditorGeometry,
  getEditorState,
  getMapSnapshotViaApi,
  mapPointToViewport,
  openEventMapEditor,
  seedEmptyMapEditor,
  type EditorScenario,
} from './helpers/event-map-editor';

type DraftShape = {
  id: string;
  levelId: string;
  sectionId: string | null;
  type: 'GENERAL_AREA' | 'SECTION' | 'CORRIDOR';
  data: Record<string, unknown>;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  sortOrder: number;
};

const SHAPE_A = 'shape-a';
const SHAPE_B = 'shape-b';
const SECTION_ID = 'section-loose';
const SECTION_FRAME_ID = 'section-frame-loose';
const CORRIDOR_ID = 'corridor-loose';

function shape(id: string, levelId: string, x: number, y: number, width = 100, height = 80): DraftShape {
  return {
    id,
    levelId,
    sectionId: null,
    type: 'GENERAL_AREA',
    data: { fill: '#7c3aed', opacity: 0.12 },
    x,
    y,
    width,
    height,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };
}

function visualCenter(object: { x: number; y: number; width: number | null; height: number | null; rotation: number }) {
  const width = object.width ?? 0;
  const height = object.height ?? 0;
  const radians = ((object.rotation ?? 0) * Math.PI) / 180;
  const localX = width / 2;
  const localY = height / 2;
  return {
    x: object.x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: object.y + localX * Math.sin(radians) + localY * Math.cos(radians),
  };
}

function averageCenter(objects: Array<{ x: number; y: number; width: number | null; height: number | null; rotation: number }>) {
  const centers = objects.map(visualCenter);
  return {
    x: centers.reduce((sum, center) => sum + center.x, 0) / centers.length,
    y: centers.reduce((sum, center) => sum + center.y, 0) / centers.length,
  };
}

async function seedDraft(
  page: Page,
  label: string,
  draftInput:
    | {
    objects?: DraftShape[];
    sections?: Array<{
      id: string;
      levelId: string;
      lotId: null;
      name: string;
      color: string;
      capacity: number | null;
      status: string;
      notes: null;
    }>;
    seats?: Array<{
      id: string;
      levelId: string;
      sectionId: string;
      objectId: string | null;
      groupId: string | null;
      rowIndex: number | null;
      columnIndex: number | null;
      technicalCode: string;
      displayLabel: string;
      rowLabel: string | null;
      seatNumber: string | null;
      status: 'AVAILABLE';
      accessible: boolean;
      publicVisible: boolean;
      x: number;
      y: number;
      size: number;
      rotation: number;
    }>;
  }
    | ((levelId: string) => {
        objects?: DraftShape[];
        sections?: Array<{
          id: string;
          levelId: string;
          lotId: null;
          name: string;
          color: string;
          capacity: number | null;
          status: string;
          notes: null;
        }>;
        seats?: Array<{
          id: string;
          levelId: string;
          sectionId: string;
          objectId: string | null;
          groupId: string | null;
          rowIndex: number | null;
          columnIndex: number | null;
          technicalCode: string;
          displayLabel: string;
          rowLabel: string | null;
          seatNumber: string | null;
          status: 'AVAILABLE';
          accessible: boolean;
          publicVisible: boolean;
          x: number;
          y: number;
          size: number;
          rotation: number;
        }>;
      }),
): Promise<{ scenario: EditorScenario; levelId: string }> {
  const scenario = await seedEmptyMapEditor(page, label);
  const current = await getMapSnapshotViaApi(page, scenario);
  const levelId = current.levels[0].id;
  const draft = typeof draftInput === 'function' ? draftInput(levelId) : draftInput;

  const response = await page.request.patch(`/api/events/${scenario.eventId}/maps/${scenario.mapId}`, {
    data: {
      name: current.name,
      levels: current.levels,
      sections: draft.sections ?? [],
      objects: draft.objects ?? [],
      seatGroups: [],
      seats: draft.seats ?? [],
    },
  });

  expect(response.status()).toBe(200);
  return { scenario, levelId };
}

async function getObjects(page: Page) {
  const state = await getEditorState(page);
  return state.map?.objects ?? [];
}

async function getObject(page: Page, id: string) {
  const object = (await getObjects(page)).find((entry) => entry.id === id);
  if (!object) throw new Error(`Object ${id} not found`);
  return object;
}

async function shiftClickMapPoint(page: Page, point: { x: number; y: number }) {
  const viewport = await mapPointToViewport(page, point);
  await page.keyboard.down('Shift');
  await page.mouse.click(viewport.x, viewport.y);
  await page.keyboard.up('Shift');
}

async function selectShapePair(page: Page) {
  await activateTool(page, 'select');
  const first = await getObject(page, SHAPE_A);
  const second = await getObject(page, SHAPE_B);

  await clickMapPoint(page, {
    x: first.x + (first.width ?? 0) / 2,
    y: first.y + (first.height ?? 0) / 2,
  });
  await shiftClickMapPoint(page, {
    x: second.x + (second.width ?? 0) / 2,
    y: second.y + (second.height ?? 0) / 2,
  });

  await expect
    .poll(async () => (await getEditorState(page)).selection.length, { timeout: 5_000 })
    .toBe(2);
}

function watchCriticalPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('Event map editor transform flows', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('multi-object resize uses the whole selection and preserves the untouched axis', async ({ page }) => {
    const errors = watchCriticalPageErrors(page);
    const { scenario } = await seedDraft(page, 'multi-resize', (levelId) => ({
      objects: [
        shape(SHAPE_A, levelId, 320, 220, 100, 80),
        shape(SHAPE_B, levelId, 500, 240, 120, 80),
      ],
    }));
    await openEventMapEditor(page, scenario);
    await selectShapePair(page);

    const beforeA = await getObject(page, SHAPE_A);
    const beforeB = await getObject(page, SHAPE_B);
    const rightEdge = Math.max(beforeA.x + (beforeA.width ?? 0), beforeB.x + (beforeB.width ?? 0));
    const centerY = (Math.min(beforeA.y, beforeB.y) + Math.max(beforeA.y + (beforeA.height ?? 0), beforeB.y + (beforeB.height ?? 0))) / 2;

    await dragOnCanvas(page, { x: rightEdge, y: centerY }, { x: rightEdge + 130, y: centerY }, 24);

    await expect
      .poll(async () => (await getObject(page, SHAPE_B)).width ?? 0, { timeout: 6_000 })
      .toBeGreaterThan((beforeB.width ?? 0) + 40);

    const afterA = await getObject(page, SHAPE_A);
    const afterB = await getObject(page, SHAPE_B);
    expect(afterA.width ?? 0).toBeGreaterThan((beforeA.width ?? 0) + 30);
    expect(afterB.width ?? 0).toBeGreaterThan((beforeB.width ?? 0) + 40);
    expect(Math.abs((afterA.height ?? 0) - (beforeA.height ?? 0))).toBeLessThan(1);
    expect(Math.abs((afterB.height ?? 0) - (beforeB.height ?? 0))).toBeLessThan(1);
    expect(errors.filter((entry) => entry.includes('findOne is not a function'))).toEqual([]);
  });

  test('group rotation keeps the visual center of the selected objects stable', async ({ page }) => {
    const { scenario } = await seedDraft(page, 'multi-rotate', (levelId) => ({
      objects: [
        shape(SHAPE_A, levelId, 320, 230, 70, 70),
        shape(SHAPE_B, levelId, 520, 230, 70, 70),
      ],
    }));
    await openEventMapEditor(page, scenario);
    await selectShapePair(page);

    const before = await getObjects(page);
    const selectedBefore = before.filter((object) => object.id === SHAPE_A || object.id === SHAPE_B);
    const beforeCenter = averageCenter(selectedBefore);
    const minY = Math.min(...selectedBefore.map((object) => object.y));
    const { zoom } = await getEditorState(page);
    const rotateHandle = { x: beforeCenter.x, y: minY - 50 / zoom };

    await dragOnCanvas(page, rotateHandle, { x: beforeCenter.x - 130, y: beforeCenter.y }, 28);

    await expect
      .poll(async () => Math.abs((await getObject(page, SHAPE_A)).rotation), { timeout: 6_000 })
      .toBeGreaterThan(20);

    const after = (await getObjects(page)).filter((object) => object.id === SHAPE_A || object.id === SHAPE_B);
    const afterCenter = averageCenter(after);
    expect(Math.abs(afterCenter.x - beforeCenter.x)).toBeLessThan(8);
    expect(Math.abs(afterCenter.y - beforeCenter.y)).toBeLessThan(8);
  });

  test('magnetic guides snap a dragged object to nearby object edges', async ({ page }) => {
    const { scenario } = await seedDraft(page, 'snap-guides', (levelId) => ({
      objects: [
        shape(SHAPE_A, levelId, 300, 220, 100, 80),
        shape(SHAPE_B, levelId, 510, 220, 90, 80),
      ],
    }));
    await openEventMapEditor(page, scenario);
    await activateTool(page, 'select');

    await clickMapPoint(page, { x: 555, y: 260 });
    await dragOnCanvas(page, { x: 555, y: 260 }, { x: 446, y: 260 }, 20);

    await expect
      .poll(async () => Math.abs(((await getObject(page, SHAPE_B)).x ?? 0) - 400), { timeout: 6_000 })
      .toBeLessThanOrEqual(1.5);
  });

  test('double-clicking a seat inside a seat group selects the individual seat properties', async ({ page }) => {
    const scenario = await seedEmptyMapEditor(page, 'seat-double-click');
    await openEventMapEditor(page, scenario);
    await createSeatGrid(page, {
      origin: { x: 360, y: 240 },
      totalSeats: 4,
      rows: 2,
      columns: 2,
      seatSize: 28,
      horizontalSpacing: 18,
      verticalSpacing: 16,
    });
    await activateTool(page, 'select');

    const seat = (await getEditorGeometry(page)).seats.find((entry) => entry.rowLabel === 'A' && entry.seatNumber === '1');
    expect(seat).toBeTruthy();
    const point = await mapPointToViewport(page, { x: seat!.x, y: seat!.y });
    await page.mouse.dblclick(point.x, point.y);

    await expect
      .poll(async () => (await getEditorState(page)).selection[0]?.type, { timeout: 5_000 })
      .toBe('seat');

    const panel = page.getByTestId('properties-panel');
    await expect(panel.getByText('Código técnico')).toBeVisible();
    await expect(panel.getByText('Grupo de cadeiras')).toHaveCount(0);
  });

  test('single-click text editing keeps the typed line visible without horizontal clipping', async ({ page }) => {
    const scenario = await seedEmptyMapEditor(page, 'text-inline');
    await openEventMapEditor(page, scenario);
    const box = await getCanvasBox(page);

    await page.getByLabel('Adicionar texto').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const editor = page.getByTestId('map-text-editor');
    await expect(editor).toBeFocused();
    await editor.pressSequentially('dasdasdasdasdasd');

    await expect
      .poll(
        async () =>
          editor.evaluate((node) => {
            const textarea = node as HTMLTextAreaElement;
            return textarea.clientWidth >= textarea.scrollWidth - 1;
          }),
        { timeout: 5_000 },
      )
      .toBe(true);
  });

  test('dragging a selected corridor together with loose seats keeps the rigid selection coherent', async ({ page }) => {
    const { scenario } = await seedDraft(page, 'corridor-seat-drag', (levelId) => ({
      sections: [
        {
          id: SECTION_ID,
          levelId,
          lotId: null,
          name: 'Setor solto',
          color: '#6d28d9',
          capacity: 8,
          status: 'ACTIVE',
          notes: null,
        },
      ],
      objects: [
        {
          ...shape(SECTION_FRAME_ID, levelId, 290, 190, 310, 190),
          sectionId: SECTION_ID,
          type: 'SECTION',
          data: { fill: '#6d28d9', opacity: 0.12 },
        },
        {
          ...shape(CORRIDOR_ID, levelId, 420, 175, 28, 220),
          type: 'CORRIDOR',
          data: { smartCorridor: true, corridorAxis: 'vertical', corridorThickness: 28 },
          sortOrder: 1,
        },
      ],
      seats: Array.from({ length: 8 }, (_, index) => {
        const row = index < 4 ? 0 : 1;
        const col = index % 4;
        const seatXs = [330, 380, 500, 550] as const;
        const label = `${row === 0 ? 'A' : 'B'}${col + 1}`;
        return {
          id: `loose-seat-${index + 1}`,
          levelId,
          sectionId: SECTION_ID,
          objectId: null,
          groupId: null,
          rowIndex: row,
          columnIndex: col,
          technicalCode: label,
          displayLabel: label,
          rowLabel: row === 0 ? 'A' : 'B',
          seatNumber: String(col + 1),
          status: 'AVAILABLE' as const,
          accessible: false,
          publicVisible: true,
          x: seatXs[col]!,
          y: 235 + row * 70,
          size: 26,
          rotation: 0,
        };
      }),
    }));
    await openEventMapEditor(page, scenario);

    await activateTool(page, 'select');
    await clickMapPoint(page, { x: 330, y: 235 });
    await shiftClickMapPoint(page, { x: 380, y: 235 });
    await shiftClickMapPoint(page, { x: 434, y: 285 });
    await expect
      .poll(async () => (await getEditorState(page)).selection.length, { timeout: 5_000 })
      .toBe(3);

    const beforeGeometry = await getEditorGeometry(page);
    const beforeCorridor = beforeGeometry.corridors.find((entry) => entry.id === CORRIDOR_ID);
    expect(beforeCorridor).toBeTruthy();
    const selectedBeforeSeats = beforeGeometry.seats.filter((seat) => seat.id === 'loose-seat-1' || seat.id === 'loose-seat-2');

    await dragOnCanvas(
      page,
      {
        x: beforeCorridor!.coreRect.x + beforeCorridor!.coreRect.width / 2,
        y: beforeCorridor!.coreRect.y + beforeCorridor!.coreRect.height / 2,
      },
      {
        x: beforeCorridor!.coreRect.x + beforeCorridor!.coreRect.width / 2 + 72,
        y: beforeCorridor!.coreRect.y + beforeCorridor!.coreRect.height / 2 + 24,
      },
      24,
    );

    await expect
      .poll(async () => (await getEditorGeometry(page)).corridors.find((entry) => entry.id === CORRIDOR_ID)?.x ?? 0, {
        timeout: 6_000,
      })
      .not.toBe(beforeCorridor!.x);

    const afterGeometry = await getEditorGeometry(page);
    const afterCorridor = afterGeometry.corridors.find((entry) => entry.id === CORRIDOR_ID)!;
    expect(Math.abs(afterCorridor.x - beforeCorridor!.x)).toBeGreaterThan(20);
    for (const beforeSeat of selectedBeforeSeats) {
      const afterSeat = afterGeometry.seats.find((entry) => entry.id === beforeSeat.id);
      expect(afterSeat).toBeTruthy();
      expect(Math.abs(afterSeat!.x - beforeSeat.x)).toBeGreaterThan(20);
    }
  });
});
