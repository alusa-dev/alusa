import { CORRIDOR_REFLOW_ITERATIONS, MIN_CORRIDOR_THICKNESS, applyCorridorPreviewPatch, applyCorridorReflow, buildSeatGridPreview, buildSmartCorridorDragPreview, buildSmartCorridorTransformPreview, cloneEventMap, effectiveCorridorAxisAtRotation, extractCorridorDragCommitUpdates, extractGroupDragCommitUpdates, getCorridorRenderBounds, getCorridorWorldCenter, getSeatBounds, intersectsRect, readStoredCorridorAxis, resetCorridorPreviewFromBase, resolveCorridorAxis, resolveCorridorDragMode, resolveSmartCorridorLayout, snapSmartCorridorRotation, updateCorridorSplitAnchorsOnDrag } from '../index';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../index';

import { describe, expect, it } from 'vitest';

function createSectionMap(seats: EventSeatDTO[], sectionObject: EventMapObjectDTO): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        lotId: null,
        lot: null,
        name: 'Setor 1',
        color: '#6d28d9',
        capacity: seats.length,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    objects: [sectionObject],
    seatGroups: [],
    seats,
    versions: [],
    counts: { levels: 1, sections: 1, seats: seats.length, availableSeats: seats.length },
  };
}

function corridor(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  data: Record<string, unknown> = {},
): EventMapObjectDTO {
  const axis = width > height ? 'horizontal' : 'vertical';
  return {
    id,
    levelId: 'level-1',
    sectionId: null,
    type: 'CORRIDOR',
    data: { corridorAxis: axis, corridorAutoFit: true, ...data },
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

function buildSeatGridMap(rows: number, columns: number, spacing = 40, seatSize = 20, origin = { x: 100, y: 100 }) {
  const preview = buildSeatGridPreview(
    origin,
    {
      totalSeats: rows * columns,
      rows,
      columns,
      seatSize,
      horizontalSpacing: spacing,
      verticalSpacing: spacing,
      rowPrefix: 'A',
      startNumber: 1,
      numberingDirection: 'left-to-right',
    },
  );

  const seats: EventSeatDTO[] = preview.map((draft, index) => ({
    id: `seat-${index + 1}`,
    levelId: 'level-1',
    sectionId: 'section-1',
    objectId: null,
    groupId: null,
    rowIndex: draft.rowIndex,
    columnIndex: draft.columnIndex,
    technicalCode: draft.technicalCode,
    displayLabel: draft.displayLabel,
    rowLabel: draft.rowLabel,
    seatNumber: draft.seatNumber,
    status: 'AVAILABLE' as const,
    accessible: false,
    publicVisible: true,
    x: draft.x,
    y: draft.y,
    size: draft.size,
    rotation: 0,
  }));

  const seatBounds = seats.map((seat) => getSeatBounds(seat));
  const minX = Math.min(...seatBounds.map((bounds) => bounds.x));
  const minY = Math.min(...seatBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...seatBounds.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...seatBounds.map((bounds) => bounds.y + bounds.height));

  const sectionObject: EventMapObjectDTO = {
    id: 'section-object-1',
    levelId: 'level-1',
    sectionId: 'section-1',
    type: 'SECTION',
    data: { label: 'Setor 1', fill: '#6d28d9', opacity: 0.1 },
    x: minX - 24,
    y: minY - 24,
    width: maxX - minX + 48,
    height: maxY - minY + 48,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
  };

  return createSectionMap(seats, sectionObject);
}

function seatsByColumn(seats: EventSeatDTO[], column: number) {
  return seats
    .filter((seat) => Number(seat.seatNumber) === column)
    .sort((left, right) => String(left.rowLabel ?? '').localeCompare(String(right.rowLabel ?? '')));
}

function corridorBounds(object: EventMapObjectDTO) {
  return {
    x: object.x,
    y: object.y,
    width: object.width ?? 0,
    height: object.height ?? 0,
  };
}

function assertNoSeatIntersectsCorridors(map: EventMapDTO) {
  const corridors = map.objects.filter((object) => object.type === 'CORRIDOR');

  for (const corridorObject of corridors) {
    const layout = resolveSmartCorridorLayout(corridorObject);

    for (const seat of map.seats) {
      const seatBounds = getSeatBounds(seat);
      const intersectsCore = intersectsRect(seatBounds, layout.coreRect);
      const intersectsClearance = intersectsRect(seatBounds, layout.clearanceRect);

      expect(intersectsRect(seatBounds, layout.coreRect)).toBe(false);
      expect(intersectsRect(seatBounds, layout.clearanceRect)).toBe(false);
    }
  }
}

describe('corridor-reflow', () => {
  it('opens a gap for a single corridor and restores seats when it is removed', () => {
    const map = buildSeatGridMap(2, 4);
    const baseSeats = map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));

    map.objects.push(corridor('corridor-1', 135, 70, 30, 120));
    applyCorridorReflow(map);

    expect(map.seats.some((seat, index) => seat.x !== baseSeats[index]?.x || seat.y !== baseSeats[index]?.y)).toBe(true);
    expect(map.seats[1]!.x - map.seats[0]!.x).toBeGreaterThanOrEqual(40);

    map.objects = map.objects.filter((object) => object.id !== 'corridor-1');
    applyCorridorReflow(map);

    expect(map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }))).toEqual(baseSeats);
  });

  it('opens consistent gaps for two vertical corridors in the same grid', () => {
    const map = buildSeatGridMap(7, 13);
    const baseSeats = map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));

    map.objects.push(corridor('corridor-left', 195, 80, 30, 300));
    map.objects.push(corridor('corridor-right', 475, 80, 30, 300));
    applyCorridorReflow(map);

    const rowA = map.seats.filter((seat) => seat.rowLabel === 'A').sort((a, b) => Number(a.seatNumber) - Number(b.seatNumber));
    const gaps = rowA.slice(1).map((seat, index) => seat.x - rowA[index]!.x);

    expect(gaps.every((gap) => gap >= 40)).toBe(true);

    const col3 = seatsByColumn(map.seats, 3)[0]!;
    const col4 = seatsByColumn(map.seats, 4)[0]!;
    const col10 = seatsByColumn(map.seats, 10)[0]!;
    const col11 = seatsByColumn(map.seats, 11)[0]!;

    const col3Bounds = getSeatBounds(col3);
    const col4Bounds = getSeatBounds(col4);
    const col10Bounds = getSeatBounds(col10);
    const col11Bounds = getSeatBounds(col11);

    expect(col4Bounds.x - (col3Bounds.x + col3Bounds.width)).toBeGreaterThanOrEqual(30);
    expect(col11Bounds.x - (col10Bounds.x + col10Bounds.width)).toBeGreaterThanOrEqual(30);

    const baseCol4 = baseSeats.find((seat) => seat.id === col4.id)!;
    const baseCol10 = baseSeats.find((seat) => seat.id === col10.id)!;
    expect(col4.x).toBeGreaterThan(baseCol4.x);
    expect(col10.x).toBeGreaterThan(baseCol10.x);

    map.objects = map.objects.filter((object) => object.type !== 'CORRIDOR');
    applyCorridorReflow(map);
    expect(map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }))).toEqual(baseSeats);
  });

  it('uses per-side corridor spacing controls when recalculating seats', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(corridor('corridor-1', 135, 70, 30, 120));

    applyCorridorReflow(map);
    const readGap = () => {
      const col1 = map.seats.find((seat) => seat.seatNumber === '1')!;
      const col2 = map.seats.find((seat) => seat.seatNumber === '2')!;
      const col1Bounds = getSeatBounds(col1);
      const col2Bounds = getSeatBounds(col2);
      return col2Bounds.x - (col1Bounds.x + col1Bounds.width);
    };

    const defaultGap = readGap();

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1');
    expect(corridorObject).toBeTruthy();
    if (!corridorObject) return;

    corridorObject.data = { ...corridorObject.data, seatGapLeft: 40 };
    applyCorridorReflow(map);

    const widerGap = readGap();

    expect(widerGap).toBeGreaterThan(defaultGap);
  });

  it('centers corridor objects in opened gaps without overlapping seats', () => {
    const map = buildSeatGridMap(7, 13);
    map.objects.push(corridor('corridor-left', 195, 80, 30, 300));
    map.objects.push(corridor('corridor-right', 475, 80, 30, 300));
    applyCorridorReflow(map);

    for (const corridorObject of map.objects.filter((object) => object.type === 'CORRIDOR')) {
      for (const seat of map.seats) {
        expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
      }
    }
  });

  it('partitions a 13-column grid into 3 | corridor | 7 | corridor | 3 blocks', () => {
    const map = buildSeatGridMap(7, 13);
    map.objects.push(corridor('corridor-left', 205, 80, 32, 280, { corridorAxis: 'vertical' }));
    map.objects.push(corridor('corridor-right', 485, 80, 32, 280, { corridorAxis: 'vertical' }));
    applyCorridorReflow(map);

    const rowA = map.seats.filter((seat) => seat.rowLabel === 'A').sort((a, b) => Number(a.seatNumber) - Number(b.seatNumber));
    const leftBlock = rowA.slice(0, 3);
    const middleBlock = rowA.slice(3, 10);
    const rightBlock = rowA.slice(10);

    expect(leftBlock.map((seat) => Number(seat.seatNumber))).toEqual([1, 2, 3]);
    expect(middleBlock.map((seat) => Number(seat.seatNumber))).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(rightBlock.map((seat) => Number(seat.seatNumber))).toEqual([11, 12, 13]);

    const leftBounds = getSeatBounds(leftBlock[2]!);
    const middleStartBounds = getSeatBounds(middleBlock[0]!);
    const middleEndBounds = getSeatBounds(middleBlock[6]!);
    const rightBounds = getSeatBounds(rightBlock[0]!);

    const gapAfterLeft = middleStartBounds.x - (leftBounds.x + leftBounds.width);
    const gapBeforeRight = rightBounds.x - (middleEndBounds.x + middleEndBounds.width);
    expect(gapAfterLeft).toBeGreaterThanOrEqual(30);
    expect(gapBeforeRight).toBeGreaterThanOrEqual(30);
  });

  it('preserves vertical corridor dimensions while snapping inside the opened gap', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(
      corridor('corridor-1', 135, 70, 30, 120, {
        corridorAxis: 'vertical',
        corridorAutoFit: true,
        seatGapLeft: 8,
        seatGapRight: 8,
        corridorThickness: 32,
      }),
    );
    applyCorridorReflow(map);

    const col1 = map.seats.find((seat) => seat.seatNumber === '1')!;
    const col2 = map.seats.find((seat) => seat.seatNumber === '2')!;
    const col1Bounds = getSeatBounds(col1);
    const col2Bounds = getSeatBounds(col2);
    const gapStart = col1Bounds.x + col1Bounds.width;
    const gapEnd = col2Bounds.x;
    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;

    expect(gapEnd - gapStart).toBeGreaterThanOrEqual(8 + 30 + 8);
    expect(corridorObject.x).toBeGreaterThanOrEqual(gapStart + 8 - 0.05);
    expect(corridorObject.x).toBeLessThanOrEqual(gapEnd - 8 - 30 + 0.05);
    expect(corridorObject.width).toBeCloseTo(30, 1);
    expect(corridorObject.height).toBeCloseTo(120, 1);

    for (const seat of map.seats) {
      expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
    }
  });

  it('keeps render bounds and split anchor aligned after reflow snap', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(
      corridor('corridor-1', 135, 70, 30, 120, {
        corridorAxis: 'vertical',
        seatGapLeft: 8,
        seatGapRight: 8,
      }),
    );

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;
    const layout = resolveSmartCorridorLayout(corridorObject);
    const renderBounds = getCorridorRenderBounds(corridorObject);

    expect(renderBounds.x).toBeCloseTo(layout.coreRect.x, 1);
    expect(renderBounds.y).toBeCloseTo(layout.coreRect.y, 1);
    expect(Number(corridorObject.data.corridorSplitX)).toBeCloseTo(layout.coreRect.x + layout.coreRect.width / 2, 1);
    expect(Number(corridorObject.data.corridorSplitY)).toBeCloseTo(layout.coreRect.y + layout.coreRect.height / 2, 1);
  });

  it('commits drag preview geometry with aligned render bounds and split anchor', () => {
    const baseMap = buildSeatGridMap(2, 4);
    baseMap.objects.push(
      corridor('corridor-1', 135, 70, 30, 120, {
        corridorAxis: 'vertical',
        seatGapLeft: 8,
        seatGapRight: 8,
      }),
    );

    const preview = buildSmartCorridorDragPreview(
      baseMap,
      {
        origin: new Map([['node-corridor-1', { x: 135, y: 70 }]]),
        delta: { x: 48, y: 0 },
      },
      ['node-corridor-1'],
    );

    const { objects } = extractCorridorDragCommitUpdates(baseMap, preview, ['corridor-1']);
    expect(objects).toHaveLength(1);

    const committed = {
      ...baseMap.objects.find((object) => object.id === 'corridor-1')!,
      ...objects[0]!.patch,
    } as EventMapObjectDTO;

    const renderBounds = getCorridorRenderBounds(committed);

    expect(renderBounds.x).toBeCloseTo(Number(committed.data.corridorSplitX) - committed.width! / 2, 1);
    expect(renderBounds.y).toBeCloseTo(Number(committed.data.corridorSplitY) - committed.height! / 2, 1);
  });

  it('reuses preview map buffers across drag frames without cloning the base map', () => {
    const baseMap = buildSeatGridMap(2, 4);
    baseMap.objects.push(
      corridor('corridor-1', 135, 70, 30, 120, {
        corridorAxis: 'vertical',
        seatGapLeft: 8,
        seatGapRight: 8,
      }),
    );

    const previewMap = cloneEventMap(baseMap);
    const dragSession = {
      origin: new Map([['node-corridor-1', { x: 135, y: 70 }]]),
      delta: { x: 24, y: 0 },
    };

    const first = buildSmartCorridorDragPreview(baseMap, dragSession, ['node-corridor-1'], {
      previewMap,
      maxIterations: 8,
      activeCorridorIds: ['corridor-1'],
    });
    const second = buildSmartCorridorDragPreview(
      baseMap,
      { ...dragSession, delta: { x: 48, y: 0 } },
      ['node-corridor-1'],
      {
        previewMap,
        maxIterations: 8,
        activeCorridorIds: ['corridor-1'],
      },
    );

    expect(first).toBe(previewMap);
    expect(second).toBe(previewMap);
    expect(first.seats.some((seat, index) => seat.x !== baseMap.seats[index]!.x)).toBe(true);

    resetCorridorPreviewFromBase(previewMap, baseMap);
    expect(previewMap.seats.map((seat) => seat.x)).toEqual(baseMap.seats.map((seat) => seat.x));
    expect(previewMap.objects.find((object) => object.id === 'corridor-1')!.x).toBe(135);
  });

  it('perserves horizontal corridor dimensions while snapping inside the opened gap', () => {
    const map = buildSeatGridMap(4, 5);
    map.objects.push(
      corridor('corridor-1', 90, 125, 280, 32, {
        corridorAxis: 'horizontal',
        corridorAutoFit: true,
        seatGapTop: 8,
        seatGapBottom: 8,
        corridorThickness: 32,
      }),
    );
    applyCorridorReflow(map);

    const rowA = map.seats.filter((seat) => seat.rowLabel === 'A');
    const rowB = map.seats.filter((seat) => seat.rowLabel === 'B');
    const gapStart = Math.max(...rowA.map((seat) => getSeatBounds(seat).y + getSeatBounds(seat).height));
    const gapEnd = Math.min(...rowB.map((seat) => getSeatBounds(seat).y));
    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;

    expect(gapEnd - gapStart).toBeGreaterThanOrEqual(8 + 32 + 8);
    expect(corridorObject.y).toBeGreaterThanOrEqual(gapStart + 8 - 0.05);
    expect(corridorObject.y).toBeLessThanOrEqual(gapEnd - 8 - 32 + 0.05);
    expect(corridorObject.height).toBeCloseTo(32, 1);
    expect(corridorObject.width).toBeCloseTo(280, 1);
  });

  it('persists inferred corridor axis during reflow migration', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push({
      ...corridor('corridor-1', 135, 70, 30, 120),
      data: {},
    });
    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;
    expect(resolveCorridorAxis(corridorObject)).toBe('vertical');
    expect(corridorObject.data.corridorAxis).toBe('vertical');
  });

  it('restores the same vertical gap after moving a corridor away and back', () => {
    const map = buildSeatGridMap(2, 4);
    const baseSeats = map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));

    map.objects.push(corridor('corridor-1', 135, 70, 30, 120, { corridorAxis: 'vertical' }));
    applyCorridorReflow(map);

    const firstGapSeats = map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));
    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;

    corridorObject.x = 320;
    corridorObject.y = 70;
    applyCorridorReflow(map);
    expect(map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }))).toEqual(baseSeats);

    corridorObject.x = 135;
    corridorObject.y = 70;
    applyCorridorReflow(map);
    expect(map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }))).toEqual(firstGapSeats);
  });

  it('respects asymmetric seat gap controls on both sides of a vertical corridor', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(
      corridor('corridor-1', 135, 70, 30, 120, {
        corridorAxis: 'vertical',
        seatGapLeft: 40,
        seatGapRight: 8,
      }),
    );
    applyCorridorReflow(map);

    const col1 = map.seats.find((seat) => seat.seatNumber === '1')!;
    const col2 = map.seats.find((seat) => seat.seatNumber === '2')!;
    const col1Bounds = getSeatBounds(col1);
    const col2Bounds = getSeatBounds(col2);
    const gap = col2Bounds.x - (col1Bounds.x + col1Bounds.width);

    expect(gap).toBeGreaterThanOrEqual(30 + 40 + 8);
  });

  it('keeps vertical auto-fit corridor outside centered seat bounds', () => {
    const map = buildSeatGridMap(7, 13);

    map.objects.push(
      corridor('corridor-left', 205, 80, 32, 280, {
        corridorAxis: 'vertical',
        corridorAutoFit: true,
      }),
    );

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-left')!;

    for (const seat of map.seats) {
      expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
    }
  });

  it('keeps horizontal auto-fit corridor outside centered seat bounds', () => {
    const map = buildSeatGridMap(7, 13);

    map.objects.push(
      corridor('corridor-top', 80, 125, 520, 32, {
        corridorAxis: 'horizontal',
        corridorAutoFit: true,
      }),
    );

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-top')!;

    for (const seat of map.seats) {
      expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
    }
  });

  it('handles connected vertical and horizontal corridors as independent layout obstacles', () => {
    const map = buildSeatGridMap(7, 13);

    map.objects.push(
      corridor('corridor-vertical', 205, 80, 32, 280, {
        corridorAxis: 'vertical',
        corridorAutoFit: true,
      }),
    );

    map.objects.push(
      corridor('corridor-horizontal', 80, 205, 520, 32, {
        corridorAxis: 'horizontal',
        corridorAutoFit: true,
      }),
    );

    applyCorridorReflow(map);

    const corridors = map.objects.filter((object) => object.type === 'CORRIDOR');

    for (const corridorObject of corridors) {
      for (const seat of map.seats) {
        expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
      }
    }

    const rowA = map.seats
      .filter((seat) => seat.rowLabel === 'A')
      .sort((a, b) => Number(a.seatNumber) - Number(b.seatNumber));

    const col1 = map.seats
      .filter((seat) => seat.seatNumber === '1')
      .sort((a, b) => String(a.rowLabel).localeCompare(String(b.rowLabel)));

    const horizontalMovementExists = rowA.some((seat, index) => {
      if (index === 0) return false;
      return seat.x - rowA[index - 1]!.x > 40;
    });

    const verticalMovementExists = col1.some((seat, index) => {
      if (index === 0) return false;
      return seat.y - col1[index - 1]!.y > 40;
    });

    expect(horizontalMovementExists).toBe(true);
    expect(verticalMovementExists).toBe(true);
  });

  it('keeps corridor split anchor stable after repeated auto-fit reflows', () => {
    const map = buildSeatGridMap(7, 13);

    map.objects.push(
      corridor('corridor-1', 205, 80, 32, 280, {
        corridorAxis: 'vertical',
        corridorAutoFit: true,
      }),
    );

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;
    const firstSplit = corridorObject.data.corridorSplitX;
    const firstSeats = map.seats.map((seat) => ({
      id: seat.id,
      x: seat.x,
      y: seat.y,
    }));

    applyCorridorReflow(map);
    applyCorridorReflow(map);

    expect(corridorObject.data.corridorSplitX).toBe(firstSplit);
    expect(
      map.seats.map((seat) => ({
        id: seat.id,
        x: seat.x,
        y: seat.y,
      })),
    ).toEqual(firstSeats);
  });

  it('reflow is idempotent', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(corridor('corridor-1', 135, 70, 30, 120));

    applyCorridorReflow(map);
    const once = map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));
    const onceCorridor = map.objects.find((object) => object.id === 'corridor-1');

    applyCorridorReflow(map);
    applyCorridorReflow(map);

    expect(map.seats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }))).toEqual(once);
    expect(map.objects.find((object) => object.id === 'corridor-1')).toEqual(onceCorridor);
  });

  it('preserves corridor rotation during reflow', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push({
      ...corridor('corridor-1', 135, 70, 30, 120),
      rotation: 90,
    });

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;
    expect(corridorObject.rotation).toBe(90);
    expect(resolveCorridorAxis(corridorObject)).toBe('vertical');
  });

  it('partial vertical corridor affects only overlapped rows', () => {
    const map = buildSeatGridMap(7, 4);
    const baseCol1ByRow = new Map<string, number>();

    for (const seat of map.seats.filter((entry) => entry.seatNumber === '1')) {
      baseCol1ByRow.set(String(seat.rowLabel), seat.x);
    }

    const baseCol2RowC =
      map.seats.find((seat) => seat.rowLabel === 'C' && seat.seatNumber === '2')!.x;

    map.objects.push(corridor('corridor-partial', 135, 155, 30, 80));
    applyCorridorReflow(map);

    const rowACol1 = map.seats.find((seat) => seat.rowLabel === 'A' && seat.seatNumber === '1')!;
    const rowGCol1 = map.seats.find((seat) => seat.rowLabel === 'G' && seat.seatNumber === '1')!;
    const col2RowC = map.seats.find((seat) => seat.rowLabel === 'C' && seat.seatNumber === '2')!;

    expect(rowACol1.x).toBe(baseCol1ByRow.get('A'));
    expect(rowGCol1.x).toBe(baseCol1ByRow.get('G'));
    expect(col2RowC.x).toBeGreaterThan(baseCol2RowC);
  });

  it('does not collapse smart corridor thickness when opened gap is temporarily insufficient', () => {
    const map = buildSeatGridMap(10, 10);

    map.objects.push(
      corridor('corridor-1', 240, 120, 32, 420, {
        smartCorridor: true,
        corridorThickness: 32,
        seatGapLeft: 24,
        seatGapRight: 24,
      }),
    );

    applyCorridorReflow(map);

    const next = map.objects.find((object) => object.id === 'corridor-1')!;

    expect(next.width).toBeGreaterThanOrEqual(32);
    expect(Number(next.data.corridorThickness)).toBeGreaterThanOrEqual(32);
    assertNoSeatIntersectsCorridors(map);
  });

  it('migrates corrupted corridor thickness instead of preserving 1px core', () => {
    const map = buildSeatGridMap(10, 10);

    map.objects.push(
      corridor('corridor-1', 240, 120, 1, 420, {
        smartCorridor: true,
        corridorThickness: 1,
        seatGapLeft: 8,
        seatGapRight: 8,
      }),
    );

    applyCorridorReflow(map);

    const next = map.objects.find((object) => object.id === 'corridor-1')!;
    expect(next.width).toBeGreaterThanOrEqual(MIN_CORRIDOR_THICKNESS);
    expect(Number(next.data.corridorThickness)).toBeGreaterThanOrEqual(MIN_CORRIDOR_THICKNESS);
  });

  it('keeps thickness when two corridors are moved together', () => {
    const map = buildSeatGridMap(10, 12);

    map.objects.push(
      corridor('corridor-1', 220, 120, 32, 420, {
        smartCorridor: true,
        corridorThickness: 32,
      }),
    );

    map.objects.push(
      corridor('corridor-2', 420, 120, 32, 420, {
        smartCorridor: true,
        corridorThickness: 32,
      }),
    );

    applyCorridorReflow(map);

    for (const object of map.objects.filter((object) => object.type === 'CORRIDOR')) {
      const previous = { ...object, data: { ...object.data } };
      object.x += 42;
      updateCorridorSplitAnchorsOnDrag(object, { x: object.x }, previous);
    }

    applyCorridorReflow(map);

    for (const object of map.objects.filter((object) => object.type === 'CORRIDOR')) {
      expect(object.width).toBeGreaterThanOrEqual(32);
      expect(Number(object.data.corridorThickness)).toBeGreaterThanOrEqual(32);
    }

    assertNoSeatIntersectsCorridors(map);
  });

  it('keeps clearance valid for E2E grid with intersecting vertical and horizontal corridors', () => {
    const map = buildSeatGridMap(10, 10, 42, 24, { x: 320, y: 180 });
    const col4 = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '4')!;
    const col5 = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '5')!;
    const rowD = map.seats.find((seat) => seat.rowLabel === 'D' && seat.seatNumber === '5')!;
    const rowE = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '5')!;
    const verticalGapX = (col4.x + col5.x) / 2;
    const horizontalGapY = (rowD.y + rowE.y) / 2;

    map.objects.push(corridor('corridor-vertical', verticalGapX - 16, 180 - 20, 32, 420, { smartCorridor: true, corridorThickness: 32 }));
    map.objects.push(corridor('corridor-horizontal', 320 - 40, horizontalGapY - 16, 520, 32, { smartCorridor: true, corridorThickness: 32 }));
    applyCorridorReflow(map);

    assertNoSeatIntersectsCorridors(map);
  });

  it('keeps clearance valid when two vertical corridors are shifted together', () => {
    const map = buildSeatGridMap(10, 10, 42, 24, { x: 320, y: 180 });
    const col3 = map.seats.find((seat) => seat.rowLabel === 'A' && seat.seatNumber === '3')!;
    const col4 = map.seats.find((seat) => seat.rowLabel === 'A' && seat.seatNumber === '4')!;
    const col7 = map.seats.find((seat) => seat.rowLabel === 'A' && seat.seatNumber === '7')!;
    const col8 = map.seats.find((seat) => seat.rowLabel === 'A' && seat.seatNumber === '8')!;

    map.objects.push(
      corridor('corridor-left', (col3.x + col4.x) / 2 - 16, 180 - 20, 32, 420, { smartCorridor: true, corridorThickness: 32 }),
    );
    map.objects.push(
      corridor('corridor-right', (col7.x + col8.x) / 2 - 16, 180 - 20, 32, 420, { smartCorridor: true, corridorThickness: 32 }),
    );
    applyCorridorReflow(map);

    for (const object of map.objects.filter((object) => object.type === 'CORRIDOR')) {
      const previous = { ...object, data: { ...object.data } };
      object.x += 42;
      updateCorridorSplitAnchorsOnDrag(object, { x: object.x }, previous);
    }

    applyCorridorReflow(map);
    assertNoSeatIntersectsCorridors(map);
  });

  it('keeps clearance valid when vertical and horizontal corridors are inserted sequentially', () => {
    const map = buildSeatGridMap(10, 10, 42, 24, { x: 320, y: 180 });
    const col4 = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '4')!;
    const col5 = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '5')!;
    const rowD = map.seats.find((seat) => seat.rowLabel === 'D' && seat.seatNumber === '5')!;
    const rowE = map.seats.find((seat) => seat.rowLabel === 'E' && seat.seatNumber === '5')!;
    const verticalGapX = (col4.x + col5.x) / 2;
    const horizontalGapY = (rowD.y + rowE.y) / 2;

    map.objects.push(
      corridor('corridor-vertical', verticalGapX - 16, 180 - 20, 32, 420, { smartCorridor: true, corridorThickness: 32 }),
    );
    applyCorridorReflow(map);
    map.objects.push(
      corridor('corridor-horizontal', 320 - 40, horizontalGapY - 16, 520, 32, { smartCorridor: true, corridorThickness: 32 }),
    );
    applyCorridorReflow(map);

    assertNoSeatIntersectsCorridors(map);
  });
});

