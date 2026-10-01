import { describe, expect, it } from 'vitest';

import { isTaxReformApplicable, validateFiscalIbsCbs } from '../ibs-cbs';

describe('IBS/CBS fiscal payload', () => {
  it('aplica a validação pelo regime declarado e pela data de emissão', () => {
    expect(isTaxReformApplicable({ simplesNacional: false, effectiveDate: '2026-09-30' })).toBe(false);
    expect(isTaxReformApplicable({ simplesNacional: false, effectiveDate: '2026-10-01' })).toBe(true);
    expect(isTaxReformApplicable({ simplesNacional: true, effectiveDate: '2026-12-31' })).toBe(false);
    expect(isTaxReformApplicable({ simplesNacional: true, effectiveDate: '2027-01-01' })).toBe(true);
  });

  it('falha fechado quando qualquer classificação está ausente', () => {
    const source = {
      nbsCode: '1.0901.21.00',
      taxSituationCode: null,
      taxClassificationCode: '011001',
      operationIndicatorCode: '020101',
    };

    expect(validateFiscalIbsCbs(source).map((issue) => issue.field)).toEqual([
      'taxSituationCode',
    ]);
  });
});
