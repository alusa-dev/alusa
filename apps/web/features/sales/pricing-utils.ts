export type PricingMetrics = {
  price: number;
  averageCost: number;
  profitPerUnit: number;
  marginPercent: number;
};

function safeNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

export function roundPercent(value: number): number {
  return Number(value.toFixed(1));
}

export function calculatePricingMetrics(price: number, averageCost: number): PricingMetrics {
  const normalizedPrice = Math.max(safeNumber(price), 0);
  const normalizedCost = Math.max(safeNumber(averageCost), 0);
  const profitPerUnit = roundMoney(normalizedPrice - normalizedCost);

  return {
    price: normalizedPrice,
    averageCost: normalizedCost,
    profitPerUnit,
    marginPercent: normalizedPrice > 0 ? roundPercent((profitPerUnit / normalizedPrice) * 100) : 0,
  };
}

export function calculatePriceFromMargin(
  averageCost: number,
  marginPercent: number,
): number | null {
  const normalizedCost = Math.max(safeNumber(averageCost), 0);
  const normalizedMargin = safeNumber(marginPercent);

  if (normalizedCost <= 0 || normalizedMargin <= 0 || normalizedMargin >= 95) {
    return null;
  }

  return roundMoney(normalizedCost / (1 - normalizedMargin / 100));
}

export function formatMarginPercent(value: number | null | undefined): string {
  return `${roundPercent(safeNumber(value)).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}
