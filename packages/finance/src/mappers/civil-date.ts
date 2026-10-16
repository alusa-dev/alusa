/**
 * Parses civil date strings without shifting their calendar day in Brazilian
 * timezones. Date-only values are anchored at noon UTC; timestamps retain
 * their original instant.
 */
export function parseCivilDatePreservingInstant(value: string | null | undefined): Date | null {
  if (!value) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, yearPart, monthPart, dayPart] = dateOnly;
    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    const parsed = new Date(Date.UTC(year, month - 1, day, 12));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) return null;
    return parsed;
  }

  const isoDatePrefix = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (isoDatePrefix) {
    const [, yearPart, monthPart, dayPart] = isoDatePrefix;
    const year = Number(yearPart);
    const month = Number(monthPart);
    const day = Number(dayPart);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day
    ) return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Returns the first parseable date, preserving the caller's source preference order. */
export function parseFirstValidCivilDatePreservingInstant(
  ...values: Array<string | null | undefined>
): Date | null {
  for (const value of values) {
    const parsed = parseCivilDatePreservingInstant(value);
    if (parsed) return parsed;
  }
  return null;
}

/** Returns null for an omitted value and undefined for an invalid value. */
export function parseOptionalCivilDatePreservingInstant(
  value: string | null | undefined,
): Date | null | undefined {
  if (value == null || value === '') return null;
  return parseCivilDatePreservingInstant(value) ?? undefined;
}
