import type { MoneyCents } from './types.js';

export interface WeightedMoneyItem {
  id: string;
  weight: number;
}

export type DistributeMoneyResult =
  | { success: true; allocations: Readonly<Record<string, MoneyCents>> }
  | { success: false; error: 'INVALID_TOTAL' | 'EMPTY_ITEMS' | 'INVALID_ITEM' };

export function isMoneyCents(value: number): value is MoneyCents {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Largest-remainder distribution. Ties are resolved by the stable item id,
 * so the same input always assigns residual cents to the same enrollment.
 */
export function distributeMoneyByWeight(
  totalCents: MoneyCents,
  items: readonly WeightedMoneyItem[],
): DistributeMoneyResult {
  if (!isMoneyCents(totalCents)) {
    return { success: false, error: 'INVALID_TOTAL' };
  }

  if (items.length === 0) {
    return { success: false, error: 'EMPTY_ITEMS' };
  }

  const ids = new Set<string>();
  if (
    items.some(
      ({ id, weight }) =>
        id.length === 0 ||
        ids.has(id) ||
        (ids.add(id), false) ||
        !Number.isFinite(weight) ||
        weight <= 0,
    )
  ) {
    return { success: false, error: 'INVALID_ITEM' };
  }

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return { success: false, error: 'INVALID_ITEM' };
  }

  const calculated = items.map((item) => {
    const exact = (totalCents * item.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { id: item.id, floor, remainder: exact - floor };
  });

  let remaining = totalCents - calculated.reduce((sum, item) => sum + item.floor, 0);
  const residualOrder = [...calculated].sort(
    (left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id),
  );

  const allocations: Record<string, MoneyCents> = Object.fromEntries(
    calculated.map((item) => [item.id, item.floor]),
  );

  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    const recipient = residualOrder[index % residualOrder.length];
    allocations[recipient.id] += 1;
  }

  return { success: true, allocations };
}

