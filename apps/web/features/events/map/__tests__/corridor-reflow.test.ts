import { describe, expect, it } from 'vitest';

import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';
import { applyCorridorReflow, resolveCorridorAxis } from '../lib/corridor-reflow';
import { buildSeatGridPreview } from '../lib/seat-grid';
import { getSeatBounds, intersectsRect } from '../lib/selection-utils';

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

function buildSeatGridMap(rows: number, columns: number) {
  const preview = buildSeatGridPreview(
    { x: 100, y: 100 },
    {
      totalSeats: rows * columns,
      rows,
      columns,
      seatSize: 20,
      horizontalSpacing: 40,
      verticalSpacing: 40,
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

  it('auto-fits vertical corridor core inside the opened gap without occupying padding', () => {
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

    expect(gapEnd - gapStart).toBeGreaterThanOrEqual(8 + 32 + 8);
    expect(corridorObject.x).toBeCloseTo(gapStart + 8, 1);
    expect(corridorObject.width).toBeCloseTo(32, 1);

    for (const seat of map.seats) {
      expect(intersectsRect(getSeatBounds(seat), corridorBounds(corridorObject))).toBe(false);
    }
  });

  it('auto-fits horizontal corridor core inside the opened gap and row span', () => {
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
    const rowABounds = rowA.map((seat) => getSeatBounds(seat));

    expect(gapEnd - gapStart).toBeGreaterThanOrEqual(8 + 32 + 8);
    expect(corridorObject.y).toBeCloseTo(gapStart + 8, 1);
    expect(corridorObject.height).toBeCloseTo(32, 1);
    expect(corridorObject.width).toBeCloseTo(
      Math.max(...rowABounds.map((bounds) => bounds.x + bounds.width)) - Math.min(...rowABounds.map((bounds) => bounds.x)),
      1,
    );
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

  it('normalizes corridor rotation to zero during reflow', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push({
      ...corridor('corridor-1', 135, 70, 30, 120),
      rotation: 90,
    });

    applyCorridorReflow(map);

    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;
    expect(corridorObject.rotation).toBe(0);
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
});
