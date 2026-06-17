import { describe, expect, it } from 'vitest';

import {
  filterPisCofinsTaxStatusOptions,
  formatPisCofinsTaxStatusOption,
  getPisCofinsTaxStatusLabel,
  isPisCofinsTaxStatusRequired,
  isValidPisCofinsTaxStatus,
  normalizePisCofinsTaxRates,
  PIS_COFINS_TAX_STATUS_OPTIONS,
  validatePisCofinsTaxRules,
} from '../pis-cofins-tax-status';

describe('pis-cofins-tax-status', () => {
  it('expõe todas as opções documentadas pelo Asaas', () => {
    expect(PIS_COFINS_TAX_STATUS_OPTIONS.length).toBeGreaterThanOrEqual(30);
    expect(PIS_COFINS_TAX_STATUS_OPTIONS[0]?.value).toBe('NONE');
  });

  it('filtra por código, valor ou descrição', () => {
    const results = filterPisCofinsTaxStatusOptions('alíquota básica');
    expect(results.some((item) => item.value === 'STANDARD_TAXABLE_OPERATION')).toBe(true);
  });

  it('valida valores conhecidos', () => {
    expect(isValidPisCofinsTaxStatus('STANDARD_TAXABLE_OPERATION')).toBe(true);
    expect(isValidPisCofinsTaxStatus('INVALID')).toBe(false);
  });

  it('formata rótulo amigável', () => {
    const option = PIS_COFINS_TAX_STATUS_OPTIONS.find(
      (item) => item.value === 'STANDARD_TAXABLE_OPERATION',
    );
    expect(option).toBeDefined();
    expect(formatPisCofinsTaxStatusOption(option!)).toContain('01');
    expect(getPisCofinsTaxStatusLabel('STANDARD_TAXABLE_OPERATION')).toContain('Alíquota Básica');
  });

  it('indica obrigatoriedade no Portal Nacional fora do Simples', () => {
    expect(
      isPisCofinsTaxStatusRequired({ simplesNacional: false, useNationalPortal: true }),
    ).toBe(true);
    expect(
      isPisCofinsTaxStatusRequired({ simplesNacional: true, useNationalPortal: true }),
    ).toBe(false);
  });

  it('exige situação tributária no Portal Nacional fora do Simples', () => {
    const issues = validatePisCofinsTaxRules({
      simplesNacional: false,
      useNationalPortal: true,
      pis: 0.65,
      cofins: 3,
    });

    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'pisCofinsTaxStatus' }),
    );
  });

  it('exige alíquotas positivas para situações tributáveis', () => {
    const issues = validatePisCofinsTaxRules({
      simplesNacional: false,
      useNationalPortal: true,
      pisCofinsTaxStatus: 'STANDARD_TAXABLE_OPERATION',
      pis: 0,
      cofins: 0,
    });

    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(['pis', 'cofins']));
  });

  it('exige zero para operação tributável com alíquota zero', () => {
    const issues = validatePisCofinsTaxRules({
      pisCofinsTaxStatus: 'ZERO_RATE_TAXABLE_OPERATION',
      pis: 0.65,
      cofins: 3,
    });

    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(['pis', 'cofins']));
  });

  it('normaliza alíquotas que a API Asaas exige como null', () => {
    expect(
      normalizePisCofinsTaxRates({
        pisCofinsTaxStatus: 'NON_TAXABLE_OPERATION',
        pis: 0,
        cofins: 0,
      }),
    ).toEqual({ pis: null, cofins: null });
  });
});
