import { describe, expect, it } from 'vitest';
import { allocateFamilyAmount } from '../allocation';

describe('allocateFamilyAmount', () => {
  it('divide plano promocional igualmente e preserva centavos', () => {
    const allocations = allocateFamilyAmount({
      total: 650,
      weights: [1, 1, 1],
      method: 'EQUAL_SPLIT',
    });
    expect(allocations).toEqual([216.67, 216.67, 216.66]);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(650);
  });

  it('distribui combos proporcionalmente aos preços individuais', () => {
    expect(
      allocateFamilyAmount({
        total: 300,
        weights: [100, 200],
        method: 'PRODUCT_PROPORTIONAL',
      }),
    ).toEqual([100, 200]);
  });
});
