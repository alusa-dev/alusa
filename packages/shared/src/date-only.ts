export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseDateOnlyToUtcDate(value: string): Date {
  if (!isValidDateOnly(value)) throw new Error('Data inválida');
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseBrazilianDateOnlyToUtcDate(value: string): Date {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error('Data inválida');
  const [, day, month, year] = match;
  return parseDateOnlyToUtcDate(`${year}-${month}-${day}`);
}

export const DEFAULT_ACADEMIC_TIMEZONE = 'America/Sao_Paulo';

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateValue(value: Date | string): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Normaliza o timezone da Conta para proteger a semântica de datas acadêmicas. */
export function normalizeAcademicTimeZone(input: string | null | undefined): string {
  if (!input?.trim()) return DEFAULT_ACADEMIC_TIMEZONE;
  const timeZone = input.trim();
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_ACADEMIC_TIMEZONE;
  }
}

/** Retorna a data civil armazenada na convenção UTC da Alusa. */
export function getAcademicDateKey(value: Date | string): string | null {
  const date = parseDateValue(value);
  if (!date) return null;
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

/** Retorna o dia civil observado no timezone da Conta para um instante real. */
export function getCurrentAcademicDateKey(
  instant: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): string {
  const date = parseDateValue(instant);
  if (!date) throw new Error('Instante inválido');

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizeAcademicTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export type AcademicDateBounds = { dateKey: string; start: Date; end: Date };

function getBoundsForKey(dateKey: string): AcademicDateBounds {
  if (!isValidDateOnly(dateKey)) throw new Error('Data acadêmica inválida');
  const [year, month, day] = dateKey.split('-').map(Number);
  const start = parseDateOnlyToUtcDate(dateKey);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return { dateKey, start, end: new Date(nextDay.getTime() - 1) };
}

export function addAcademicDays(value: Date | string, days: number): string {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey || !Number.isInteger(days)) throw new Error('Data acadêmica inválida');
  const date = parseDateOnlyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function getAcademicDateBoundsForStoredDate(value: Date | string): AcademicDateBounds {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey) throw new Error('Data acadêmica inválida');
  return getBoundsForKey(dateKey);
}

/** Resolve midnight at the start of a stored academic date in the Conta timezone. */
export function getAcademicDateStartInstant(
  value: Date | string,
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): Date {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey) throw new Error('Data acadêmica inválida');
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day);
  const normalizedTimeZone = normalizeAcademicTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  let candidate = targetWallClock;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Map(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const observedWallClock = Date.UTC(
      Number(parts.get('year')),
      Number(parts.get('month')) - 1,
      Number(parts.get('day')),
      Number(parts.get('hour')),
      Number(parts.get('minute')),
      Number(parts.get('second')),
    );
    const correction = targetWallClock - observedWallClock;
    candidate += correction;
    if (correction === 0) return new Date(candidate);
  }

  // Some timezones change their offset at midnight. If midnight itself is
  // skipped, return the first representable minute on that academic date.
  const start = candidate - 18 * 60 * 60 * 1000;
  const end = candidate + 36 * 60 * 60 * 1000;
  for (let instant = start; instant <= end; instant += 60 * 1000) {
    const parts = new Map(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    if (
      `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}` === dateKey
    ) {
      return new Date(instant);
    }
  }
  throw new Error('Data acadêmica sem início local representável');
}

export function getAcademicDateBoundsForInstant(
  instant: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): AcademicDateBounds {
  return getBoundsForKey(getCurrentAcademicDateKey(instant, timeZone));
}

export function getAcademicDateDifference(
  value: Date | string,
  referenceInstant: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): number {
  const valueKey = getAcademicDateKey(value);
  if (!valueKey) throw new Error('Data acadêmica inválida');
  const referenceKey = getCurrentAcademicDateKey(referenceInstant, timeZone);
  return Math.round(
    (parseDateOnlyToUtcDate(valueKey).getTime() - parseDateOnlyToUtcDate(referenceKey).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

export function isAcademicDateInFuture(
  value: Date | string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): boolean {
  const dateKey = getAcademicDateKey(value);
  return dateKey ? dateKey > getCurrentAcademicDateKey(now, timeZone) : false;
}

export function isAtLeastAgeYears(value: string, minAgeYears: number, now: Date = new Date()): boolean {
  if (!isValidDateOnly(value)) return false;
  const birth = parseDateOnlyToUtcDate(value);
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let age = nowUtc.getUTCFullYear() - birth.getUTCFullYear();
  if (
    nowUtc.getUTCMonth() < birth.getUTCMonth() ||
    (nowUtc.getUTCMonth() === birth.getUTCMonth() && nowUtc.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age >= minAgeYears;
}
