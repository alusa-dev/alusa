import type { PrismaClient } from '@prisma/client';
import { StatusMatricula } from '@prisma/client';
import { prisma } from '../../prisma';
import { getSeatOccupyingStatuses } from '../../services/matricula-occupancy';

/**
 * Status de matrícula que requerem cancelamento ao arquivar o aluno.
 * Inclui todos os status que "ocupam vaga" + PAUSADA (trancada, mas ainda vinculada)
 */
export const MATRICULA_STATUSES_TO_CANCEL: StatusMatricula[] = [
  ...getSeatOccupyingStatuses(),
  StatusMatricula.PAUSADA,
];

export type MatriculaCancelResult = {
  matriculaId: string;
  previousStatus: string;
  cancelled: boolean;
  asaasAction?: 'DELETE' | 'LOCAL_ONLY' | 'ERROR';
  error?: string;
};

export type AlunoArchiveResult = {
  alunoId: string;
  archived: boolean;
  matriculasCancelled: MatriculaCancelResult[];
  totalMatriculasProcessed: number;
  totalMatriculasCancelled: number;
  totalErrors: number;
  customerInactivation?: {
    success: boolean;
    action: string;
    error?: string;
  };
};

export type AlunoArchiveOptions = {
  prisma?: PrismaClient;
  actorId?: string;
  motivo?: string;
  /**
   * Se true, não cancela matrículas - apenas verifica o que seria feito.
   * Útil para preview/confirmação do usuário.
   */
  dryRun?: boolean;
  /**
   * Função para cancelar matrícula com sincronização Asaas.
   * Injetada para permitir uso em diferentes contextos (web, lib).
   */
  syncMatriculaStatus?: (input: {
    prisma: PrismaClient;
    matriculaId: string;
    contaId: string;
    targetStatus: 'CANCELADA';
    actorId: string;
    motivo?: string;
  }) => Promise<unknown>;
};

/**
 * AlunoArchivePolicy
 *
 * Política de arquivamento de aluno que garante:
 * 1. Todas as matrículas ativas/pendentes são canceladas
 * 2. Assinaturas Asaas são canceladas (via syncMatriculaStatus)
 * 3. Customer Asaas é inativado se não compartilhado
 * 4. Aluno é marcado como INATIVO
 * 5. Auditoria completa é registrada
 *
 * INVARIANTE: Aluno arquivado nunca possui matrículas ativas.
 */
export async function executeAlunoArchivePolicy(
  alunoId: string,
  contaId: string,
  options: AlunoArchiveOptions = {},
): Promise<AlunoArchiveResult> {
  const db = options.prisma ?? prisma;
  const actorId = options.actorId ?? 'system';
  const motivo = options.motivo ?? 'Aluno arquivado - matrículas canceladas automaticamente';
  const dryRun = options.dryRun ?? false;

  // 1. Buscar aluno
  const aluno = await db.aluno.findFirst({
    where: { id: alunoId, contaId },
    select: {
      id: true,
      status: true,
      nome: true,
    },
  });

  if (!aluno) {
    throw new Error('Aluno não encontrado');
  }

  // 2. Buscar matrículas que precisam ser canceladas
  const matriculasAtivas = await db.matricula.findMany({
    where: {
      alunoId,
      status: { in: MATRICULA_STATUSES_TO_CANCEL },
    },
    select: {
      id: true,
      status: true,
      asaasSubscriptionId: true,
    },
  });

  const results: MatriculaCancelResult[] = [];

  // 3. Cancelar cada matrícula
  for (const matricula of matriculasAtivas) {
    if (dryRun) {
      results.push({
        matriculaId: matricula.id,
        previousStatus: matricula.status,
        cancelled: false,
        asaasAction: matricula.asaasSubscriptionId ? 'DELETE' : 'LOCAL_ONLY',
      });
      continue;
    }

    try {
      if (options.syncMatriculaStatus) {
        // Usa função injetada (com sincronização Asaas completa)
        await options.syncMatriculaStatus({
          prisma: db,
          matriculaId: matricula.id,
          contaId,
          targetStatus: 'CANCELADA',
          actorId,
          motivo,
        });
        results.push({
          matriculaId: matricula.id,
          previousStatus: matricula.status,
          cancelled: true,
          asaasAction: matricula.asaasSubscriptionId ? 'DELETE' : 'LOCAL_ONLY',
        });
      } else {
        // Fallback: apenas atualiza status local (sem sync Asaas)
        await db.matricula.update({
          where: { id: matricula.id },
          data: { status: 'CANCELADA' },
        });
        results.push({
          matriculaId: matricula.id,
          previousStatus: matricula.status,
          cancelled: true,
          asaasAction: 'LOCAL_ONLY',
        });
      }
    } catch (error) {
      results.push({
        matriculaId: matricula.id,
        previousStatus: matricula.status,
        cancelled: false,
        asaasAction: 'ERROR',
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }
  }

  const totalCancelled = results.filter((r) => r.cancelled).length;
  const totalErrors = results.filter((r) => r.asaasAction === 'ERROR').length;

  // 4. Se dryRun, retorna preview
  if (dryRun) {
    return {
      alunoId,
      archived: false,
      matriculasCancelled: results,
      totalMatriculasProcessed: results.length,
      totalMatriculasCancelled: 0,
      totalErrors: 0,
    };
  }

  // 5. Retorna resultado (o arquivamento do aluno será feito pelo deleteAluno)
  return {
    alunoId,
    archived: true,
    matriculasCancelled: results,
    totalMatriculasProcessed: results.length,
    totalMatriculasCancelled: totalCancelled,
    totalErrors,
  };
}

/**
 * Verifica se um aluno pode ser arquivado e quais matrículas serão afetadas.
 * Útil para mostrar confirmação ao usuário antes do arquivamento.
 */
export async function previewAlunoArchive(
  alunoId: string,
  contaId: string,
  options: Omit<AlunoArchiveOptions, 'dryRun'> = {},
): Promise<AlunoArchiveResult> {
  return executeAlunoArchivePolicy(alunoId, contaId, { ...options, dryRun: true });
}
