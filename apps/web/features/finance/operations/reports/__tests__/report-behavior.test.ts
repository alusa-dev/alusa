import { describe, expect, it } from 'vitest';

import { nextReportSortDirection } from '../utils/report-behavior';

describe('nextReportSortDirection', () => {
  it('inicia uma nova coluna em ordem decrescente', () => {
    expect(nextReportSortDirection('paidAt', 'asc', 'payerName')).toBe('desc');
  });

  it('alterna a direção quando a mesma coluna é selecionada novamente', () => {
    expect(nextReportSortDirection('paidAt', 'desc', 'paidAt')).toBe('asc');
    expect(nextReportSortDirection('paidAt', 'asc', 'paidAt')).toBe('desc');
  });
});
