export type ParseCpfResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function calculateDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    sum += Number(base[i]) * (base.length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function parseCpf(value: string): ParseCpfResult {
  const digits = normalizeCpf(value);

  if (digits.length !== 11) {
    return { ok: false, error: 'CPF deve conter 11 dígitos.' };
  }

  if (/^(\d)\1{10}$/.test(digits)) {
    return { ok: false, error: 'CPF com dígitos repetidos é inválido.' };
  }

  const firstDigit = calculateDigit(digits.slice(0, 9));
  const secondDigit = calculateDigit(digits.slice(0, 10));

  if (firstDigit !== Number(digits[9]) || secondDigit !== Number(digits[10])) {
    return { ok: false, error: 'CPF inválido.' };
  }

  return { ok: true, value: digits };
}

export function isValidCpf(value: string): boolean {
  return parseCpf(value).ok;
}

export function maskCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}
