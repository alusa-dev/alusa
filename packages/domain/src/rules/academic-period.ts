export type AcademicPeriodCadence = 'ANNUAL' | 'SEMESTRAL';

export type NormalizedAcademicPeriod = {
  cadence: AcademicPeriodCadence;
  ordinal: number;
};

/** Accepts only period labels with an established calendar meaning. */
export function normalizeAcademicPeriodLabel(value: string | null | undefined): NormalizedAcademicPeriod | null {
  if (!value) return null;
  const label = value.trim();
  const annual = /^(\d{4})$/.exec(label);
  if (annual) return { cadence: 'ANNUAL', ordinal: Number(annual[1]) };

  const semester = /^(\d{4})[./_-]([12])$/.exec(label);
  if (semester) return { cadence: 'SEMESTRAL', ordinal: Number(semester[1]) * 2 + Number(semester[2]) - 1 };

  return null;
}

export function normalizeAcademicPeriodFromDate(
  value: Date | string | null | undefined,
  cadence: AcademicPeriodCadence,
): NormalizedAcademicPeriod | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return cadence === 'ANNUAL'
    ? { cadence, ordinal: year }
    : { cadence, ordinal: year * 2 + (date.getUTCMonth() >= 6 ? 1 : 0) };
}

/**
 * Interprets a legacy start date using a known annual/semester destination
 * cadence. Callers must first establish that no explicit source cycle or
 * period exists and that the persisted date range cannot infer cadence.
 */
export function inferAcademicPeriodFromStartForKnownTarget(
  start: Date | string | null | undefined,
  targetPeriodLabel: string | null | undefined,
): NormalizedAcademicPeriod | null {
  const target = normalizeAcademicPeriodLabel(targetPeriodLabel);
  if (!target) return null;
  return normalizeAcademicPeriodFromDate(start, target.cadence);
}

/** Infers only common calendar annual/semester spans; other lengths stay ambiguous. */
export function inferAcademicPeriodFromDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): NormalizedAcademicPeriod | null {
  if (!start || !end) return null;
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) return null;
  const days = (endDate.getTime() - startDate.getTime()) / 86_400_000;
  const cadence: AcademicPeriodCadence | null = days >= 300 && days <= 400
    ? 'ANNUAL'
    : days >= 150 && days <= 220
      ? 'SEMESTRAL'
      : null;
  return cadence ? normalizeAcademicPeriodFromDate(startDate, cadence) : null;
}

/** Returns null if either period is custom, ambiguous, or uses a different cadence. */
export function areAcademicPeriodsImmediatelyAdjacent(
  source: NormalizedAcademicPeriod | null,
  target: NormalizedAcademicPeriod | null,
): boolean | null {
  if (!source || !target || source.cadence !== target.cadence) return null;
  return target.ordinal === source.ordinal + 1;
}
