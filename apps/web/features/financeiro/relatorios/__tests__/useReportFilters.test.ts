import { describe, expect, it } from 'vitest';

import { getCurrentMonthRange, normalizeCivilDate } from '../hooks/useReportFilters';

describe('getCurrentMonthRange', () => {
  it('gera datas civis completas para o mês atual', () => {
    expect(getCurrentMonthRange(new Date(2026, 6, 30))).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
  });

  it('respeita fevereiro em ano bissexto', () => {
    expect(getCurrentMonthRange(new Date(2028, 1, 10))).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
  });

  it('descarta datas incompletas ou civis inválidas vindas da URL', () => {
    expect(normalizeCivilDate('2026-31', '2026-07-31')).toBe('2026-07-31');
    expect(normalizeCivilDate('2026-02-30', '2026-02-28')).toBe('2026-02-28');
    expect(normalizeCivilDate('2026-07-15', '2026-07-31')).toBe('2026-07-15');
  });
});
