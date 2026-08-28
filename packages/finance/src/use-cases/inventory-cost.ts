/**
 * Custo médio ponderado após uma entrada física de estoque.
 * O saldo mantém quatro casas para acompanhar InventoryBalance.averageCost.
 */
export function computeWeightedAverageCost(
  currentOnHand: number,
  currentAverageCost: number,
  incomingQuantity: number,
  incomingUnitCost: number,
): number {
  const safeCurrentOnHand = Math.max(currentOnHand, 0);
  const safeCurrentAverageCost = Math.max(currentAverageCost, 0);
  const safeIncomingQuantity = Math.max(incomingQuantity, 0);
  const safeIncomingUnitCost = Math.max(incomingUnitCost, 0);

  if (safeIncomingQuantity <= 0) return safeCurrentAverageCost;

  const nextOnHand = safeCurrentOnHand + safeIncomingQuantity;
  if (safeCurrentOnHand <= 0) return Number(safeIncomingUnitCost.toFixed(4));

  const currentValue = safeCurrentOnHand * safeCurrentAverageCost;
  const incomingValue = safeIncomingQuantity * safeIncomingUnitCost;
  return Number(((currentValue + incomingValue) / nextOnHand).toFixed(4));
}

export function calculateInventoryValue(onHand: number, averageCost: number): number {
  return Number((Math.max(onHand, 0) * Math.max(averageCost, 0)).toFixed(4));
}
