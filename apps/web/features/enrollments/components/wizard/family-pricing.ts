import type { WizardState } from './types';
import {
  calcularDescontoCondicao,
  calcularValorLiquidoCondicao,
} from './financial-condition';

/**
 * Regra única do wizard: plano é um valor por matrícula; combo é um valor por
 * aluno. O backend recalcula e confirma a mesma composição antes do commit.
 */
export function calculateFamilyMonthlyTotal(state: WizardState) {
  const total =
    state.modoTurmas === 'TURMAS'
      ? calcularValorLiquidoCondicao(state.planoValor ?? 0, state) *
        state.alunosFamiliares.length
      : state.alunosFamiliares.reduce(
          (sum, aluno) =>
            sum + calcularValorLiquidoCondicao(aluno.comboValor ?? 0, state),
          0,
        );

  return Number(total.toFixed(2));
}

export function calculateFamilyBenefitTotal(state: WizardState) {
  const total =
    state.modoTurmas === 'TURMAS'
      ? calcularDescontoCondicao(state.planoValor ?? 0, state) *
        state.alunosFamiliares.length
      : state.alunosFamiliares.reduce(
          (sum, aluno) =>
            sum + calcularDescontoCondicao(aluno.comboValor ?? 0, state),
          0,
        );

  return Number(total.toFixed(2));
}
