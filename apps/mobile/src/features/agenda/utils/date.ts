import type { AgendaViewMode } from '../types/agenda';

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1, 12, 0, 0, 0);
  return Number.isNaN(result.getTime()) ? new Date() : result;
}

export function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * DAY_MS);
}

export function addMonths(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + amount);
  return result;
}

export function startOfWeek(date: Date) {
  const result = startOfDay(date);
  return addDays(result, -result.getDay());
}

export function startOfMonth(date: Date) {
  const result = startOfDay(date);
  result.setDate(1);
  return result;
}

export function getAgendaRange(anchor: Date, viewMode: AgendaViewMode) {
  if (viewMode === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const monthStart = startOfMonth(anchor);
  const end = new Date(monthStart);
  end.setMonth(end.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start: monthStart, end };
}

export function getMonthGrid(anchor: Date) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function partsForInstant(instant: string | Date, timeZone: string) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
  };
}

export function dateKeyInTimeZone(instant: string | Date, timeZone: string) {
  const parts = partsForInstant(instant, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function timeInTimeZone(instant: string | Date, timeZone: string) {
  const parts = partsForInstant(instant, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function dayLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone })
    .format(date)
    .replace('.', '')
    .slice(0, 3);
}

export function monthLabel(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function periodLabel(anchor: Date, viewMode: AgendaViewMode, timeZone: string) {
  const range = getAgendaRange(anchor, viewMode);
  if (viewMode === 'month-detailed') return monthLabel(range.start, timeZone);

  const start = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone })
    .format(range.start)
    .replace('.', '');
  const end = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone })
    .format(range.end)
    .replace('.', '');
  return `${start} – ${end}`;
}

export function longDateLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date);
}

export function dateInputLabel(date: Date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function combineLocalDateTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return result.toISOString();
}

export function dateAndTimeFromInstant(instant: string) {
  const date = new Date(instant);
  return {
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    time: Number.isNaN(date.getTime()) ? '08:00' : `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

export function isToday(date: Date) {
  return dateKey(date) === dateKey(new Date());
}

export function minutesInTimeZone(instant: string | Date, timeZone: string) {
  const parts = partsForInstant(instant, timeZone);
  return parts.hour * 60 + parts.minute;
}
