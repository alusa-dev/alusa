// ============================================================================
// VALIDAÇÃO DE CAPACIDADE (genérica — matrícula e rematrícula)
// ============================================================================

export interface TurmaCapacidadeInfo {
  id: string;
  nome: string;
  capacidade: number;
  matriculasOcupantes: number;
}

export type ValidarCapacidadeResult =
  | { success: true }
  | { success: false; error: 'TURMA_SEM_VAGAS'; turmaId: string; turmaNome: string }
  | { success: false; error: 'COMBO_SEM_VAGAS' };

export function validarCapacidade(
  turmas: TurmaCapacidadeInfo[],
  combo?: { vagasLimite?: number | null; matriculasOcupantes?: number },
): ValidarCapacidadeResult {
  for (const turma of turmas) {
    if (turma.matriculasOcupantes >= turma.capacidade) {
      return { success: false, error: 'TURMA_SEM_VAGAS', turmaId: turma.id, turmaNome: turma.nome };
    }
  }

  if (
    combo?.vagasLimite != null &&
    combo.matriculasOcupantes != null &&
    combo.matriculasOcupantes >= combo.vagasLimite
  ) {
    return { success: false, error: 'COMBO_SEM_VAGAS' };
  }

  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE CONFLITOS DE HORÁRIO (genérica)
// ============================================================================

export interface HorarioTurma {
  id: string;
  nome: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
}

export type ValidarConflitosResult =
  | { success: true }
  | { success: false; error: 'CONFLITO_HORARIO'; turma1: string; turma2: string };

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((v) => Number(v || 0));
  return hours * 60 + minutes;
}

function turmasOverlap(a: HorarioTurma, b: HorarioTurma): boolean {
  const sameDay = a.diasSemana.some((dia) => b.diasSemana.includes(dia));
  if (!sameDay) return false;
  const [aStart, aEnd] = [parseTimeToMinutes(a.horaInicio), parseTimeToMinutes(a.horaFim)];
  const [bStart, bEnd] = [parseTimeToMinutes(b.horaInicio), parseTimeToMinutes(b.horaFim)];
  return aStart < bEnd && bStart < aEnd;
}

export function validarConflitosHorario(
  novasTurmas: HorarioTurma[],
  turmasExistentes: HorarioTurma[],
): ValidarConflitosResult {
  for (const nova of novasTurmas) {
    for (const existente of turmasExistentes) {
      if (nova.id === existente.id) continue;
      if (turmasOverlap(nova, existente)) {
        return { success: false, error: 'CONFLITO_HORARIO', turma1: nova.nome, turma2: existente.nome };
      }
    }
  }
  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE DATAS DE CONTRATO
// ============================================================================

export type ValidarDatasContratoResult =
  | { success: true }
  | { success: false; error: 'DATA_FIM_ANTES_INICIO' }
  | { success: false; error: 'DATA_INICIO_PASSADO' };

export function validarDatasContrato(
  dataInicio: Date,
  dataFimContrato: Date,
  options?: { permitirInicioPassado?: boolean },
): ValidarDatasContratoResult {
  if (dataFimContrato <= dataInicio) {
    return { success: false, error: 'DATA_FIM_ANTES_INICIO' };
  }
  if (!options?.permitirInicioPassado) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inicio = new Date(dataInicio);
    inicio.setHours(0, 0, 0, 0);
    if (inicio < today) {
      return { success: false, error: 'DATA_INICIO_PASSADO' };
    }
  }
  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE PAGADOR
// ============================================================================

export { resolvePayer } from './matricula-rules.js';
export type { ResolvePayerInput, ResolvePayerResult } from './matricula-rules.js';

// ============================================================================
// HELPERS PARA CONTAGEM DE VAGAS (re-export from state machine)
// ============================================================================

export { getSeatOccupyingStatuses } from './matricula-state-machine.js';
