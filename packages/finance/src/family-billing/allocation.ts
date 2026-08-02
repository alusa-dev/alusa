export type FamilyAllocationMethod = 'EQUAL_SPLIT' | 'PRODUCT_PROPORTIONAL';

export function allocateFamilyAmount(input: {
  total: number;
  weights: number[];
  method: FamilyAllocationMethod;
}): number[] {
  if (input.weights.length === 0) return [];
  const totalCents = Math.round(input.total * 100);
  const normalizedWeights = input.weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const effectiveWeights =
    input.method === 'PRODUCT_PROPORTIONAL' && normalizedWeights.some((weight) => weight > 0)
      ? normalizedWeights
      : normalizedWeights.map(() => 1);
  const weightTotal = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
  const raw = effectiveWeights.map((weight) => (totalCents * weight) / weightTotal);
  const cents = raw.map(Math.floor);
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) {
    cents[order[index]!.index] += 1;
  }
  return cents.map((value) => value / 100);
}
