import { expect, test } from '@playwright/test';

import {
  activateTool,
  assertCorridorPanelHasOnlySpacing,
  createCorridor,
  createSeatGrid,
  deleteSelection,
  dragCorridorByIndex,
  dragOnCanvas,
  expectNoOverlaps,
  expectSeatCount,
  fitArtboard,
  getEditorGeometry,
  getMapSnapshotViaApi,
  marqueeSelect,
  openEventMapEditor,
  redo,
  saveMap,
  seedEmptyMapEditor,
  selectCorridorByIndex,
  setCorridorSpacing,
  type EditorScenario,
  undo,
  waitForEditorBridge,
} from './helpers/event-map-editor';
import {
  columnGapCenter,
  findSeat,
  gapBetweenHorizontal,
  gapBetweenVertical,
  geometrySnapshot,
  rowGapCenter,
  roundGeometry,
  seatsInColumn,
  seatsInRow,
} from './helpers/geometry';

const GRID = {
  origin: { x: 320, y: 180 },
  totalSeats: 100,
  rows: 10,
  columns: 10,
  seatSize: 24,
  horizontalSpacing: 42,
  verticalSpacing: 42,
} as const;

async function setupEditorWithGrid(page: import('@playwright/test').Page, label: string) {
  const scenario = await seedEmptyMapEditor(page, label);
  await openEventMapEditor(page, scenario);
  await createSeatGrid(page, { ...GRID, origin: GRID.origin });
  const geometry = await getEditorGeometry(page);
  return { scenario, geometry };
}

