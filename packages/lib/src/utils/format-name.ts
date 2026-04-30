export interface FormatNameOptions {
  /** Caso true, converte o resultado para maiúsculas */
  uppercase?: boolean;
  /** Quando true (default), remove espaços extras */
  trim?: boolean;
}

function normalizeName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

/**
 * Retorna iniciais a partir do nome completo.
 * - Utiliza a primeira letra do primeiro e do último nome
 * - Mantém fallback "?" quando não houver caracteres válidos
 */
export function formatInitials(name: string, options: FormatNameOptions = {}): string {
  const normalized = normalizeName(name);
  if (!normalized) return '?';
  const parts = normalized.split(' ');
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  const initials = `${first}${last || first}` || '?';
  const trimmed = options.trim === false ? initials : initials.trim();
  return options.uppercase === false ? trimmed : trimmed.toUpperCase();
}

/**
 * Mantém somente primeiro e último nomes para exibição.
 */
export function formatFirstLast(name: string, options: FormatNameOptions = {}): string {
  const normalized = normalizeName(name);
  if (!normalized) return '';
  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return options.uppercase ? parts[0].toUpperCase() : parts[0];
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const result = `${first} ${last}`;
  return options.uppercase ? result.toUpperCase() : result;
}

/**
 * Retorna um nome curto útil para badges e botões.
 */
export function formatShortName(name: string, fallback = ''): string {
  const normalized = normalizeName(name);
  if (!normalized) return fallback;
  const parts = normalized.split(' ');
  if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]}`;
  return parts[0];
}
