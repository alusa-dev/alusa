import type { WizardState } from './types';
import { calculateFamilyMonthlyTotal } from './family-pricing';
import { calcularValorLiquidoCondicao } from './financial-condition';

export function calculateRecurringMonthlyTotal(state: WizardState): number {
  if (state.modoMatricula === 'FAMILIAR') {
    return calculateFamilyMonthlyTotal(state);
  }

  const baseAmount = state.modoTurmas === 'COMBO' ? state.comboValor : state.planoValor;
  return calcularValorLiquidoCondicao(baseAmount ?? 0, state);
}

export function hasRecurringMonthlyCharge(state: WizardState): boolean {
  return calculateRecurringMonthlyTotal(state) > 0;
}
