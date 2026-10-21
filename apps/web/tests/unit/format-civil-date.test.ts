import { describe, expect, it } from 'vitest';
import { formatCivilDate } from '@/lib/finance/format-civil-date';

describe('formatCivilDate', () => {
  it('keeps date-only values on the same civil day', () => {
    expect(formatCivilDate('2026-10-20')).toBe('20/10/2026');
    expect(formatCivilDate('2026-10-20T00:00:00.000Z')).toBe('20/10/2026');
    expect(formatCivilDate('2026-13-40')).toBe('—');
  });

  it('returns a placeholder for missing or invalid values', () => {
    expect(formatCivilDate(null)).toBe('—');
    expect(formatCivilDate('not-a-date')).toBe('—');
  });
});
