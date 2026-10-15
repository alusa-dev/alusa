import { isValidDateOnly } from '../date-only';
import { parseDateOnlyToUtcDate } from '../date-only';

function hasInvalidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  return Boolean(match && !isValidDateOnly(match[1]));
}

/**
 * Formata data para dd/MM/yyyy
 */
export function formatDate(date: Date | string | undefined | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR');
}

/**
 * Formata campos cuja semântica é uma data civil de pagamento, preservando
 * YYYY-MM-DD e sua serialização UTC à meia-noite. Valores com horário continuam
 * sendo formatados como instantes no fuso solicitado (ou no fuso local).
 */
export function formatPaymentDate(
  value: Date | string | undefined | null,
  timeZone?: string,
  options: { dateOnly?: boolean } = {},
): string | null {
  if (!value) return null;
  if (typeof value === 'string' && hasInvalidIsoCalendarDate(value)) return null;

  const dateOnly = options.dateOnly === false
    ? null
    : value instanceof Date
    ? (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0
      ? value.toISOString().slice(0, 10)
      : null)
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/.exec(value)?.[1] ?? null;

  if (dateOnly && isValidDateOnly(dateOnly)) {
    const [year, month, day] = dateOnly.split('-');
    return `${day}/${month}/${year}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** Interpreta date-only de provedores como data civil e timestamps como instantes. */
export function parsePaymentDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (hasInvalidIsoCalendarDate(value)) throw new RangeError(`Data de pagamento inválida: ${value}`);
    return parseDateOnlyToUtcDate(value);
  }
  if (hasInvalidIsoCalendarDate(value)) throw new RangeError(`Data de pagamento inválida: ${value}`);
  return new Date(value);
}

/** Optional provider date: null means absent, undefined means malformed/preserve. */
export function parseOptionalPaymentDate(value?: string | null): Date | null | undefined {
  if (value == null || value === '') return null;
  try {
    const parsed = parsePaymentDate(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/** Chave de calendário para filtrar relatórios por dia sem deslocar date-only. */
export function getPaymentDateKey(
  value: Date | string,
  timeZone?: string,
  options: { dateOnly?: boolean } = {},
): string | null {
  if (typeof value === 'string' && hasInvalidIsoCalendarDate(value)) return null;
  const dateOnly = options.dateOnly === false
    ? null
    : value instanceof Date
    ? (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0
      ? value.toISOString().slice(0, 10)
      : null)
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/.exec(value)?.[1] ?? null;
  if (dateOnly && isValidDateOnly(dateOnly)) return dateOnly;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map(({ type, value: part }) => [type, part]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

/**
 * Formata data para yyyy-MM-dd (ISO)
 */
export function formatDateISO(date: Date | string | undefined | null): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/**
 * Adiciona dias a uma data
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Adiciona meses a uma data
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
