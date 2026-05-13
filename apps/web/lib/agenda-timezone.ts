import { TZDateMini } from '@date-fns/tz';
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import type { Locale } from 'date-fns';
import { format } from 'date-fns';

export const DEFAULT_ACCOUNT_TIMEZONE = 'America/Sao_Paulo';

export type AgendaCalendarViewMode = 'week' | 'month-compact' | 'month-detailed';

/** Client-safe IANA normalization (must stay free of server-only imports). */
export function normalizeAccountTimeZoneClient(input: string | null | undefined): string {
  const fallback = DEFAULT_ACCOUNT_TIMEZONE;
  if (!input?.trim()) return fallback;

  const tz = input.trim();

  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date(0));
    return tz;
  } catch {
    return fallback;
  }
}

export function startOfZonedDayClient(instant: Date, timeZone: string): Date {
  const tz = normalizeAccountTimeZoneClient(timeZone);
  const z = new TZDateMini(instant.getTime(), tz);
  const start = new TZDateMini(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0, tz);
  return new Date(start.getTime());
}

export function endOfZonedDayClient(instant: Date, timeZone: string): Date {
  const tz = normalizeAccountTimeZoneClient(timeZone);
  const z = new TZDateMini(instant.getTime(), tz);
  const end = new TZDateMini(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999, tz);
  return new Date(end.getTime());
}

/** Each midnight instant that starts a calendar day in `timeZone`, from first to last day overlapping the range. */
export function eachZonedCalendarDayInRangeClient(rangeStart: Date, rangeEnd: Date, timeZone: string): Date[] {
  const tz = normalizeAccountTimeZoneClient(timeZone);
  let cursor = new TZDateMini(startOfZonedDayClient(rangeStart, tz).getTime(), tz);
  const endDayStart = startOfZonedDayClient(rangeEnd, tz);
  const days: Date[] = [];

  while (cursor.getTime() <= endDayStart.getTime()) {
    days.push(new Date(cursor.getTime()));
    cursor = addDays(cursor, 1);
  }

  return days;
}

export function zonedCalendarDayDiffMs(first: Date, second: Date, timeZone: string): number {
  const a = startOfZonedDayClient(first, timeZone).getTime();
  const b = startOfZonedDayClient(second, timeZone).getTime();
  return a - b;
}

export function getZonedMinutesFromMidnight(instant: Date, timeZone: string): number {
  const z = new TZDateMini(instant.getTime(), normalizeAccountTimeZoneClient(timeZone));
  return z.getHours() * 60 + z.getMinutes();
}

export function formatInstantInAccountZone(
  instant: string | Date,
  fmt: string,
  timeZone: string,
  options?: { locale?: Locale },
): string {
  const ms = typeof instant === 'string' ? new Date(instant).getTime() : instant.getTime();
  const z = new TZDateMini(ms, normalizeAccountTimeZoneClient(timeZone));
  return format(z, fmt, options?.locale ? { locale: options.locale } : undefined);
}

/** Naive `YYYY-MM-DDTHH:mm` interpreted as wall time in the account zone → UTC ISO. */
export function zonedNaiveToUtcIso(naive: string, timeZone: string): string {
  const [datePart, timePart = ''] = naive.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh = 0, mm = 0] = (timePart.slice(0, 5) || '00:00').split(':').map(Number);

  if (!y || !m || !d) {
    return new Date(NaN).toISOString();
  }

  const tz = normalizeAccountTimeZoneClient(timeZone);
  const z = new TZDateMini(y, m - 1, d, hh, mm, 0, 0, tz);
  return new Date(z.getTime()).toISOString();
}

export function utcIsoToZonedNaive(iso: string, timeZone: string): string {
  const z = new TZDateMini(new Date(iso).getTime(), normalizeAccountTimeZoneClient(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}T${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

export function getDefaultStartNaive(timeZone: string): string {
  const z = new TZDateMini(Date.now(), normalizeAccountTimeZoneClient(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}T00:00`;
}

export function buildZonedAgendaRangeIso(
  anchor: Date,
  viewMode: AgendaCalendarViewMode,
  timeZone: string,
): { start: string; end: string } {
  const tz = normalizeAccountTimeZoneClient(timeZone);
  const zAnchor = new TZDateMini(anchor.getTime(), tz);

  if (viewMode === 'week') {
    const wStart = startOfWeek(zAnchor, { weekStartsOn: 1 });
    const wEnd = endOfWeek(zAnchor, { weekStartsOn: 1 });
    return {
      start: new Date(wStart.getTime()).toISOString(),
      end: new Date(wEnd.getTime()).toISOString(),
    };
  }

  const mStart = startOfMonth(zAnchor);
  const mEnd = endOfMonth(zAnchor);
  return {
    start: new Date(mStart.getTime()).toISOString(),
    end: new Date(mEnd.getTime()).toISOString(),
  };
}

export function buildZonedDayRangeIso(anchor: Date, timeZone: string): { start: string; end: string } {
  const start = startOfZonedDayClient(anchor, timeZone);
  const end = endOfZonedDayClient(anchor, timeZone);
  return { start: start.toISOString(), end: end.toISOString() };
}
