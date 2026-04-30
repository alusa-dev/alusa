export type PersonType = 'PF' | 'PJ' | 'UNKNOWN';

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeCpfCnpjDigits(value: string | null | undefined): string {
  return onlyDigits(value ?? '');
}

export function detectPersonType(cpfCnpj: string | null | undefined): PersonType {
  const digits = normalizeCpfCnpjDigits(cpfCnpj);
  if (digits.length === 11) return 'PF';
  if (digits.length === 14) return 'PJ';
  return 'UNKNOWN';
}
