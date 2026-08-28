import { describe, expect, it } from 'vitest';

import {
  calculateInventoryValue,
  computeWeightedAverageCost,
} from '../inventory-cost';

describe('inventory cost calculations', () => {
  it('calculates the weighted average after a new entry', () => {
    expect(computeWeightedAverageCost(10, 20, 5, 30)).toBe(23.3333);
  });

  it('uses a zero incoming cost instead of treating it as missing', () => {
    expect(computeWeightedAverageCost(10, 20, 5, 0)).toBe(13.3333);
  });

  it('starts the average cost with the first entry when the balance is empty', () => {
    expect(computeWeightedAverageCost(0, 0, 8, 12.5)).toBe(12.5);
  });

  it('does not change the average without a positive physical entry', () => {
    expect(computeWeightedAverageCost(10, 20, 0, 30)).toBe(20);
  });

  it('calculates inventory value from physical units and average cost', () => {
    expect(calculateInventoryValue(55, 5)).toBe(275);
    expect(calculateInventoryValue(500, 0)).toBe(0);
  });
});
