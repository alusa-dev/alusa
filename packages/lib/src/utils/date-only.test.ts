import { describe, expect, it } from 'vitest';

import {
  addAcademicDays,
  getAcademicDateBoundsForInstant,
  getAcademicDateBoundsForStoredDate,
  getAcademicDateKey,
  getAcademicDateDifference,
  getCurrentAcademicDateKey,
  isAcademicDateInFuture,
} from './date-only';

describe('academic date semantics', () => {
  const schoolDayStart = new Date('2026-09-07T04:30:00.000Z');

  it('keeps the persisted civil date independent from its noon UTC storage convention', () => {
    expect(getAcademicDateKey('2026-09-07T12:00:00.000Z')).toBe('2026-09-07');
    expect(getAcademicDateBoundsForStoredDate('2026-09-07T12:00:00.000Z')).toEqual({
      dateKey: '2026-09-07',
      start: new Date('2026-09-07T00:00:00.000Z'),
      end: new Date('2026-09-07T23:59:59.999Z'),
    });
  });

  it.each([
    ['America/Sao_Paulo', '2026-09-07'],
    ['America/Manaus', '2026-09-07'],
  ])('resolves the current academic day in %s', (timeZone, expected) => {
    expect(getCurrentAcademicDateKey(schoolDayStart, timeZone)).toBe(expected);
    expect(getAcademicDateBoundsForInstant(schoolDayStart, timeZone).dateKey).toBe(expected);
  });

  it('treats the same date as current before and after noon UTC', () => {
    const today = '2026-09-07T12:00:00.000Z';
    expect(isAcademicDateInFuture(today, new Date('2026-09-07T04:30:00.000Z'), 'America/Sao_Paulo')).toBe(false);
    expect(isAcademicDateInFuture(today, new Date('2026-09-07T18:00:00.000Z'), 'America/Sao_Paulo')).toBe(false);
  });

  it('differentiates tomorrow and yesterday by the school calendar', () => {
    expect(isAcademicDateInFuture('2026-09-08T12:00:00.000Z', schoolDayStart, 'America/Sao_Paulo')).toBe(true);
    expect(isAcademicDateInFuture('2026-09-06T12:00:00.000Z', schoolDayStart, 'America/Sao_Paulo')).toBe(false);
  });

  it('calcula diferença e avanço por dia civil', () => {
    expect(getAcademicDateDifference('2026-09-07T12:00:00.000Z', schoolDayStart, 'America/Sao_Paulo')).toBe(0);
    expect(getAcademicDateDifference('2026-09-06T12:00:00.000Z', schoolDayStart, 'America/Sao_Paulo')).toBe(-1);
    expect(addAcademicDays('2026-09-07', 1)).toBe('2026-09-08');
  });
});
