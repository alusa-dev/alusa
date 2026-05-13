import { TZDateMini } from '@date-fns/tz';
import { addDays, startOfWeek } from 'date-fns';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/src/prisma';

export const DEFAULT_ACCOUNT_TIMEZONE = 'America/Sao_Paulo';

export function normalizeAccountTimeZone(input: string | null | undefined): string {
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

export async function resolveAccountTimeZone(
  contaId: string,
  prismaClient: PrismaClient = prisma,
): Promise<string> {
  const conta = await prismaClient.conta.findUnique({
    where: { id: contaId },
    select: { timezone: true },
  });

  return normalizeAccountTimeZone(conta?.timezone);
}

export function startOfZonedDay(instant: Date, timeZone: string): Date {
  const tz = normalizeAccountTimeZone(timeZone);
  const z = new TZDateMini(instant.getTime(), tz);
  const start = new TZDateMini(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0, tz);
  return new Date(start.getTime());
}

export function endOfZonedDay(instant: Date, timeZone: string): Date {
  const tz = normalizeAccountTimeZone(timeZone);
  const z = new TZDateMini(instant.getTime(), tz);
  const end = new TZDateMini(z.getFullYear(), z.getMonth(), z.getDate(), 23, 59, 59, 999, tz);
  return new Date(end.getTime());
}

export function startOfZonedWeek(instant: Date, timeZone: string, weekStartsOn: 0 | 1 = 1): Date {
  const tz = normalizeAccountTimeZone(timeZone);
  const anchor = new TZDateMini(instant.getTime(), tz);
  const weekStart = startOfWeek(anchor, { weekStartsOn });
  return new Date(weekStart.getTime());
}

export function combineWallClockOnZonedCalendarDay(
  year: number,
  monthIndex: number,
  day: number,
  hhmm: string,
  timeZone: string,
): Date {
  const tz = normalizeAccountTimeZone(timeZone);
  const [hours, minutes] = hhmm.split(':').map(Number);
  const z = new TZDateMini(year, monthIndex, day, hours, minutes, 0, 0, tz);
  return new Date(z.getTime());
}

export function eachZonedCalendarDayInRange(materializeStart: Date, materializeEnd: Date, timeZone: string) {
  const tz = normalizeAccountTimeZone(timeZone);
  const startDay = startOfZonedDay(materializeStart, tz);
  const endDayStart = startOfZonedDay(materializeEnd, tz);
  const days: Array<{ year: number; monthIndex: number; day: number; jsDay: number }> = [];

  let cursor = new TZDateMini(startDay.getTime(), tz);

  while (cursor.getTime() <= endDayStart.getTime()) {
    days.push({
      year: cursor.getFullYear(),
      monthIndex: cursor.getMonth(),
      day: cursor.getDate(),
      jsDay: cursor.getDay(),
    });
    cursor = addDays(cursor, 1);
  }

  return days;
}
