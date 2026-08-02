import { describe, expect, it } from 'vitest';

import { buildAsaasInvoiceIbsCbs, validateFiscalIbsCbs } from '../ibs-cbs';

describe('IBS/CBS fiscal payload', () => {
  it('mapeia os cinco campos exigidos pelo contrato Asaas', () => {
    expect(buildAsaasInvoiceIbsCbs({
      nbsCode: ' 1.0901.21.00 ',
      nationalTaxCode: ' 080201 ',
      taxSituationCode: ' 200001 ',
      taxClassificationCode: ' 011001 ',
      operationIndicatorCode: ' 020101 ',
    })).toEqual({
      nbsCode: '1.0901.21.00',
      nationalServiceCode: '080201',
      taxSituation: '200001',
      taxClassification: '011001',
      operationIndicatorCode: '020101',
    });
  });

  it('falha fechado quando qualquer classificação está ausente', () => {
    const source = {
      nbsCode: '1.0901.21.00',
      nationalTaxCode: '',
      taxSituationCode: null,
      taxClassificationCode: '011001',
      operationIndicatorCode: '020101',
    };

    expect(validateFiscalIbsCbs(source).map((issue) => issue.field)).toEqual([
      'nationalTaxCode',
      'taxSituationCode',
    ]);
    expect(buildAsaasInvoiceIbsCbs(source)).toBeNull();
  });
});