describe('smart corridor rotation contract', () => {
  it('snaps rotation to quarter turns', () => {
    expect(snapSmartCorridorRotation(89)).toBe(90);
    expect(snapSmartCorridorRotation(271)).toBe(270);
    expect(snapSmartCorridorRotation(-90)).toBe(270);
  });

  it('derives effective partition axis from stored axis and rotation', () => {
    expect(effectiveCorridorAxisAtRotation('vertical', 0)).toBe('vertical');
    expect(effectiveCorridorAxisAtRotation('vertical', 90)).toBe('horizontal');
    expect(readStoredCorridorAxis(corridor('c1', 0, 0, 30, 120, { corridorAxis: 'vertical' }))).toBe('vertical');
  });

  it('updates stored axis when corridor is resized across orientations', () => {
    const previous = corridor('c1', 0, 0, 30, 120, { corridorAxis: 'vertical' });
    const object = { ...previous, data: { ...previous.data } };
    Object.assign(object, { width: 280, height: 32 });
    updateCorridorSplitAnchorsOnDrag(object, { width: 280, height: 32 }, previous);
    expect(object.data.corridorAxis).toBe('horizontal');

    const horizontalSnapshot = { ...object, data: { ...object.data } };
    Object.assign(object, { width: 30, height: 120 });
    updateCorridorSplitAnchorsOnDrag(object, { width: 30, height: 120 }, horizontalSnapshot);
    expect(object.data.corridorAxis).toBe('vertical');
  });

  it('builds transform preview with snapped rotation', () => {
    const map = buildSeatGridMap(4, 2, 40, 40, { x: 100, y: 100 });
    const corridorId = 'corridor-preview';
    map.objects.push(corridor(corridorId, 135, 70, 30, 120));
    const baseMap = cloneEventMap(map);
    const centerBefore = getCorridorWorldCenter(map.objects.find((entry) => entry.id === corridorId)!);

    const preview = buildSmartCorridorTransformPreview(
      baseMap,
      [{ objectId: corridorId, patch: { rotation: 88, x: 135, y: 70 }, mode: 'rotate' }],
      { maxIterations: CORRIDOR_REFLOW_ITERATIONS, activeCorridorIds: [corridorId] },
    );

    const previewCorridor = preview.objects.find((entry) => entry.id === corridorId);
    expect(previewCorridor?.rotation).toBe(90);
    const centerAfter = getCorridorWorldCenter(previewCorridor!);
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 1);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 1);
  });

  it('preserves corridor center when rotating via transform preview on empty map', () => {
    const corridorId = 'corridor-empty-rotate';
    const map = buildSeatGridMap(4, 2, 40, 40, { x: 100, y: 100 });
    map.objects.push(corridor(corridorId, 200, 160, 32, 160));
    const baseMap = cloneEventMap(map);
    const centerBefore = getCorridorWorldCenter(baseMap.objects.find((entry) => entry.id === corridorId)!);

    const preview = buildSmartCorridorTransformPreview(
      baseMap,
      [{ objectId: corridorId, patch: { rotation: 90 }, mode: 'rotate' }],
      { maxIterations: CORRIDOR_REFLOW_ITERATIONS, activeCorridorIds: [corridorId] },
    );

    const previewCorridor = preview.objects.find((entry) => entry.id === corridorId)!;
    expect(previewCorridor.rotation).toBe(90);
    const centerAfter = getCorridorWorldCenter(previewCorridor);
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 1);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 1);
  });

  it('uses rigid drag mode when the full section is selected', () => {
    const map = buildSeatGridMap(4, 2, 40, 40, { x: 100, y: 100 });
    const corridorId = 'corridor-rigid';
    map.objects.push(corridor(corridorId, 135, 70, 30, 120));
    const baseMap = cloneEventMap(map);
    const sectionObject = baseMap.objects.find((object) => object.type === 'SECTION');
    expect(sectionObject).toBeTruthy();

    const origin = new Map<string, { x: number; y: number }>();
    origin.set(`node-${corridorId}`, { x: 135, y: 70 });
    if (sectionObject) origin.set(`node-${sectionObject.id}`, { x: sectionObject.x, y: sectionObject.y });
    for (const seat of baseMap.seats) {
      origin.set(`node-${seat.id}`, { x: seat.x, y: seat.y });
    }

    const drag = { origin, delta: { x: 12, y: -8 } };
    expect(resolveCorridorDragMode(baseMap, drag, [corridorId])).toBe('rigid');

    const preview = buildSmartCorridorDragPreview(baseMap, drag, [`node-${corridorId}`], { mode: 'rigid' });
    for (const seat of preview.seats) {
      const baseSeat = baseMap.seats.find((entry) => entry.id === seat.id);
      expect(baseSeat).toBeTruthy();
      expect(seat.x).toBeCloseTo(baseSeat!.x + 12, 1);
      expect(seat.y).toBeCloseTo(baseSeat!.y - 8, 1);
    }
  });

  it('merges rigid seat deltas with reflow positions on mixed commit', () => {
    const map = buildSeatGridMap(4, 2, 40, 40, { x: 100, y: 100 });
    const corridorId = 'corridor-mixed';
    map.objects.push(corridor(corridorId, 135, 70, 30, 120));
    const baseMap = cloneEventMap(map);

    const origin = new Map<string, { x: number; y: number }>();
    origin.set(`node-${corridorId}`, { x: 135, y: 70 });
    const firstSeat = baseMap.seats[0]!;
    origin.set(`node-${firstSeat.id}`, { x: firstSeat.x, y: firstSeat.y });

    const drag = { origin, delta: { x: 10, y: 0 } };
    const preview = buildSmartCorridorDragPreview(baseMap, drag, [`node-${corridorId}`], {
      maxIterations: CORRIDOR_REFLOW_ITERATIONS,
      activeCorridorIds: [corridorId],
      mode: 'reflow',
    });
    const updates = extractGroupDragCommitUpdates(baseMap, preview, drag, [corridorId], 'reflow');
    expect(updates.seats.some((entry) => entry.id === firstSeat.id)).toBe(true);
    expect(updates.objects.some((entry) => entry.id === corridorId)).toBe(true);
  });
});
