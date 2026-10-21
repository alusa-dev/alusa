import { describe, expect, it } from 'vitest';
import { formatInstallmentDescription, parseInstallmentDescriptionIndex } from '../installment-description';

describe('installment description ordinal', () => {
  it('preserves the base description and replaces an older local marker', () => {
    expect(formatInstallmentDescription(2, 3, 'Curso - atendimento anual'))
      .toBe('Parcela 2/3 - Curso - atendimento anual');
    expect(formatInstallmentDescription(3, 3, 'Parcela 1/3 - Curso'))
      .toBe('Parcela 3/3 - Curso');
    expect(formatInstallmentDescription(2, 3, 'Curso - Parcela 1/3'))
      .toBe('Parcela 2/3 - Curso');
    expect(formatInstallmentDescription(2, 3, 'Curso - Parcela acad. 1/3'))
      .toBe('Parcela 2/3 - Curso');
  });

  it('does not invent a marker for an invalid ordinal', () => {
    expect(formatInstallmentDescription(4, 3, 'Curso')).toBe('Curso');
    expect(formatInstallmentDescription(null, 3, 'Curso')).toBe('Curso');
  });

  it('parses only an exact local ordinal and denominator', () => {
    expect(parseInstallmentDescriptionIndex('Parcela 2/3 - Curso', 3)).toBe(2);
    expect(parseInstallmentDescriptionIndex('Curso - atendimento - Parcela 2/3', 3)).toBe(2);
    expect(parseInstallmentDescriptionIndex('Parcela acad. 2/3', 3)).toBe(2);
    expect(parseInstallmentDescriptionIndex('Curso payment:3', 3)).toBeNull();
    expect(parseInstallmentDescriptionIndex('Curso parcela 2/3 especial', 3)).toBeNull();
    expect(parseInstallmentDescriptionIndex('Parcela 2/4 - Curso', 3)).toBeNull();
    expect(parseInstallmentDescriptionIndex('Curso - Parcela 2/3', 3)).toBe(2);
  });
});
