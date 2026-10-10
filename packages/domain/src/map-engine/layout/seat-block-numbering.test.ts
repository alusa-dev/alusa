import { describe, expect, it } from 'vitest';
import type { MapSeatBlock } from '../model/event-map-document.js';
import { applySeatBlockNumbering, getNextNumericSeatNumber } from './seat-block-numbering.js';

function createBlock(): MapSeatBlock {
  const rows = [0, 1].map((rowIndex) => ({
    id: `row-${rowIndex}`,
    sectionId: 'section-1',
    blockId: 'block-1',
    label: String.fromCharCode(65 + rowIndex),
    path: { type: 'LINE' as const, start: { x: 0, y: rowIndex * 20 }, end: { x: 30, y: rowIndex * 20 } },
    seatGap: 0,
    seatSize: 10,
    seatIds: [`seat-${rowIndex}-0`, `seat-${rowIndex}-1`],
    seats: [0, 1].map((columnIndex) => ({
      id: `seat-${rowIndex}-${columnIndex}`,
      label: `legacy-${rowIndex}-${columnIndex}`,
      technicalCode: `legacy-${rowIndex}-${columnIndex}`,
      rowIndex,
      columnIndex,
    })),
    distribution: [{ type: 'SEATS' as const, count: 2 }],
  }));
  return {
    id: 'block-1',
    sectionId: 'section-1',
    rowGap: 10,
    defaultSeatGap: 0,
    distribution: [{ type: 'SEATS', count: 2 }],
    distributionMode: 'FIXED',
    rowIds: rows.map((row) => row.id),
    rows,
    numberingMode: 'NUMERIC',
  };
}

describe('applySeatBlockNumbering', () => {
  it('numbers active seats sequentially across rows and assigns unique technical codes', () => {
    const block = applySeatBlockNumbering(createBlock());
    const seats = block.rows.flatMap((row) => row.seats);

    expect(seats.map((seat) => seat.label)).toEqual(['1', '2', '3', '4']);
    expect(seats.map((seat) => seat.seatNumber)).toEqual(['1', '2', '3', '4']);
    expect(new Set(seats.map((seat) => seat.technicalCode)).size).toBe(4);
  });

  it('numbers numeric seats from right to left and continues across rows', () => {
    const block = applySeatBlockNumbering({ ...createBlock(), numberingDirection: 'right-to-left' });

    expect(block.rows.map((row) => row.seats.map((seat) => seat.label))).toEqual([
      ['2', '1'],
      ['4', '3'],
    ]);
  });

  it('continues numeric numbering from the configured start and finds the next map number', () => {
    const block = applySeatBlockNumbering({ ...createBlock(), startNumber: 20 });

    expect(block.rows.flatMap((row) => row.seats.map((seat) => seat.label))).toEqual(['20', '21', '22', '23']);
    expect(getNextNumericSeatNumber([block])).toBe(24);
  });
});
