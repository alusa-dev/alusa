/**
 * Regras de domínio para Rematrícula
 * 
 * Validações acadêmicas que devem ocorrer ANTES de qualquer operação financeira
 */

import type { StatusMatricula } from '@prisma/client';

// ============================================================================
// VALIDAÇÃO DE CAPACIDADE
// ============================================================================

export interface TurmaInfo {
  id: string;
  nome: string;
  capacidade: number;
  matriculasAtivas: number;
}

export interface ValidarCapacidadeInput {
  turmas: TurmaInfo[];
  comboVagasLimite?: number | null;
  comboMatriculasAtivas?: number;
  matriculaIdAtual: string; // Para não contar a matrícula atual
}

export type ValidarCapacidadeResult =
  | { success: true }
  | { success: false; error: 'TURMA_SEM_VAGAS'; turmaId: string; turmaNome: string }
  | { success: false; error: 'COMBO_SEM_VAGAS' };

export function validarCapacidadeRematricula(input: ValidarCapacidadeInput): ValidarCapacidadeResult {
  // Verificar capacidade de cada turma
  for (const turma of input.turmas) {
    if (turma.matriculasAtivas >= turma.capacidade) {
      return {
        success: false,
        error: 'TURMA_SEM_VAGAS',
        turmaId: turma.id,
        turmaNome: turma.nome,
      };
    }
  }

  // Verificar capacidade do combo (se aplicável)
  if (
    input.comboVagasLimite != null &&
    input.comboMatriculasAtivas != null &&
    input.comboMatriculasAtivas >= input.comboVagasLimite
  ) {
    return { success: false, error: 'COMBO_SEM_VAGAS' };
  }

  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE CONFLITOS DE HORÁRIO
// ============================================================================

export interface TurmaHorario {
  id: string;
  nome: string;
  diasSemana: string[];
  horaInicio: string;
  horaFim: string;
}

export interface ValidarConflitosInput {
  alunoId: string;
  novasTurmas: TurmaHorario[];
  turmasExistentes: TurmaHorario[];
  matriculaIdAtual: string;
}

export type ValidarConflitosResult =
  | { success: true }
  | { success: false; error: 'CONFLITO_HORARIO'; turma1: string; turma2: string };

function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((v) => Number(v || 0));
  return hours * 60 + minutes;
}

function turmasOverlap(a: TurmaHorario, b: TurmaHorario): boolean {
  // Verifica se há dia em comum
  const sameDay = a.diasSemana.some((dia) => b.diasSemana.includes(dia));
  if (!sameDay) return false;

  // Verifica sobreposição de horário
  const [aStart, aEnd] = [parseTimeToMinutes(a.horaInicio), parseTimeToMinutes(a.horaFim)];
  const [bStart, bEnd] = [parseTimeToMinutes(b.horaInicio), parseTimeToMinutes(b.horaFim)];
  return aStart < bEnd && bStart < aEnd;
}

export function validarConflitosRematricula(input: ValidarConflitosInput): ValidarConflitosResult {
  for (const nova of input.novasTurmas) {
    for (const existente of input.turmasExistentes) {
      if (nova.id === existente.id) continue; // Mesma turma, não é conflito
      if (turmasOverlap(nova, existente)) {
        return {
          success: false,
          error: 'CONFLITO_HORARIO',
          turma1: nova.nome,
          turma2: existente.nome,
        };
      }
    }
  }
  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE DATAS
// ============================================================================

export interface ValidarDatasInput {
  dataFimContratoOrigem: Date;
  novaDataInicio: Date;
  novaDataFimContrato: Date;
}

export type ValidarDatasResult =
  | { success: true }
  | { success: false; error: 'DATA_INICIO_INVALIDA' }
  | { success: false; error: 'DATA_FIM_ANTES_INICIO' };

function normalizeToUtcDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function validarDatasRematricula(input: ValidarDatasInput): ValidarDatasResult {
  const dataFimContratoOrigem = normalizeToUtcDateOnly(input.dataFimContratoOrigem);
  const novaDataInicio = normalizeToUtcDateOnly(input.novaDataInicio);
  const novaDataFimContrato = normalizeToUtcDateOnly(input.novaDataFimContrato);

  // Nova data de início deve ser >= data fim do contrato original
  if (novaDataInicio < dataFimContratoOrigem) {
    return { success: false, error: 'DATA_INICIO_INVALIDA' };
  }

  // Data fim deve ser após data início
  if (novaDataFimContrato <= novaDataInicio) {
    return { success: false, error: 'DATA_FIM_ANTES_INICIO' };
  }

  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE STATUS
// ============================================================================

const STATUSES_ELEGIVEL_REMATRICULA: StatusMatricula[] = ['ATIVA', 'PAUSADA'];

export interface ValidarElegibilidadeInput {
  status: StatusMatricula;
  contratoExpirado: boolean;
}

export type ValidarElegibilidadeResult =
  | { success: true }
  | { success: false; error: 'STATUS_INVALIDO' }
  | { success: false; error: 'CONTRATO_EXPIRADO' };

export function validarElegibilidadeRematricula(input: ValidarElegibilidadeInput): ValidarElegibilidadeResult {
  if (!STATUSES_ELEGIVEL_REMATRICULA.includes(input.status)) {
    return { success: false, error: 'STATUS_INVALIDO' };
  }

  // Bloquear rematrícula de contratos expirados há muito tempo (> 90 dias)
  if (input.contratoExpirado) {
    return { success: false, error: 'CONTRATO_EXPIRADO' };
  }

  return { success: true };
}
