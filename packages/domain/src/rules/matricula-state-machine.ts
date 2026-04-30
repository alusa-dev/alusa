import type { StatusMatricula } from '@prisma/client';

// ============================================================================
// ESTADOS TERMINAIS E TRANSIÇÕES VÁLIDAS
// ============================================================================

const TERMINAL_STATUSES: readonly StatusMatricula[] = ['CANCELADA', 'RECUSADA'] as const;

const VALID_TRANSITIONS: Record<StatusMatricula, readonly StatusMatricula[]> = {
  PENDENTE_TAXA: ['ATIVA', 'CANCELADA', 'RECUSADA'],
  AGUARDANDO_CONFIRMACAO: ['ATIVA', 'CANCELADA', 'RECUSADA'],
  ATIVA: ['PAUSADA', 'CANCELADA'],
  PAUSADA: ['ATIVA', 'CANCELADA'],
  RECUSADA: [],
  CANCELADA: [],
};

// Status que ocupam vaga na turma (canonical)
const SEAT_OCCUPYING: readonly StatusMatricula[] = [
  'PENDENTE_TAXA',
  'AGUARDANDO_CONFIRMACAO',
  'ATIVA',
] as const;

// Status elegíveis para rematrícula
const ELEGIVEL_REMATRICULA: readonly StatusMatricula[] = ['ATIVA', 'PAUSADA'] as const;

// Status que impedem edição estrutural (turma, plano, combo)
const BLOCKS_STRUCTURAL_EDIT: readonly StatusMatricula[] = ['CANCELADA', 'RECUSADA'] as const;

// ============================================================================
// FUNÇÕES PÚBLICAS
// ============================================================================

export function isTerminalStatus(status: StatusMatricula): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransition(from: StatusMatricula, to: StatusMatricula): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

export type TransitionResult =
  | { success: true }
  | { success: false; error: 'STATUS_TERMINAL'; from: string }
  | { success: false; error: 'TRANSICAO_INVALIDA'; from: string; to: string };

export function validateTransition(from: StatusMatricula, to: StatusMatricula): TransitionResult {
  if (isTerminalStatus(from)) {
    return { success: false, error: 'STATUS_TERMINAL', from };
  }
  if (!canTransition(from, to)) {
    return { success: false, error: 'TRANSICAO_INVALIDA', from, to };
  }
  return { success: true };
}

export function occupiesSeat(status: StatusMatricula): boolean {
  return (SEAT_OCCUPYING as readonly string[]).includes(status);
}

/**
 * Determina se uma matrícula pausada ocupa vaga com base na flag manterVaga.
 * PAUSADA com manterVaga=true ocupa vaga; com manterVaga=false não ocupa.
 */
export function occupiesSeatWithPause(status: StatusMatricula, manterVaga: boolean): boolean {
  if (status === 'PAUSADA') return manterVaga;
  return occupiesSeat(status);
}

export function getSeatOccupyingStatuses(): StatusMatricula[] {
  return [...SEAT_OCCUPYING];
}

export function isElegivelRematricula(status: StatusMatricula): boolean {
  return (ELEGIVEL_REMATRICULA as readonly string[]).includes(status);
}

export function canEditStructural(status: StatusMatricula): boolean {
  return !(BLOCKS_STRUCTURAL_EDIT as readonly string[]).includes(status);
}

export function getTerminalStatuses(): StatusMatricula[] {
  return [...TERMINAL_STATUSES];
}

export function getValidTransitions(from: StatusMatricula): StatusMatricula[] {
  return [...(VALID_TRANSITIONS[from] ?? [])];
}

// ============================================================================
// VALIDAÇÃO DE PAUSA
// ============================================================================

export type PausaValidationResult =
  | { success: true }
  | { success: false; error: 'MATRICULA_NAO_ATIVA' }
  | { success: false; error: 'MATRICULA_JA_PAUSADA' };

export function validatePausa(status: StatusMatricula, pausaAtiva: boolean): PausaValidationResult {
  if (pausaAtiva) return { success: false, error: 'MATRICULA_JA_PAUSADA' };
  if (status !== 'ATIVA') return { success: false, error: 'MATRICULA_NAO_ATIVA' };
  return { success: true };
}

// ============================================================================
// VALIDAÇÃO DE REATIVAÇÃO
// ============================================================================

export type ReativacaoValidationResult =
  | { success: true }
  | { success: false; error: 'MATRICULA_NAO_PAUSADA' }
  | { success: false; error: 'SEM_VAGA_PARA_REATIVACAO' };

export function validateReativacao(
  status: StatusMatricula,
  manterVaga: boolean,
  capacidadeDisponivel?: boolean,
): ReativacaoValidationResult {
  if (status !== 'PAUSADA') return { success: false, error: 'MATRICULA_NAO_PAUSADA' };
  if (!manterVaga && capacidadeDisponivel === false) {
    return { success: false, error: 'SEM_VAGA_PARA_REATIVACAO' };
  }
  return { success: true };
}
