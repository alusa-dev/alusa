export const parseDecimal = (value: string): number => {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const maskDecimalInput = (rawValue: string): string => {
  if (!rawValue) {
    return '';
  }

  const sanitized = rawValue
    .replace(/[^0-9.,]/g, '')
    .replace(/,/g, '#')
    .replace(/\./g, ',')
    .replace(/#/g, ',');

  const [integerPartRaw = '', decimalPartRaw = ''] = sanitized.split(',', 2);
  const integerPart = integerPartRaw.replace(/\D/g, '');
  const decimalPart = decimalPartRaw.replace(/\D/g, '').slice(0, 2);

  if (!integerPart && !decimalPart) {
    return '';
  }

  const normalizedInteger = (integerPart || '0').replace(/^0+(?=\d)/, '') || '0';
  const integerWithThousands = normalizedInteger.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = decimalPart.padEnd(2, '0');

  return `${integerWithThousands},${decimals}`;
};

// Máscara simplificada para percentuais: mantém apenas dígitos e vírgula (2 casas),
// não aplica separador de milhar para evitar confusão em %.
export const maskPercentInput = (rawValue: string): string => {
  if (!rawValue) {
    return '';
  }

  const sanitized = rawValue.replace(/[^0-9,]/g, '').replace(/\./g, ',');
  const [integerPartRaw = '', decimalPartRaw = ''] = sanitized.split(',', 2);
  const integerPart = integerPartRaw.replace(/\D/g, '');
  const decimalPart = decimalPartRaw.replace(/\D/g, '').slice(0, 2);

  if (!integerPart && !decimalPart) {
    return '';
  }

  const normalizedInteger = (integerPart || '0').replace(/^0+(?=\d)/, '') || '0';
  const decimals = decimalPart.padEnd(2, '0');
  return `${normalizedInteger},${decimals}`;
};

export const formatDecimalFromNumber = (
  value?: number | null,
  options?: { blankWhenZero?: boolean },
): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (options?.blankWhenZero && value === 0) {
    return '';
  }

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
