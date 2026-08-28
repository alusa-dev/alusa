import { describe, expect, it } from 'vitest';

import { calculateInventoryCostBasis } from './inventory-balance.service';

describe('inventory cost basis', () => {
  it('keeps zero as an explicit acquisition cost', () => {
    expect(
      calculateInventoryCostBasis([
        { onHandDelta: 5, unitCost: 0 },
      ]),
    ).toEqual({ onHand: 5, inventoryValue: 0, averageCost: 0 });
  });

  it('weights paid and zero-cost entries using the current stock quantity', () => {
    expect(
      calculateInventoryCostBasis([
        { onHandDelta: 5, unitCost: 5 },
        { onHandDelta: 5, unitCost: 0 },
      ]),
    ).toEqual({ onHand: 10, inventoryValue: 25, averageCost: 2.5 });
  });

  it('removes outgoing stock at the current average acquisition cost', () => {
    expect(
      calculateInventoryCostBasis([
        { onHandDelta: 5, unitCost: 10 },
        { onHandDelta: 5, unitCost: 0 },
        { onHandDelta: -4, unitCost: null },
      ]),
    ).toEqual({ onHand: 6, inventoryValue: 30, averageCost: 5 });
  });
});
