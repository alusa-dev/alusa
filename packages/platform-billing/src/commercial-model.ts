export const SCHOOL_PRICE_BANDS = [
  { code: 'BAND_001_025', minStudents: 1, maxStudents: 25, amountCents: 16_900, name: '1–25 alunos', label: 'Até 25 alunos' },
  { code: 'BAND_026_050', minStudents: 26, maxStudents: 50, amountCents: 22_900, name: '26–50 alunos', label: '26 a 50 alunos' },
  { code: 'BAND_051_100', minStudents: 51, maxStudents: 100, amountCents: 28_900, name: '51–100 alunos', label: '51 a 100 alunos' },
  { code: 'BAND_101_150', minStudents: 101, maxStudents: 150, amountCents: 34_900, name: '101–150 alunos', label: '101 a 150 alunos' },
  { code: 'BAND_151_200', minStudents: 151, maxStudents: 200, amountCents: 41_900, name: '151–200 alunos', label: '151 a 200 alunos' },
  { code: 'BAND_201_300', minStudents: 201, maxStudents: 300, amountCents: 47_900, name: '201–300 alunos', label: '201 a 300 alunos' },
  { code: 'BAND_301_400', minStudents: 301, maxStudents: 400, amountCents: 55_900, name: '301–400 alunos', label: '301 a 400 alunos' },
  { code: 'BAND_401_500', minStudents: 401, maxStudents: 500, amountCents: 64_900, name: '401–500 alunos', label: '401 a 500 alunos' },
] as const;

export type SchoolPriceBandCode = (typeof SCHOOL_PRICE_BANDS)[number]['code'];
export const SCHOOL_PRICE_BAND_RANKS = Object.freeze(Object.fromEntries(
  SCHOOL_PRICE_BANDS.map((band, index) => [band.code, index + 1]),
) as Record<SchoolPriceBandCode, number>);

export function isSchoolPriceBandCode(value: unknown): value is SchoolPriceBandCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCHOOL_PRICE_BAND_RANKS, value);
}

export function getSchoolPriceBandRank(code: SchoolPriceBandCode): number {
  return SCHOOL_PRICE_BAND_RANKS[code];
}

export type SchoolCommercialTarget =
  | { kind: 'SELF_SERVICE'; band: (typeof SCHOOL_PRICE_BANDS)[number] }
  | { kind: 'SPECIALIST'; band: null };

/** Resolve a band from a server-computed distinct-student count. */
export function resolveSchoolCommercialTarget(studentCount: number): SchoolCommercialTarget | null {
  if (!Number.isSafeInteger(studentCount) || studentCount < 0) return null;
  if (studentCount === 0) return { kind: 'SELF_SERVICE', band: SCHOOL_PRICE_BANDS[0] };
  if (studentCount > 500) return { kind: 'SPECIALIST', band: null };
  const band = SCHOOL_PRICE_BANDS.find(({ minStudents, maxStudents }) =>
    studentCount >= minStudents && studentCount <= maxStudents,
  );
  return band ? { kind: 'SELF_SERVICE', band } : null;
}

/** Do not change a customer's recurring price until three consecutive closes agree. */
export function shouldApplySchoolPriceBand(input: {
  currentBand: SchoolPriceBandCode | 'CUSTOM' | null;
  candidateBand: SchoolPriceBandCode | 'CUSTOM';
  consecutiveMonthlyCloses: number;
}): boolean {
  return input.candidateBand !== input.currentBand && input.consecutiveMonthlyCloses >= 3;
}

export function resolveStableSchoolPriceBand(input: {
  currentBand: SchoolPriceBandCode | 'CUSTOM' | null;
  snapshots: Array<{ periodStart: Date | string; candidateBand: SchoolPriceBandCode | 'SPECIALIST' | null }>;
}): SchoolPriceBandCode | 'SPECIALIST' | null {
  const latest = [...input.snapshots]
    .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())
    .slice(0, 3);
  if (latest.length < 3) return null;
  const [newest, second, third] = latest;
  const sameBand = newest.candidateBand === second.candidateBand && second.candidateBand === third.candidateBand;
  const consecutiveMonths = isPreviousUtcMonth(new Date(newest.periodStart), new Date(second.periodStart)) &&
    isPreviousUtcMonth(new Date(second.periodStart), new Date(third.periodStart));
  if (!sameBand || !consecutiveMonths || newest.candidateBand === input.currentBand) return null;
  return newest.candidateBand;
}

/** One pupil is counted once when any active, effective enrollment has a paid cycle. */
export function hasBillableEnrollment(input: {
  active: boolean;
  effective: boolean;
  cycleAmountCents: number | null;
  fullScholarship: boolean;
}): boolean {
  return input.active && input.effective && !input.fullScholarship &&
    input.cycleAmountCents !== null && Number.isFinite(input.cycleAmountCents) &&
    input.cycleAmountCents > 0;
}

function isPreviousUtcMonth(newer: Date, older: Date): boolean {
  const expected = new Date(Date.UTC(newer.getUTCFullYear(), newer.getUTCMonth() - 1, 1));
  return expected.getUTCFullYear() === older.getUTCFullYear() && expected.getUTCMonth() === older.getUTCMonth();
}
