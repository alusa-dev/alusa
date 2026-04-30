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
