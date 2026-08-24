export const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatPercent(value: number | null): string {
  return value == null ? '—' : `${percentFormatter.format(value)}%`;
}

/** Converte a máscara monetária pt-BR para número sem aceitar valores ambíguos. */
export function parseCurrencyInput(value: string): number {
  const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function maskCurrencyInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  const cents = Number(digits) / 100;
  return cents.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
