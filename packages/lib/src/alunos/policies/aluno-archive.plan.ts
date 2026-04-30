import type { StatusMatricula } from '@prisma/client';

import { getSeatOccupyingStatuses } from '../../services/matricula-occupancy';

/**
 * Status de matrícula que requerem cancelamento ao arquivar o aluno.
 * Inclui todos os status que "ocupam vaga" + PAUSADA (trancada, mas ainda vinculada)
 */
export const MATRICULA_STATUSES_TO_CANCEL: StatusMatricula[] = [
  ...getSeatOccupyingStatuses(),
  'PAUSADA',
];

/**
 * Ação planejada para uma matrícula durante arquivamento de aluno
 */
export type MatriculaArchiveAction = {
  matriculaId: string;
  currentStatus: StatusMatricula;
  targetStatus: 'CANCELADA';
  hasSubscription: boolean;
  /**
   * Tipo de ação necessária:
   * - DELETE_SUBSCRIPTION: Cancelar assinatura no Asaas + atualizar local
   * - LOCAL_ONLY: Apenas atualizar status local (sem assinatura)
   */
  requiredAction: 'DELETE_SUBSCRIPTION' | 'LOCAL_ONLY';
};

/**
 * Plano de arquivamento de aluno
 * 
 * Este é um objeto de dados puro que descreve O QUE fazer,
 * sem executar nenhuma ação. A execução é feita por um orchestrator.
 */
export type AlunoArchivePlan = {
  alunoId: string;
  contaId: string;
  alunoNome: string;
  alunoCurrentStatus: string;
  
  /**
   * Lista de ações planejadas para matrículas
   */
  matriculaActions: MatriculaArchiveAction[];
  
  /**
   * Se true, aluno possui matrículas ativas que serão canceladas
   */
  hasActiveMatriculas: boolean;
  
  /**
   * Quantidade de assinaturas que serão canceladas no Asaas
   */
  subscriptionsToCancel: number;
  
  /**
   * Quantidade de matrículas que serão atualizadas apenas localmente
   */
  localOnlyUpdates: number;
  
  /**
   * Motivo do arquivamento (para auditoria)
   */
  motivo: string;
  
  /**
   * Actor que iniciou a ação
   */
  actorId: string;
};

/**
 * Dados mínimos de aluno necessários para construir o plano
 */
export type AlunoForPlan = {
  id: string;
  nome: string;
  status: string;
};

/**
 * Dados mínimos de matrícula necessários para construir o plano
 */
export type MatriculaForPlan = {
  id: string;
  status: StatusMatricula;
  asaasSubscriptionId: string | null;
};

export type BuildAlunoArchivePlanInput = {
  aluno: AlunoForPlan;
  matriculas: MatriculaForPlan[];
  contaId: string;
  motivo?: string;
  actorId?: string;
};

/**
 * Constrói um plano de arquivamento de aluno.
 * 
 * Esta função é PURA - não acessa banco de dados nem APIs externas.
 * Recebe dados e retorna um plano descritivo.
 * 
 * @example
 * const plan = buildAlunoArchivePlan({
 *   aluno: { id: '...', nome: 'João', status: 'ATIVO' },
 *   matriculas: [...],
 *   contaId: '...',
 * });
 * 
 * // Depois, o orchestrator executa o plano:
 * const result = await executeAlunoArchivePlan(plan);
 */
export function buildAlunoArchivePlan(input: BuildAlunoArchivePlanInput): AlunoArchivePlan {
  const { aluno, matriculas, contaId, motivo, actorId } = input;
  
  // Filtrar matrículas que precisam ser canceladas
  const matriculasToCancelList = matriculas.filter((m) =>
    MATRICULA_STATUSES_TO_CANCEL.includes(m.status)
  );
  
  // Mapear ações para cada matrícula
  const matriculaActions: MatriculaArchiveAction[] = matriculasToCancelList.map((m) => ({
    matriculaId: m.id,
    currentStatus: m.status,
    targetStatus: 'CANCELADA',
    hasSubscription: Boolean(m.asaasSubscriptionId),
    requiredAction: m.asaasSubscriptionId ? 'DELETE_SUBSCRIPTION' : 'LOCAL_ONLY',
  }));
  
  return {
    alunoId: aluno.id,
    contaId,
    alunoNome: aluno.nome,
    alunoCurrentStatus: aluno.status,
    matriculaActions,
    hasActiveMatriculas: matriculaActions.length > 0,
    subscriptionsToCancel: matriculaActions.filter((a) => a.requiredAction === 'DELETE_SUBSCRIPTION').length,
    localOnlyUpdates: matriculaActions.filter((a) => a.requiredAction === 'LOCAL_ONLY').length,
    motivo: motivo ?? 'Aluno arquivado - matrículas canceladas automaticamente',
    actorId: actorId ?? 'system',
  };
}
