import { describe, expect, it } from 'vitest';

import { getSeatGroupTightBounds, getSeatGroupWorldBounds, type EventSeatDTO, type EventSeatGroupDTO } from '../index';

const group: EventSeatGroupDTO = {
  id: 'group-1',
  levelId: 'level-1',
  name: 'A',
  x: 100,
  y: 200,
  rotation: 0,
  rows: 10,
  columns: 10,
  seatWidth: 20,
  seatHeight: 20,
  gapX: 10,
  gapY: 10,
  paddingTop: 8,
  paddingRight: 8,
  paddingBottom: 8,
  paddingLeft: 8,
  numbering: {},
  locked: false,
};

function seat(id: string, rowIndex: number, columnIndex: number): EventSeatDTO {
  return {
    id,
    levelId: 'level-1',
    sectionId: 'section-1',
    objectId: null,
    groupId: 'group-1',
    rowIndex,
    columnIndex,
    technicalCode: `A-${rowIndex}-${columnIndex}`,
    displayLabel: `${rowIndex}-${columnIndex}`,
    rowLabel: String(rowIndex),
    seatNumber: String(columnIndex),
    status: 'AVAILABLE',
    accessible: false,
    publicVisible: true,
    x: group.x + group.paddingLeft + columnIndex * (group.seatWidth + group.gapX) + group.seatWidth / 2,
    y: group.y + group.paddingTop + rowIndex * (group.seatHeight + group.gapY) + group.seatHeight / 2,
    size: 20,
    rotation: 0,
  };
}

describe('seat group tight bounds', () => {
  it('uses real seats instead of configured rows and columns', () => {
    const bounds = getSeatGroupTightBounds(group, [seat('s1', 0, 0), seat('s2', 1, 1)]);

    expect(bounds.effectiveRows).toBe(2);
    expect(bounds.effectiveColumns).toBe(2);
    expect(bounds.width).toBe(66);
    expect(bounds.height).toBe(66);
    expect(bounds.width).toBeLessThan(300);
    expect(bounds.height).toBeLessThan(300);
  });

  it('returns a world AABB for rotated groups', () => {
    const rotated = { ...group, rotation: 90 };
    const bounds = getSeatGroupWorldBounds(rotated, [
      {
        ...seat('s1', 0, 0),
        x: rotated.x - (group.paddingTop + group.seatHeight / 2),
        y: rotated.y + group.paddingLeft + group.seatWidth / 2,
      },
    ]);

    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });
});
