import { describe, expect, it } from 'vitest';
import {
  areAcademicPeriodsImmediatelyAdjacent,
  inferAcademicPeriodFromDateRange,
  inferAcademicPeriodFromStartForKnownTarget,
  normalizeAcademicPeriodFromDate,
  normalizeAcademicPeriodLabel,
} from './academic-period.js';

describe('academic period normalization', () => {
  it('recognizes adjacent annual periods, including late entry dates', () => {
    const source = normalizeAcademicPeriodFromDate('2026-11-20T00:00:00.000Z', 'ANNUAL');
    const target = normalizeAcademicPeriodLabel('2027');
    expect(areAcademicPeriodsImmediatelyAdjacent(source, target)).toBe(true);
  });

  it('recognizes adjacent semester labels across a year boundary', () => {
    expect(areAcademicPeriodsImmediatelyAdjacent(
      normalizeAcademicPeriodLabel('2026.2'),
      normalizeAcademicPeriodLabel('2027.1'),
    )).toBe(true);
  });

  it('recognizes semester periods from dates when no saved period label exists', () => {
    expect(areAcademicPeriodsImmediatelyAdjacent(
      normalizeAcademicPeriodFromDate('2026-03-10T00:00:00.000Z', 'SEMESTRAL'),
      normalizeAcademicPeriodLabel('2026.2'),
    )).toBe(true);
  });

  it('leaves custom labels and mixed cadence comparisons unresolved', () => {
    expect(normalizeAcademicPeriodLabel('ciclo-outono-2027')).toBeNull();
    expect(areAcademicPeriodsImmediatelyAdjacent(
      normalizeAcademicPeriodLabel('2026'),
      normalizeAcademicPeriodLabel('2026.2'),
    )).toBeNull();
  });

  it('distinguishes a proven gap from immediate continuity', () => {
    expect(areAcademicPeriodsImmediatelyAdjacent(
      normalizeAcademicPeriodLabel('2025'),
      normalizeAcademicPeriodLabel('2027'),
    )).toBe(false);
  });

  it('infers only annual and semester date spans, leaving custom lengths ambiguous', () => {
    expect(inferAcademicPeriodFromDateRange('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'))
      .toEqual({ cadence: 'ANNUAL', ordinal: 2026 });
    expect(inferAcademicPeriodFromDateRange('2026-01-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'))
      .toEqual({ cadence: 'SEMESTRAL', ordinal: 2026 * 2 });
    expect(inferAcademicPeriodFromDateRange('2026-09-01T00:00:00.000Z', '2027-05-31T00:00:00.000Z'))
      .toBeNull();
  });

  it('uses a recognized target cadence for a legacy start date only when the caller has no period or usable range', () => {
    expect(inferAcademicPeriodFromStartForKnownTarget('2026-10-10T00:00:00.000Z', '2027'))
      .toEqual({ cadence: 'ANNUAL', ordinal: 2026 });
    expect(inferAcademicPeriodFromStartForKnownTarget('2026-10-10T00:00:00.000Z', '2027.1'))
      .toEqual({ cadence: 'SEMESTRAL', ordinal: 2026 * 2 + 1 });
    expect(inferAcademicPeriodFromStartForKnownTarget('2026-10-10T00:00:00.000Z', 'ciclo-customizado'))
      .toBeNull();
  });
});
