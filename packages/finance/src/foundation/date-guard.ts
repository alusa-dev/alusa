const BRASILIA_TIME_ZONE = 'America/Sao_Paulo';

function getBrasiliaDateString(now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return dtf.format(now);
}

export function parseDateOnly(dateStr: string): Date | null {
  if (!dateStr) return null;
  const normalized = dateStr.slice(0, 10);
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isPastDate(dateStr: string, now: Date = new Date()): boolean {
  if (!dateStr) return false;
  const normalized = dateStr.slice(0, 10);
  const todayBrt = getBrasiliaDateString(now);
  return normalized < todayBrt;
}

export function isBeforeOrEqualToday(dateStr: string, now: Date = new Date()): boolean {
  if (!dateStr) return false;
  const normalized = dateStr.slice(0, 10);
  const todayBrt = getBrasiliaDateString(now);
  return normalized <= todayBrt;
}

export function getTodayBrasiliaDateString(now: Date = new Date()): string {
  return getBrasiliaDateString(now);
}
