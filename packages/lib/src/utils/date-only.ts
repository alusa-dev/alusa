export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return false;
  if (date.getUTCFullYear() !== year) return false;
  if (date.getUTCMonth() !== month - 1) return false;
  if (date.getUTCDate() !== day) return false;
  return true;
}

export function parseDateOnlyToUtcDate(value: string): Date {
  if (!isValidDateOnly(value)) {
    throw new Error('Data inválida');
  }
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
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

/**
 * Normaliza o timezone do tenant sem permitir que uma entrada inválida altere
 * a semântica de vigência acadêmica para um timezone arbitrário.
 */
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

/**
 * Retorna o dia civil representado por uma data acadêmica persistida.
 *
 * Matrículas usam DateTime por compatibilidade, mas o valor representa apenas
 * ano/mês/dia e é serializado na convenção UTC. Portanto, não converta esse
 * valor para o timezone do processo para descobrir o dia acadêmico.
 */
export function getAcademicDateKey(value: Date | string): string | null {
  const date = parseDateValue(value);
  if (!date) return null;

  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

/** Retorna o dia civil observado no timezone do tenant para um instante real. */
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

export type AcademicDateBounds = {
  dateKey: string;
  start: Date;
  end: Date;
};

function getBoundsForKey(dateKey: string): AcademicDateBounds {
  if (!isValidDateOnly(dateKey)) throw new Error('Data acadêmica inválida');

  const [year, month, day] = dateKey.split('-').map(Number);
  const start = parseDateOnlyToUtcDate(dateKey);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    dateKey,
    start,
    end: new Date(nextDay.getTime() - 1),
  };
}

export function addAcademicDays(value: Date | string, days: number): string {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey || !Number.isInteger(days)) throw new Error('Data acadêmica inválida');

  const date = parseDateOnlyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

/** Limites da data civil armazenada, independente do relógio do servidor. */
export function getAcademicDateBoundsForStoredDate(value: Date | string): AcademicDateBounds {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey) throw new Error('Data acadêmica inválida');
  return getBoundsForKey(dateKey);
}

/**
 * Limites da data civil atual da Conta, prontos para filtros Prisma.
 * Os limites são expressos na mesma coordenada UTC usada pela convenção de
 * armazenamento das datas acadêmicas, não como início/fim do dia do servidor.
 */
export function getAcademicDateBoundsForInstant(
  instant: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): AcademicDateBounds {
  return getBoundsForKey(getCurrentAcademicDateKey(instant, timeZone));
}

/** Diferença em dias civis entre uma data acadêmica e o dia atual da Conta. */
export function getAcademicDateDifference(
  value: Date | string,
  referenceInstant: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): number {
  const valueKey = getAcademicDateKey(value);
  if (!valueKey) throw new Error('Data acadêmica inválida');

  const referenceKey = getCurrentAcademicDateKey(referenceInstant, timeZone);
  const valueDate = parseDateOnlyToUtcDate(valueKey);
  const referenceDate = parseDateOnlyToUtcDate(referenceKey);
  return Math.round((valueDate.getTime() - referenceDate.getTime()) / (24 * 60 * 60 * 1000));
}

export function isAcademicDateInFuture(
  value: Date | string,
  now: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIMEZONE,
): boolean {
  const dateKey = getAcademicDateKey(value);
  if (!dateKey) return false;
  return dateKey > getCurrentAcademicDateKey(now, timeZone);
}

export function isAtLeastAgeYears(value: string, minAgeYears: number, now: Date = new Date()): boolean {
  if (!isValidDateOnly(value)) return false;

  const birth = parseDateOnlyToUtcDate(value);
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let age = nowUtc.getUTCFullYear() - birth.getUTCFullYear();
  const nowMonth = nowUtc.getUTCMonth();
  const birthMonth = birth.getUTCMonth();
  if (nowMonth < birthMonth || (nowMonth === birthMonth && nowUtc.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }

  return age >= minAgeYears;
}
