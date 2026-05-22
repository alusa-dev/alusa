import { describe, expect, it } from 'vitest';

import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';
import { applyCorridorReflow, resolveCorridorAxis } from '../lib/corridor-reflow';
import { buildSeatGridPreview } from '../lib/seat-grid';
import { intersectsRect } from '../lib/selection-utils';

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

  const minX = Math.min(...seats.map((seat) => seat.x));
  const minY = Math.min(...seats.map((seat) => seat.y));
  const maxX = Math.max(...seats.map((seat) => seat.x + (seat.size ?? 20)));
  const maxY = Math.max(...seats.map((seat) => seat.y + (seat.size ?? 20)));

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
    .sort((left, right) => left.rowLabel.localeCompare(right.rowLabel));
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

    expect(col4.x - (col3.x + (col3.size ?? 20))).toBeGreaterThanOrEqual(30);
    expect(col11.x - (col10.x + (col10.size ?? 20))).toBeGreaterThanOrEqual(30);

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
      return col2.x - (col1.x + (col1.size ?? 20));
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
      const corridorBounds = {
        x: corridorObject.x,
        y: corridorObject.y,
        width: corridorObject.width ?? 0,
        height: corridorObject.height ?? 0,
      };

      for (const seat of map.seats) {
        const seatBounds = {
          x: seat.x,
          y: seat.y,
          width: seat.size ?? 20,
          height: seat.size ?? 20,
        };
        expect(intersectsRect(seatBounds, corridorBounds)).toBe(false);
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

    const gapAfterLeft = middleBlock[0]!.x - (leftBlock[2]!.x + (leftBlock[2]!.size ?? 20));
    const gapBeforeRight = rightBlock[0]!.x - (middleBlock[6]!.x + (middleBlock[6]!.size ?? 20));
    expect(gapAfterLeft).toBeGreaterThanOrEqual(30);
    expect(gapBeforeRight).toBeGreaterThanOrEqual(30);
  });

  it('auto-fits vertical corridor width to the opened gap', () => {
    const map = buildSeatGridMap(2, 4);
    map.objects.push(corridor('corridor-1', 135, 70, 30, 120, { corridorAxis: 'vertical', corridorAutoFit: true }));
    applyCorridorReflow(map);

    const col1 = map.seats.find((seat) => seat.seatNumber === '1')!;
    const col2 = map.seats.find((seat) => seat.seatNumber === '2')!;
    const gapStart = col1.x + (col1.size ?? 20);
    const gapEnd = col2.x;
    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;

    expect(corridorObject.x).toBeCloseTo(gapStart, 1);
    expect(corridorObject.width).toBeCloseTo(gapEnd - gapStart, 1);
  });

  it('auto-fits horizontal corridor height to the opened gap and row span', () => {
    const map = buildSeatGridMap(4, 5);
    map.objects.push(corridor('corridor-1', 90, 125, 280, 32, { corridorAxis: 'horizontal', corridorAutoFit: true }));
    applyCorridorReflow(map);

    const rowA = map.seats.filter((seat) => seat.rowLabel === 'A');
    const rowB = map.seats.filter((seat) => seat.rowLabel === 'B');
    const gapStart = Math.max(...rowA.map((seat) => seat.y + (seat.size ?? 20)));
    const gapEnd = Math.min(...rowB.map((seat) => seat.y));
    const corridorObject = map.objects.find((object) => object.id === 'corridor-1')!;

    expect(corridorObject.y).toBeCloseTo(gapStart, 1);
    expect(corridorObject.height).toBeCloseTo(gapEnd - gapStart, 1);
    expect(corridorObject.width).toBeCloseTo(Math.max(...rowA.map((seat) => seat.x + (seat.size ?? 20))) - Math.min(...rowA.map((seat) => seat.x)), 1);
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
    const gap = col2.x - (col1.x + (col1.size ?? 20));

    expect(gap).toBeGreaterThanOrEqual(30 + 40 + 8);
  });
});
