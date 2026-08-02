import { describe, expect, it } from 'vitest';

import {
  filterPisCofinsTaxStatusOptions,
  formatPisCofinsTaxStatusOption,
  getPisCofinsTaxStatusLabel,
  isPisCofinsTaxStatusRequired,
  isValidPisCofinsTaxStatus,
  normalizePisCofinsTaxRates,
  normalizeOperationPisCofinsRates,
  normalizePisCofinsTaxStatus,
  PIS_COFINS_TAX_STATUS_OPTIONS,
  validatePisCofinsTaxRules,
} from '../pis-cofins-tax-status';
import { buildAsaasInvoiceTaxes } from '../invoice-taxes';

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

  it('indica obrigatoriedade para Regime Normal fora do Simples', () => {
    expect(
      isPisCofinsTaxStatusRequired({ simplesNacional: false, useNationalPortal: false }),
    ).toBe(true);
    expect(
      isPisCofinsTaxStatusRequired({ simplesNacional: true, useNationalPortal: true }),
    ).toBe(false);
  });

  it('exige situação tributária no Regime Normal fora do Simples', () => {
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
      operationPis: 0,
      operationCofins: 0,
    });

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['operationPis', 'operationCofins']),
    );
  });

  it('exige zero para operação tributável com alíquota zero', () => {
    const issues = validatePisCofinsTaxRules({
      pisCofinsTaxStatus: 'ZERO_RATE_TAXABLE_OPERATION',
      pis: 0.65,
      cofins: 3,
      operationPis: 0.65,
      operationCofins: 3,
    });

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['operationPis', 'operationCofins']),
    );
  });

  it('preserva alíquotas retidas e normaliza apenas alíquotas de operação', () => {
    expect(
      normalizePisCofinsTaxRates({
        pisCofinsTaxStatus: 'NON_TAXABLE_OPERATION',
        pis: 0,
        cofins: 0,
      }),
    ).toEqual({ pis: 0, cofins: 0 });
    expect(
      normalizeOperationPisCofinsRates({
        pisCofinsTaxStatus: 'NON_TAXABLE_OPERATION',
        operationPis: 0,
        operationCofins: 0,
      }),
    ).toEqual({ operationPis: null, operationCofins: null });
  });

  it('migra enum depreciado para isenção nas novas gravações', () => {
    expect(normalizePisCofinsTaxStatus('TAXABLE_CONTRIBUTION_OPERATION')).toBe(
      'EXEMPT_CONTRIBUTION_OPERATION',
    );
  });

  it('não envia pisCofinsRetentionType e ativa NT-007 para Regime Normal', () => {
    const taxes = buildAsaasInvoiceTaxes({
      simplesNacional: false,
      retainIss: false,
      iss: 2,
      pis: null,
      cofins: null,
      csll: 0,
      inss: 0,
      ir: 0,
      pisCofinsTaxStatus: 'STANDARD_TAXABLE_OPERATION',
      operationPis: 0.65,
      operationCofins: 3,
    });

    expect(taxes).toMatchObject({
      pisCofinsTaxStatus: 'STANDARD_TAXABLE_OPERATION',
      operationPis: 0.65,
      operationCofins: 3,
      useTaxSystemReformNT007: true,
    });
    expect('pisCofinsRetentionType' in taxes).toBe(false);
  });

  it('envia payload tributário completo e explícito para Simples Nacional', () => {
    const taxes = buildAsaasInvoiceTaxes({
      simplesNacional: true,
      retainIss: false,
      iss: 2,
      pis: null,
      cofins: null,
      csll: 0,
      inss: 0,
      ir: 0,
      pisCofinsTaxStatus: 'STANDARD_TAXABLE_OPERATION',
      operationPis: 0.65,
      operationCofins: 3,
    });

    expect(taxes.pisCofinsTaxStatus).toBeNull();
    expect(taxes.operationPis).toBeNull();
    expect(taxes.operationCofins).toBeNull();
    expect(taxes.nbsCode).toBeNull();
    expect(taxes.useTaxSystemReformNT007).toBe(false);
  });
});
