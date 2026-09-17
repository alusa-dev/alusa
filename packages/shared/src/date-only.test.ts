import { describe, expect, it } from 'vitest';

import {
  addAcademicDays,
  getAcademicDateBoundsForInstant,
  getAcademicDateKey,
  getCurrentAcademicDateKey,
  isAcademicDateInFuture,
} from './date-only';

describe('academic date semantics in shared', () => {
  const instant = new Date('2026-09-07T03:00:00.000Z');

  it('preserva a data civil armazenada e o timezone da Conta', () => {
    expect(getAcademicDateKey('2026-09-07T12:00:00.000Z')).toBe('2026-09-07');
    expect(getCurrentAcademicDateKey(instant, 'America/Manaus')).toBe('2026-09-06');
    expect(getAcademicDateBoundsForInstant(instant, 'America/Sao_Paulo').dateKey).toBe('2026-09-07');
  });

  it('calcula avanço e vigência por dia civil', () => {
    expect(addAcademicDays('2026-09-07', 1)).toBe('2026-09-08');
    expect(isAcademicDateInFuture('2026-09-08', instant, 'America/Sao_Paulo')).toBe(true);
  });
});
