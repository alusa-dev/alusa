const percentageFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function currencyAmountToCents(value: number | null | undefined) {
  return Math.max(0, Math.round((value ?? 0) * 100));
}

export function currencyTextToCents(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function formatCurrencyCents(valueInCents: number) {
  return currencyFormatter.format(Math.max(0, valueInCents) / 100);
}

export function parseDecimalInput(value: string) {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function sanitizePercentageInput(value: string) {
  const normalized = value.replace(/\./g, ',').replace(/[^\d,]/g, '');
  if (!normalized) return '';

  const commaIndex = normalized.indexOf(',');
  const rawInteger = commaIndex >= 0 ? normalized.slice(0, commaIndex) : normalized;
  const integer = (rawInteger.replace(/^0+(?=\d)/, '') || '0').slice(0, 3);
  if (commaIndex < 0) return integer;

  const decimals = normalized.slice(commaIndex + 1).replace(/,/g, '').slice(0, 2);
  return `${integer},${decimals}`;
}

export function formatPercentageValue(value: number | null | undefined) {
  return percentageFormatter.format(value ?? 0);
}

export function normalizePercentageOnBlur(value: string) {
  const parsed = parseDecimalInput(value);
  return parsed === null ? '' : formatPercentageValue(parsed);
}

export function percentageValidationMessage(value: string) {
  const parsed = parseDecimalInput(value);
  if (parsed === null) return 'Informe um percentual válido.';
  if (parsed > 100) return 'O percentual máximo é 100,00%.';
  return undefined;
}
