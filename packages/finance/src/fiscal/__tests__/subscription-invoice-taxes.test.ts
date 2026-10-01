import { describe, expect, it } from 'vitest';

import { buildSubscriptionInvoiceTaxes } from '../subscription-invoice-taxes';

const service = {
  simplesNacional: false,
  retainIss: false,
  iss: 2,
  pis: null,
  cofins: null,
  csll: 0,
  inss: 0,
  ir: 0,
  nbsCode: '1.0901.21.00',
  taxSituationCode: '200001',
  taxClassificationCode: '011001',
  operationIndicatorCode: '020101',
  pisCofinsTaxStatus: null,
  operationPis: null,
  operationCofins: null,
};

describe('subscription invoice taxes', () => {
  it('omits reform fields before the regime effective date', () => {
    const taxes = buildSubscriptionInvoiceTaxes(service, '2026-09-30');

    expect(taxes).not.toHaveProperty('nbsCode');
    expect(taxes).not.toHaveProperty('taxSituationCode');
    expect(taxes).not.toHaveProperty('taxClassificationCode');
    expect(taxes).not.toHaveProperty('operationIndicatorCode');
    expect(taxes).toHaveProperty('retainIss', false);
  });

  it('includes configured reform fields from the effective date', () => {
    const taxes = buildSubscriptionInvoiceTaxes(service, '2026-10-01');

    expect(taxes).toMatchObject({
      nbsCode: '1.0901.21.00',
      taxSituationCode: '200001',
      taxClassificationCode: '011001',
      operationIndicatorCode: '020101',
    });
  });

  it('omits unconfigured optional reform fields instead of serializing null', () => {
    const taxes = buildSubscriptionInvoiceTaxes(
      { ...service, nbsCode: null, taxSituationCode: null },
      '2026-10-01',
    );

    expect(taxes).not.toHaveProperty('nbsCode');
    expect(taxes).not.toHaveProperty('taxSituationCode');
  });
});
