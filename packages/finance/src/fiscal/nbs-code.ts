/** NBS oficial Asaas: 9 dígitos no formato N.NNNN.NN.NN (ex.: 1.2201.11.00). */
export const NBS_DIGIT_COUNT = 9;

const NBS_FORMAT_REGEX = /^\d\.\d{4}\.\d{2}\.\d{2}$/;

export function formatNbsCode(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, NBS_DIGIT_COUNT);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits[0]}.${digits.slice(1)}`;
  if (digits.length <= 7) return `${digits[0]}.${digits.slice(1, 5)}.${digits.slice(5)}`;
  return `${digits[0]}.${digits.slice(1, 5)}.${digits.slice(5, 7)}.${digits.slice(7)}`;
}

export function isValidNbsCodeFormat(value: string | undefined | null): boolean {
  if (!value?.trim()) return false;
  return NBS_FORMAT_REGEX.test(value.trim());
}

/** Corrige entradas como 12201.11.00 → 1.2201.11.00 antes de enviar ao Asaas. */
export function normalizeNbsCodeForAsaas(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (isValidNbsCodeFormat(trimmed)) return trimmed;
  const formatted = formatNbsCode(trimmed);
  return isValidNbsCodeFormat(formatted) ? formatted : undefined;
}
