const CHECK_IN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECK_IN_CODE_LENGTH = 12;

/** Creates a compact, case-insensitive Crockford Base32 code for a ticket. */
export function createCheckInCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CHECK_IN_CODE_LENGTH));
  return Array.from(bytes, (byte) => CHECK_IN_CODE_ALPHABET[byte & 31]!).join('');
}

export function normalizeCheckInCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

export function formatCheckInCode(value: string): string {
  const normalized = normalizeCheckInCode(value);
  return normalized.length === CHECK_IN_CODE_LENGTH
    ? `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`
    : normalized;
}

/**
 * Código curto legado impresso em versões antigas do ingresso.
 *
 * O PDF de ingressos usa este mesmo algoritmo para manter compatibilidade
 * com ingressos já emitidos. O código completo continua sendo a referência
 * interna; a resolução entre eventos só aceita o código curto quando houver
 * uma única correspondência dentro da conta.
 */
export function toCheckInCode(ticketCode: string): string {
  const digits = ticketCode.replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(-8);

  let hash = 0x811c9dc5;
  for (let index = 0; index < ticketCode.length; index += 1) {
    hash ^= ticketCode.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return String((hash >>> 0) % 100000000).padStart(8, '0');
}
