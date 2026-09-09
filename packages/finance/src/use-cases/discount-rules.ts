/**
 * Converte o valor persistido pela UI em dias de validade do desconto no Asaas.
 * ATE_VENCIMENTO (ou valor ausente/inválido) significa 0.
 */
export function parseDiscountDueDateLimitDays(value?: string | null): number {
  if (!value || value === 'ATE_VENCIMENTO') return 0;

  const match = /^(\d+)_(?:DIA|DIAS)$/.exec(value.trim());
  if (!match) return 0;

  const days = Number(match[1]);
  return Number.isSafeInteger(days) && days >= 0 ? days : 0;
}
