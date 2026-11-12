import type { WizardState } from './types';
import { calculateEnrollmentFinancialCondition, isEnrollmentBenefitValidityInRange } from '@alusa/domain';

export function getConditionValidityMode(state: Pick<WizardState, 'condicaoValidadeModo' | 'condicaoValidaAte' | 'dataFimContrato'>) {
  return state.condicaoValidadeModo ?? (state.condicaoValidaAte && state.condicaoValidaAte !== state.dataFimContrato ? 'PERIODO' : 'MATRICULA');
}

export function canAdvanceFinancialCondition(state: Pick<WizardState, 'condicaoFinanceira' | 'condicaoMotivo' | 'condicaoPercentual' | 'condicaoValidadeModo' | 'condicaoValidaAte' | 'dataFimContrato' | 'dataInicio'>) {
  const kind = state.condicaoFinanceira ?? 'NORMAL';
  if (kind === 'NORMAL') return true;
  if (!state.condicaoMotivo?.trim()) return false;
  const percentage = state.condicaoPercentual;
  if (kind === 'BOLSA_PARCIAL' && (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage <= 0 || percentage >= 100)) return false;
  if (getConditionValidityMode(state) === 'PERIODO') {
    const date = state.condicaoValidaAte;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    return isEnrollmentBenefitValidityInRange(date, state.dataInicio, state.dataFimContrato);
  }
  return true;
}

export function calcularDescontoCondicao(valorBase: number, state: Pick<WizardState, 'condicaoFinanceira' | 'condicaoPercentual'>) {
  return calculateEnrollmentFinancialCondition(valorBase, state).benefitAmount;
}

export function calcularValorLiquidoCondicao(valorBase: number, state: Pick<WizardState, 'condicaoFinanceira' | 'condicaoPercentual'>) {
  return calculateEnrollmentFinancialCondition(valorBase, state).monthlyAmount;
}
