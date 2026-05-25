import { DEFAULT_SEAT_GRID_CONFIG, SEAT_GRID_SECTION_PADDING, buildSeatGridPreview, getSeatGridPreviewBounds, getSeatGridRowLabel, normalizeSeatGridConfig, suggestNextSeatGridConfig } from '../index';

import { describe, expect, it } from 'vitest';

describe('seat-grid', () => {
  it('builds a partial grid with stable labels and spacing', () => {
    const seats = buildSeatGridPreview(
      { x: 100, y: 200 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 5,
        rows: 2,
        columns: 3,
        horizontalSpacing: 40,
        verticalSpacing: 50,
      },
    );

    expect(seats).toHaveLength(5);
    expect(seats.map((seat) => seat.displayLabel)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    expect(seats.map((seat) => ({ x: seat.x, y: seat.y }))).toEqual([
      { x: 100, y: 200 },
      { x: 140, y: 200 },
      { x: 180, y: 200 },
      { x: 100, y: 250 },
      { x: 140, y: 250 },
    ]);
  });

  it('supports right-to-left numbering without changing label order', () => {
    const seats = buildSeatGridPreview(
      { x: 0, y: 0 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 3,
        rows: 1,
        columns: 3,
        horizontalSpacing: 30,
        numberingDirection: 'right-to-left',
      },
    );

    expect(seats.map((seat) => seat.displayLabel)).toEqual(['A1', 'A2', 'A3']);
    expect(seats.map((seat) => seat.x)).toEqual([60, 30, 0]);
  });

  it('clamps total seats to the configured grid capacity', () => {
    expect(normalizeSeatGridConfig({ totalSeats: 20, rows: 2, columns: 4 }).totalSeats).toBe(8);
  });

  it('computes padded section bounds around all preview seats', () => {
    const seats = buildSeatGridPreview(
      { x: 100, y: 200 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 4,
        rows: 2,
        columns: 2,
        seatSize: 20,
        horizontalSpacing: 30,
        verticalSpacing: 40,
      },
    );

    expect(getSeatGridPreviewBounds(seats, SEAT_GRID_SECTION_PADDING)).toEqual({
      x: 66,
      y: 166,
      width: 98,
      height: 108,
    });
  });

  it('continues alphabetic row labels beyond Z', () => {
    expect(getSeatGridRowLabel(25, 'A')).toBe('Z');
    expect(getSeatGridRowLabel(26, 'A')).toBe('AA');
  });

  it('suggests the next seat number in the last used row and inherits the previous preset', () => {
    const config = suggestNextSeatGridConfig(
      [
        { levelId: 'level-1', rowLabel: 'A', seatNumber: '1', displayLabel: 'A1', x: 100, y: 100, size: 30 },
        { levelId: 'level-1', rowLabel: 'A', seatNumber: '2', displayLabel: 'A2', x: 144, y: 100, size: 30 },
        { levelId: 'level-1', rowLabel: 'I', seatNumber: '1', displayLabel: 'I1', x: 100, y: 156, size: 30 },
        { levelId: 'level-1', rowLabel: 'I', seatNumber: '8', displayLabel: 'I8', x: 408, y: 156, size: 30 },
      ],
      'level-1',
      DEFAULT_SEAT_GRID_CONFIG,
    );

    expect(config.rowPrefix).toBe('I');
    expect(config.startNumber).toBe(9);
    expect(config.seatSize).toBe(30);
    expect(config.horizontalSpacing).toBe(44);
    expect(config.verticalSpacing).toBe(56);
  });

  it('ignores seats from other levels when suggesting the next row', () => {
    const config = suggestNextSeatGridConfig(
      [
        { levelId: 'level-2', rowLabel: 'Z', seatNumber: '8', displayLabel: 'Z8' },
        { levelId: 'level-1', rowLabel: 'B', seatNumber: '8', displayLabel: 'B8' },
      ],
      'level-1',
      DEFAULT_SEAT_GRID_CONFIG,
    );

    expect(config.rowPrefix).toBe('B');
    expect(config.startNumber).toBe(9);
  });
});
