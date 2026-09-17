/**
 * Job: apply-matricula-timeout.ts
 * 
 * PR3: Aplica timeout em matrículas pendentes que excedem o prazo configurado.
 * 
 * Fluxo:
 * 1. Busca matrículas em status AGUARDANDO_CONFIRMACAO/PENDENTE_TAXA com createdAt > X dias
 * 2. Atualiza status para CANCELADA e marca timeoutAppliedAt
 * 3. Cancela subscription pendente no gateway (se existir)
 * 4. Registra auditoria
 * 
 * Idempotência: matrículas com timeoutAppliedAt != null são ignoradas
 */

import { prisma } from '@alusa/database';
import type { StatusMatricula } from '@prisma/client';

import { AUDIT_ACTIONS } from '../foundation/audit-actions';
import { auditLogService } from '../foundation/audit-log.service';
import type { PaymentsProviderPort } from '../ports/PaymentsProviderPort';

/**
 * Prazo padrão para timeout (em dias)
 */
const DEFAULT_TIMEOUT_DAYS = 30;

/**
 * Número máximo de matrículas a processar por execução
 */
const MAX_MATRICULAS_PER_RUN = 100;

/**
 * Status elegíveis para timeout
 */
const TIMEOUT_ELIGIBLE_STATUSES: StatusMatricula[] = [
  'AGUARDANDO_CONFIRMACAO',
  'PENDENTE_TAXA',
];

export interface ApplyMatriculaTimeoutInput {
  contaId?: string;
  timeoutDays?: number;
  dryRun?: boolean;
  actor?: { type: 'SYSTEM' | 'USER'; id: string };
}

export interface ApplyMatriculaTimeoutDeps {
  paymentsProvider?: PaymentsProviderPort;
}

export interface ApplyMatriculaTimeoutResult {
  processadas: number;
  canceladas: number;
  skipped: number;
  erros: Array<{ matriculaId: string; erro: string }>;
  dataExecucao: Date;
}

export async function applyMatriculaTimeoutJob(
  input: ApplyMatriculaTimeoutInput = {},
  deps: ApplyMatriculaTimeoutDeps = {},
): Promise<ApplyMatriculaTimeoutResult> {
  const {
    contaId,
    timeoutDays = DEFAULT_TIMEOUT_DAYS,
    dryRun = false,
    actor = { type: 'SYSTEM', id: 'timeout-job' },
  } = input;

  const result: ApplyMatriculaTimeoutResult = {
    processadas: 0,
    canceladas: 0,
    skipped: 0,
    erros: [],
    dataExecucao: new Date(),
  };

  const now = new Date();
  const threshold = new Date(now.getTime() - timeoutDays * 24 * 60 * 60 * 1000);

  // Buscar matrículas elegíveis para timeout
  const matriculas = await prisma.matricula.findMany({
    where: {
      status: { in: TIMEOUT_ELIGIBLE_STATUSES },
      timeoutAppliedAt: null, // Idempotência: não reaplicar timeout
      createdAt: { lt: threshold },
      ...(contaId ? { contaId } : {}),
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      asaasSubscriptionId: true,
      aluno: {
        select: {
          id: true,
          nome: true,
          contaId: true,
        },
      },
    },
    take: MAX_MATRICULAS_PER_RUN,
    orderBy: { createdAt: 'asc' },
  });

  for (const matricula of matriculas) {
    result.processadas++;

    try {
      if (dryRun) {
        console.log('[timeout-job] DRY RUN - Would cancel:', {
          matriculaId: matricula.id,
          alunoNome: matricula.aluno.nome,
          createdAt: matricula.createdAt,
          daysPending: Math.floor((now.getTime() - matricula.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
        });
        result.canceladas++;
        continue;
      }

      // A confirmação externa deve acontecer antes da escrita local. Caso a
      // escrita local falhe, uma nova execução pode repetir o cancelamento de
      // forma idempotente sem deixar o ERP em estado financeiro falso.
      if (matricula.asaasSubscriptionId) {
        if (!deps.paymentsProvider) {
          throw new Error('MATRICULA_TIMEOUT_PROVIDER_UNAVAILABLE');
        }

        await deps.paymentsProvider.cancelSubscription({
          contaId: matricula.aluno.contaId,
          subscriptionId: matricula.asaasSubscriptionId,
        });
      }

      // Atualizar matrícula somente após o provedor confirmar o cancelamento.
      await prisma.matricula.update({
        where: { id: matricula.id },
        data: {
          status: 'CANCELADA',
          timeoutAppliedAt: now,
        },
      });

      // Registrar auditoria
      await auditLogService.record({
        contaId: matricula.aluno.contaId,
        action: AUDIT_ACTIONS.MATRICULA.TIMEOUT_APPLIED,
        entity: { type: 'MATRICULA', id: matricula.id },
        actor: { type: actor.type, id: actor.id },
        metadata: {
          previousStatus: matricula.status,
          timeoutDays,
          createdAt: matricula.createdAt.toISOString(),
          alunoId: matricula.aluno.id,
          asaasSubscriptionId: matricula.asaasSubscriptionId,
        },
      });

      result.canceladas++;
    } catch (error) {
      result.erros.push({
        matriculaId: matricula.id,
        erro: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Log de métricas
  console.log('[timeout-job] Resultado:', {
    processadas: result.processadas,
    canceladas: result.canceladas,
    erros: result.erros.length,
    dryRun,
  });

  return result;
}
