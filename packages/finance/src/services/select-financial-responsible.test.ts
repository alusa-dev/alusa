import { describe, expect, it } from 'vitest';
import { selectFinancialResponsible } from './select-financial-responsible';

describe('selectFinancialResponsible', () => {
  it('prefers an explicit FINANCEIRO link over a PRINCIPAL/global-finance link', () => {
    expect(selectFinancialResponsible([
      { responsavelId: 'a-principal', tipoVinculo: 'PRINCIPAL', financeiro: true },
      { responsavelId: 'z-financeiro', tipoVinculo: 'FINANCEIRO', financeiro: false },
    ])?.responsavelId).toBe('z-financeiro');
  });

  it('breaks equal-priority links deterministically and ignores ineligible links', () => {
    expect(selectFinancialResponsible([
      { responsavelId: 'resp-z', tipoVinculo: 'FINANCEIRO', financeiro: false },
      { responsavelId: 'resp-a', tipoVinculo: 'FINANCEIRO', financeiro: false },
      { responsavelId: 'invalid', tipoVinculo: 'OTHER', financeiro: false },
    ])?.responsavelId).toBe('resp-a');
    expect(selectFinancialResponsible([{ responsavelId: 'invalid', tipoVinculo: 'OTHER', financeiro: false }])).toBeNull();
  });
});
