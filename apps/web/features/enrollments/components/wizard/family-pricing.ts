import type { WizardState } from './types';
import {
  calcularValorDescontoBeneficio,
  calcularValorLiquidoComBeneficio,
} from './beneficios';

/**
 * Regra única do wizard: plano é um valor por matrícula; combo é um valor por
 * aluno. O backend recalcula e confirma a mesma composição antes do commit.
 */
export function calculateFamilyMonthlyTotal(state: WizardState) {
  const total =
    state.modoTurmas === 'TURMAS'
      ? calcularValorLiquidoComBeneficio(state.planoValor ?? 0, state.beneficioSelecionado) *
        state.alunosFamiliares.length
      : state.alunosFamiliares.reduce(
          (sum, aluno) =>
            sum + calcularValorLiquidoComBeneficio(aluno.comboValor ?? 0, state.beneficioSelecionado),
          0,
        );

  return Number(total.toFixed(2));
}

export function calculateFamilyBenefitTotal(state: WizardState) {
  const total =
    state.modoTurmas === 'TURMAS'
      ? calcularValorDescontoBeneficio(state.planoValor ?? 0, state.beneficioSelecionado) *
        state.alunosFamiliares.length
      : state.alunosFamiliares.reduce(
          (sum, aluno) =>
            sum + calcularValorDescontoBeneficio(aluno.comboValor ?? 0, state.beneficioSelecionado),
          0,
        );

  return Number(total.toFixed(2));
}
