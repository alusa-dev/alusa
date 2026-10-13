/**
 * Converts a datetime-local value to a stable ISO carrier without interpreting
 * it in the browser timezone. For map sessions, the UTC marker preserves the
 * civil date/time components entered by the school.
 */
export function mapSessionDateTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00.000Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) return null;
  return iso;
}

export function shouldCaptureEventMapLocalSchedule(input: {
  currentLocal: string | null | undefined;
  initialInput: string;
  nextInput: string;
  explicitlyConfirmed: boolean;
}) {
  return input.nextInput !== input.initialInput || (!input.currentLocal && input.explicitlyConfirmed);
}

/** Formats a map session's civil date/time without applying a runtime timezone. */
export function formatMapSessionDateTime(value?: string | null, startsAtLocal?: string | null) {
  if (!value) return '-';
  if (startsAtLocal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsAtLocal)) {
    const localDate = new Date(`${startsAtLocal}:00.000Z`);
    if (!Number.isNaN(localDate.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }).format(localDate);
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
