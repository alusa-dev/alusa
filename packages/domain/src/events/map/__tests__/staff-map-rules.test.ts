import { describe, expect, it } from 'vitest';

import {
  groupStaffSeatsByLot,
  validateStaffSeatSelection,
} from '../map-rules';

describe('validateStaffSeatSelection', () => {
  const seats = [
    { id: 'a1', status: 'AVAILABLE' as const, lotId: 'lot-1' },
    { id: 'a2', status: 'HELD' as const, lotId: 'lot-1' },
    { id: 'a3', status: 'SOLD' as const, lotId: 'lot-1' },
  ];

  it('accepts available seats', () => {
    const result = validateStaffSeatSelection({ requestedSeatIds: ['a1'], seats });
    expect(result).toEqual({ ok: true, seatIds: ['a1'] });
  });

  it('accepts own held seats', () => {
    const result = validateStaffSeatSelection({
      requestedSeatIds: ['a2'],
      seats,
      ownHeldSeatIds: ['a2'],
    });
    expect(result).toEqual({ ok: true, seatIds: ['a2'] });
  });

  it('rejects sold seats', () => {
    const result = validateStaffSeatSelection({ requestedSeatIds: ['a3'], seats });
    expect(result.ok).toBe(false);
  });
});

describe('groupStaffSeatsByLot', () => {
  it('groups seats by lot id', () => {
    const groups = groupStaffSeatsByLot([
      { lotId: 'lot-a' },
      { lotId: 'lot-b' },
      { lotId: 'lot-a' },
    ]);
    expect(groups.get('lot-a')).toHaveLength(2);
    expect(groups.get('lot-b')).toHaveLength(1);
  });
});