test.describe('Event map smart corridors', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('setup loads editor bridge and creates a 10x10 seat grid', async ({ page }) => {
    await test.step('Authenticate and open clean editor', async () => {
      const scenario = await seedEmptyMapEditor(page, 'setup');
      await openEventMapEditor(page, scenario);
      await waitForEditorBridge(page);
    });

    await test.step('Create 100-seat grid via UI', async () => {
      await createSeatGrid(page, { ...GRID, origin: GRID.origin });
      await expectSeatCount(page, 100);
    });

    await test.step('Validate grid structure via debug geometry', async () => {
      const geometry = await getEditorGeometry(page);
      expect(new Set(geometry.seats.map((seat) => seat.rowLabel)).size).toBe(10);
      expect(new Set(geometry.seats.map((seat) => seat.seatNumber)).size).toBe(10);
      expect(findSeat(geometry.seats, 'A', 1).label).toMatch(/A1/);
      expect(findSeat(geometry.seats, 'A', 10).label).toMatch(/A10/);
      expect(findSeat(geometry.seats, 'J', 1).label).toMatch(/J1/);
      expect(findSeat(geometry.seats, 'J', 10).label).toMatch(/J10/);
      await expectNoOverlaps(page);
    });
  });

  test('vertical corridor drag reflows seats responsively and preserves spacing contract', async ({ page }) => {
    test.slow();
    const { geometry: baseGeometry } = await setupEditorWithGrid(page, 'vertical-drag');
    const gap = columnGapCenter(baseGeometry.seats, 4, 5, 'A');
    const baselineSeats = baseGeometry.seats;

    await test.step('Create vertical corridor outside the grid', async () => {
      await createCorridor(
        page,
        { x: gap.x - 120, y: GRID.origin.y - 30 },
        { x: gap.x - 88, y: GRID.origin.y + GRID.verticalSpacing * 9 + 30 },
      );
    });

    await test.step('Drag corridor into column gap with live preview', async () => {
      await dragCorridorByIndex(page, 0, { x: 120, y: 0 }, { assertDuringDrag: true, baselineSeats });
    });

    await test.step('Validate final geometry', async () => {
      const geometry = await getEditorGeometry(page);
      const corridor = geometry.corridors[0]!;
      expect(corridor.rotation).toBe(0);

      const left = findSeat(geometry.seats, 'A', 4);
      const right = findSeat(geometry.seats, 'A', 5);
      const edgeGap = gapBetweenHorizontal(left.bounds, right.bounds);
      const thickness = corridor.coreRect.width;
      const spacingLeft = Number(corridor.data.seatGapLeft ?? 8);
      const spacingRight = Number(corridor.data.seatGapRight ?? 8);

      expect(edgeGap).toBeGreaterThanOrEqual(thickness + spacingLeft + spacingRight - 0.5);
      expect(seatsInRow(geometry.seats, 'A').map((seat) => Number(seat.seatNumber))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      await expectNoOverlaps(page);
    });
  });

  test('horizontal corridor drag reflows rows and keeps labels ordered', async ({ page }) => {
    test.slow();
    const { geometry: baseGeometry } = await setupEditorWithGrid(page, 'horizontal-drag');
    const gap = rowGapCenter(baseGeometry.seats, 'D', 'E', 1);
    const baselineSeats = baseGeometry.seats;

    await createCorridor(
      page,
      { x: GRID.origin.x - 40, y: gap.y - 120 },
      { x: GRID.origin.x + GRID.horizontalSpacing * 9 + 40, y: gap.y - 88 },
    );

    await dragCorridorByIndex(page, 0, { x: 0, y: 120 }, { assertDuringDrag: true, baselineSeats });

    const geometry = await getEditorGeometry(page);
    const corridor = geometry.corridors[0]!;
    const top = findSeat(geometry.seats, 'D', 1);
    const bottom = findSeat(geometry.seats, 'E', 1);
    const edgeGap = gapBetweenVertical(top.bounds, bottom.bounds);
    const thickness = corridor.coreRect.height;
    const spacingTop = Number(corridor.data.seatGapTop ?? 8);
    const spacingBottom = Number(corridor.data.seatGapBottom ?? 8);

    expect(corridor.rotation).toBe(0);
    expect(edgeGap).toBeGreaterThanOrEqual(thickness + spacingTop + spacingBottom - 0.5);
    expect(seatsInColumn(geometry.seats, 1).map((seat) => seat.rowLabel)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    ]);
    await expectNoOverlaps(page);
  });

  test('vertical and horizontal corridors intersect without seat overlap', async ({ page }) => {
    test.slow();
    const { geometry: baseGeometry } = await setupEditorWithGrid(page, 'intersection');
    const verticalGap = columnGapCenter(baseGeometry.seats, 4, 5, 'E');
    const horizontalGap = rowGapCenter(baseGeometry.seats, 'D', 'E', 5);

    await createCorridor(
      page,
      { x: verticalGap.x - 16, y: GRID.origin.y - 20 },
      { x: verticalGap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await createCorridor(
      page,
      { x: GRID.origin.x - 40, y: horizontalGap.y - 16 },
      { x: GRID.origin.x + GRID.horizontalSpacing * 9 + 40, y: horizontalGap.y + 16 },
    );

    const before = geometrySnapshot((await getEditorGeometry(page)).seats);
    await fitArtboard(page);
    const after = geometrySnapshot((await getEditorGeometry(page)).seats);
    expect(after).toEqual(before);

    await expectNoOverlaps(page);
  });

  test('two selected corridors move together and keep spacing valid', async ({ page }) => {
    test.slow();
    const { geometry: baseGeometry } = await setupEditorWithGrid(page, 'multi-corridor');
    const gapLeft = columnGapCenter(baseGeometry.seats, 3, 4, 'A');
    const gapRight = columnGapCenter(baseGeometry.seats, 7, 8, 'A');

    await createCorridor(
      page,
      { x: gapLeft.x - 16, y: GRID.origin.y - 20 },
      { x: gapLeft.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await createCorridor(
      page,
      { x: gapRight.x - 16, y: GRID.origin.y - 20 },
      { x: gapRight.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );

    await marqueeSelect(
      page,
      { x: gapLeft.x - 80, y: GRID.origin.y - 60 },
      { x: gapRight.x + 80, y: GRID.origin.y + 420 },
    );

    const before = geometrySnapshot((await getEditorGeometry(page)).seats);
    const corridorsBeforeDrag = await getEditorGeometry(page);
    const leftCorridor = corridorsBeforeDrag.corridors[0]!;
    const dragFrom = {
      x: leftCorridor.coreRect.x + leftCorridor.coreRect.width / 2,
      y: leftCorridor.coreRect.y + leftCorridor.coreRect.height / 2,
    };
    await dragOnCanvas(page, dragFrom, { x: dragFrom.x + 42, y: dragFrom.y }, 16);
    const after = geometrySnapshot((await getEditorGeometry(page)).seats);

    expect(after).not.toEqual(before);
    const geometry = await getEditorGeometry(page);
    for (const corridor of geometry.corridors) {
      expect(corridor.rotation).toBe(0);
      expect(corridor.coreRect.width).toBeGreaterThanOrEqual(8);
      expect(Number(corridor.data.corridorThickness)).toBeGreaterThanOrEqual(8);
    }
    await expectNoOverlaps(page);
    expect(geometry.corridors).toHaveLength(2);
  });

  test('intersected corridors move as a group without layout drift', async ({ page }) => {
    test.slow();
    const { geometry: baseGeometry } = await setupEditorWithGrid(page, 'intersection-move');
    const verticalGap = columnGapCenter(baseGeometry.seats, 5, 6, 'F');
    const horizontalGap = rowGapCenter(baseGeometry.seats, 'E', 'F', 5);

    await createCorridor(
      page,
      { x: verticalGap.x - 16, y: GRID.origin.y - 20 },
      { x: verticalGap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await createCorridor(
      page,
      { x: GRID.origin.x - 40, y: horizontalGap.y - 16 },
      { x: GRID.origin.x + GRID.horizontalSpacing * 9 + 40, y: horizontalGap.y + 16 },
    );

    await marqueeSelect(
      page,
      { x: verticalGap.x - 60, y: horizontalGap.y - 60 },
      { x: verticalGap.x + 60, y: horizontalGap.y + 60 },
    );

    const snapshotBeforeMove = geometrySnapshot((await getEditorGeometry(page)).seats);
    await dragOnCanvas(page, { x: verticalGap.x, y: horizontalGap.y }, { x: verticalGap.x + 84, y: horizontalGap.y + 42 }, 18);
    const snapshotAfterMove = geometrySnapshot((await getEditorGeometry(page)).seats);

    expect(snapshotAfterMove).not.toEqual(snapshotBeforeMove);
    await expectNoOverlaps(page);
  });

  test('properties panel exposes only seat spacing controls for corridors', async ({ page }) => {
    const { geometry } = await setupEditorWithGrid(page, 'panel');
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await selectCorridorByIndex(page, 0);
    await assertCorridorPanelHasOnlySpacing(page);

    await setCorridorSpacing(page, { top: 16, right: 24, bottom: 16, left: 24 });

    const updated = await getEditorGeometry(page);
    const corridor = updated.corridors[0]!;
    expect(Number(corridor.data.seatGapTop)).toBe(16);
    expect(Number(corridor.data.seatGapRight)).toBe(24);
    expect(Number(corridor.data.seatGapBottom)).toBe(16);
    expect(Number(corridor.data.seatGapLeft)).toBe(24);

    const left = findSeat(updated.seats, 'A', 4);
    const right = findSeat(updated.seats, 'A', 5);
    const edgeGap = gapBetweenHorizontal(left.bounds, right.bounds);
    expect(edgeGap).toBeGreaterThanOrEqual(corridor.coreRect.width + 24 + 24 - 0.5);
    await expectNoOverlaps(page);
  });

  test('undo and redo restore corridor layout snapshots', async ({ page }) => {
    test.slow();
    const { geometry } = await setupEditorWithGrid(page, 'undo-redo');
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );

    const beforeMove = geometrySnapshot((await getEditorGeometry(page)).seats);
    await dragCorridorByIndex(page, 0, { x: 42, y: 0 });
    const afterMove = geometrySnapshot((await getEditorGeometry(page)).seats);
    expect(afterMove).not.toEqual(beforeMove);

    await undo(page);
    await expect.poll(async () => geometrySnapshot((await getEditorGeometry(page)).seats)).toEqual(beforeMove);

    await redo(page);
    await expect.poll(async () => geometrySnapshot((await getEditorGeometry(page)).seats)).toEqual(afterMove);
  });

  test('persists smart corridor layout after save and reload', async ({ page }) => {
    test.slow();
    const { scenario, geometry } = await setupEditorWithGrid(page, 'persist');
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await setCorridorSpacing(page, { left: 12, right: 12, top: 12, bottom: 12 });
    await selectCorridorByIndex(page, 0);

    const snapshot = roundGeometry(await getEditorGeometry(page));
    await saveMap(page);
    await page.reload();
    await openEventMapEditor(page, scenario);

    const reloaded = roundGeometry(await getEditorGeometry(page));
    expect(reloaded.seats).toHaveLength(snapshot.seats.length);
    expect(reloaded.corridors).toHaveLength(snapshot.corridors.length);
    for (const corridor of reloaded.corridors) {
      expect(Number(corridor.data.corridorThickness)).toBeGreaterThanOrEqual(8);
      expect(corridor.rotation).toBe(0);
    }
    await expectNoOverlaps(page);
  });

  test('persists spacing and keeps layout valid after save, reload and corridor move', async ({ page }) => {
    test.slow();
    const { scenario, geometry } = await setupEditorWithGrid(page, 'persist-move');
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await setCorridorSpacing(page, { left: 24, right: 24, top: 24, bottom: 24 });
    await saveMap(page);
    await page.reload();
    await openEventMapEditor(page, scenario);

    await dragCorridorByIndex(page, 0, { x: 42, y: 0 });
    const updated = await getEditorGeometry(page);
    expect(Number(updated.corridors[0]?.data.seatGapLeft)).toBe(24);
    expect(Number(updated.corridors[0]?.data.corridorThickness)).toBeGreaterThanOrEqual(8);
    await expectNoOverlaps(page);
  });

  test('two corridors moved together persist without overlap after save and reload', async ({ page }) => {
    test.slow();
    const { scenario, geometry: baseGeometry } = await setupEditorWithGrid(page, 'persist-multi');
    const gapLeft = columnGapCenter(baseGeometry.seats, 3, 4, 'A');
    const gapRight = columnGapCenter(baseGeometry.seats, 7, 8, 'A');

    await createCorridor(
      page,
      { x: gapLeft.x - 16, y: GRID.origin.y - 20 },
      { x: gapLeft.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await createCorridor(
      page,
      { x: gapRight.x - 16, y: GRID.origin.y - 20 },
      { x: gapRight.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );

    await marqueeSelect(
      page,
      { x: gapLeft.x - 80, y: GRID.origin.y - 60 },
      { x: gapRight.x + 80, y: GRID.origin.y + 420 },
    );
    const corridorsBeforeDrag = await getEditorGeometry(page);
    const leftCorridor = corridorsBeforeDrag.corridors[0]!;
    const dragFrom = {
      x: leftCorridor.coreRect.x + leftCorridor.coreRect.width / 2,
      y: leftCorridor.coreRect.y + leftCorridor.coreRect.height / 2,
    };
    await dragOnCanvas(
      page,
      dragFrom,
      { x: dragFrom.x + 42, y: dragFrom.y },
      16,
    );
    await saveMap(page);
    await page.reload();
    await openEventMapEditor(page, scenario);

    const geometry = await getEditorGeometry(page);
    expect(geometry.corridors).toHaveLength(2);
    for (const corridor of geometry.corridors) {
      expect(corridor.rotation).toBe(0);
      expect(corridor.coreRect.width).toBeGreaterThanOrEqual(8);
      expect(Number(corridor.data.corridorThickness)).toBeGreaterThanOrEqual(8);
    }
    await expectNoOverlaps(page);
  });

  test('removing corridor restores base seat layout', async ({ page }) => {
    const { geometry } = await setupEditorWithGrid(page, 'remove');
    const baseSnapshot = geometrySnapshot(geometry.seats);
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await selectCorridorByIndex(page, 0);
    await deleteSelection(page);

    await expect.poll(async () => (await getEditorGeometry(page)).corridors.length).toBe(0);
    await expect.poll(async () => geometrySnapshot((await getEditorGeometry(page)).seats)).toEqual(baseSnapshot);
  });

  test('corridor outside grid does not deform seats', async ({ page }) => {
    const { geometry } = await setupEditorWithGrid(page, 'outside');
    const baseSnapshot = geometrySnapshot(geometry.seats);

    await createCorridor(page, { x: 40, y: 40 }, { x: 72, y: 420 });
    await dragCorridorByIndex(page, 0, { x: -120, y: 0 });

    await expect.poll(async () => geometrySnapshot((await getEditorGeometry(page)).seats)).toEqual(baseSnapshot);
  });

  test('partial vertical corridor affects only crossed rows', async ({ page }) => {
    test.slow();
    const { geometry } = await setupEditorWithGrid(page, 'partial-vertical');
    const baseByRow = new Map(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((row) => [
        row,
        findSeat(geometry.seats, row, 1).x,
      ]),
    );
    const gap = columnGapCenter(geometry.seats, 4, 5, 'D');
    const rowDY = findSeat(geometry.seats, 'D', 1).y;
    const rowFY = findSeat(geometry.seats, 'F', 1).y;

    await createCorridor(
      page,
      { x: gap.x - 16, y: rowDY - 20 },
      { x: gap.x + 16, y: rowFY + 20 },
    );

    const updated = await getEditorGeometry(page);
    expect(findSeat(updated.seats, 'A', 1).x).toBeCloseTo(baseByRow.get('A')!, 0);
    expect(findSeat(updated.seats, 'J', 1).x).toBeCloseTo(baseByRow.get('J')!, 0);
    expect(findSeat(updated.seats, 'D', 5).x).toBeGreaterThan(findSeat(geometry.seats, 'D', 5).x);
    await expectNoOverlaps(page);
  });

  test('marquee resize with corridors keeps layout stable or blocks safely', async ({ page }) => {
    test.slow();
    const { geometry } = await setupEditorWithGrid(page, 'marquee-resize');
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');

    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );

    await expectNoOverlaps(page);
    const before = geometrySnapshot((await getEditorGeometry(page)).seats);

    const seats = await getEditorGeometry(page);
    const minX = Math.min(...seats.seats.map((seat) => seat.bounds.x));
    const minY = Math.min(...seats.seats.map((seat) => seat.bounds.y));
    const maxX = Math.max(...seats.seats.map((seat) => seat.bounds.x + seat.bounds.width));
    const maxY = Math.max(...seats.seats.map((seat) => seat.bounds.y + seat.bounds.height));

    await marqueeSelect(page, { x: minX - 20, y: minY - 20 }, { x: maxX + 20, y: maxY + 20 });

    const afterSelect = geometrySnapshot((await getEditorGeometry(page)).seats);
    expect(afterSelect).toEqual(before);

    const corridor = seats.corridors[0]!;
    const dragFrom = {
      x: corridor.coreRect.x + corridor.coreRect.width / 2,
      y: corridor.coreRect.y + corridor.coreRect.height / 2,
    };
    await dragOnCanvas(page, dragFrom, { x: dragFrom.x + 42, y: dragFrom.y }, 12);

    const afterDrag = geometrySnapshot((await getEditorGeometry(page)).seats);
    expect(afterDrag).not.toEqual(before);
    await expectNoOverlaps(page);
  });
});

test.describe('Event map smart corridors API regression', () => {
  test('saved map keeps 100 seats after corridor workflow', async ({ page }) => {
    const scenario = await seedEmptyMapEditor(page, 'api-regression');
    await openEventMapEditor(page, scenario);
    await createSeatGrid(page, { ...GRID, origin: GRID.origin });

    const geometry = await getEditorGeometry(page);
    const gap = columnGapCenter(geometry.seats, 4, 5, 'A');
    await createCorridor(
      page,
      { x: gap.x - 16, y: GRID.origin.y - 20 },
      { x: gap.x + 16, y: GRID.origin.y + GRID.verticalSpacing * 9 + 20 },
    );
    await saveMap(page);

    const snap = await getMapSnapshotViaApi(page, scenario);
    expect(snap.seats).toHaveLength(100);
    expect((snap.objects as Array<{ type: string }>).filter((object) => object.type === 'CORRIDOR').length).toBe(1);
  });
});
