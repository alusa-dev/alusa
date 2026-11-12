import { describe, expect, it } from 'vitest';
import { calcularDescontoCondicao, calcularValorLiquidoCondicao, canAdvanceFinancialCondition, getConditionValidityMode } from '@/features/enrollments/components/wizard/financial-condition';

describe('condição financeira da matrícula', () => {
  it('permite pagamento normal sem motivo, percentual ou validade', () => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira: 'NORMAL' })).toBe(true);
  });

  it.each(['BOLSA_PARCIAL', 'ISENCAO_INTEGRAL'] as const)('%s permite avançar antes da etapa que define o término do contrato', (condicaoFinanceira) => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira, condicaoMotivo: 'Outro motivo', condicaoPercentual: 50, condicaoValidadeModo: 'MATRICULA' })).toBe(true);
  });

  it.each(['', '   '])('bloqueia benefício sem justificativa: %j', (condicaoMotivo) => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo })).toBe(false);
  });

  it.each([undefined, 0, -1, 100, NaN, Infinity])('bloqueia percentual inválido: %s', (condicaoPercentual) => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira: 'BOLSA_PARCIAL', condicaoMotivo: 'Convênio', condicaoPercentual })).toBe(false);
  });

  it.each([1, 48, 99])('aceita percentual válido: %s', (condicaoPercentual) => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira: 'BOLSA_PARCIAL', condicaoMotivo: 'Convênio', condicaoPercentual })).toBe(true);
  });

  it.each([undefined, '', '2027-02-30', '2027-13-01', 'invalid'])('bloqueia período determinado sem data válida: %s', (condicaoValidaAte) => {
    expect(canAdvanceFinancialCondition({ condicaoFinanceira: 'ISENCAO_INTEGRAL', condicaoMotivo: 'Bolsa de estudos', condicaoValidadeModo: 'PERIODO', condicaoValidaAte })).toBe(false);
  });

  it('preserva período determinado mesmo se a data coincidir com o término do contrato', () => {
    const condition = { condicaoFinanceira: 'ISENCAO_INTEGRAL' as const, condicaoMotivo: 'Bolsa', condicaoValidadeModo: 'PERIODO' as const, condicaoValidaAte: '2027-12-31', dataFimContrato: '2027-12-31' };
    expect(getConditionValidityMode(condition)).toBe('PERIODO');
    expect(canAdvanceFinancialCondition(condition)).toBe(true);
  });

  it('preserva validade até o término quando o contrato é alterado em outra etapa', () => {
    expect(getConditionValidityMode({ condicaoValidadeModo: 'MATRICULA', condicaoValidaAte: '2027-12-31', dataFimContrato: '2028-12-31' })).toBe('MATRICULA');
  });
  it('calcula o valor da bolsa parcial e arredonda para centavos', () => {
    const condition = { condicaoFinanceira: 'BOLSA_PARCIAL' as const, condicaoPercentual: 25 };
    expect(calcularDescontoCondicao(99.99, condition)).toBe(25);
    expect(calcularValorLiquidoCondicao(99.99, condition)).toBe(74.99);
  });

  it('isenta o valor recorrente integralmente e nunca retorna valor negativo', () => {
    const condition = { condicaoFinanceira: 'ISENCAO_INTEGRAL' as const };
    expect(calcularDescontoCondicao(150, condition)).toBe(150);
    expect(calcularValorLiquidoCondicao(150, condition)).toBe(0);
  });

  it('mantém o valor integral na condição normal', () => {
    const condition = { condicaoFinanceira: 'NORMAL' as const };
    expect(calcularDescontoCondicao(150, condition)).toBe(0);
    expect(calcularValorLiquidoCondicao(150, condition)).toBe(150);
  });
});
