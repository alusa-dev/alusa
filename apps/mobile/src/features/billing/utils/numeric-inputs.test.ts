import {
  currencyAmountToCents,
  currencyTextToCents,
  formatCurrencyCents,
  normalizePercentageOnBlur,
  parseDecimalInput,
  percentageValidationMessage,
  sanitizePercentageInput,
} from './numeric-inputs';

describe('billing numeric inputs', () => {
  it('mantém moeda em centavos e formata no padrão brasileiro', () => {
    expect(currencyAmountToCents(1234.56)).toBe(123456);
    expect(currencyTextToCents('1.234,56')).toBe(123456);
    expect(formatCurrencyCents(123456)).toBe('1.234,56');
  });

  it('preserva estados intermediários de porcentagem durante a digitação', () => {
    expect(sanitizePercentageInput('5')).toBe('5');
    expect(sanitizePercentageInput('5,')).toBe('5,');
    expect(sanitizePercentageInput('5,367')).toBe('5,36');
  });

  it('normaliza porcentagem somente ao perder o foco', () => {
    expect(normalizePercentageOnBlur('5,3')).toBe('5,30');
    expect(parseDecimalInput('5,30')).toBe(5.3);
  });

  it('informa percentual acima de 100 sem substituir a digitação', () => {
    expect(sanitizePercentageInput('536')).toBe('536');
    expect(percentageValidationMessage('536')).toBe('O percentual máximo é 100,00%.');
  });
});
