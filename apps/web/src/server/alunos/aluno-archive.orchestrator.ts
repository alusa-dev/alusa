import { prisma } from '@alusa/database';
import type { PaymentsProviderPort } from '@alusa/finance';
import type { AlunoArchivePlan, MatriculaArchiveAction } from '@alusa/lib';

/**
 * Resultado da execução de uma ação de matrícula
 */
export type MatriculaActionResult = {
  matriculaId: string;
  previousStatus: string;
  cancelled: boolean;
  subscriptionDeleted: boolean;
  asaasAction: 'DELETE_SUBSCRIPTION' | 'LOCAL_ONLY' | 'ERROR';
  error?: string;
};

/**
 * Erro estruturado para gatewaySync
 */
export type GatewaySyncError = {
  code: string;
  message: string;
  matriculaId?: string;
};

/**
 * Resultado completo da execução do plano de arquivamento
 */
export type AlunoArchiveExecutionResult = {
  alunoId: string;
  ok: boolean;
  errors: GatewaySyncError[];
  matriculaResults: MatriculaActionResult[];
  impact: {
    matriculas: { cancelled: number; errors: number };
    subscriptions: { deleted: number; errors: number };
  };
};

type ExecuteAlunoArchivePlanDeps = {
  paymentsProvider?: PaymentsProviderPort;
};

/**
 * Executa um plano de arquivamento de aluno.
 *
 * Este orchestrator:
 * 1. Recebe um plano puro (dados) do @alusa/lib
 * 2. Executa as ações necessárias (cancelar subscriptions, atualizar status)
 * 3. Retorna resultado detalhado para auditoria
 *
 * SEPARAÇÃO DE RESPONSABILIDADES:
 * - @alusa/lib: buildAlunoArchivePlan() → retorna PLANO (dados)
 * - apps/web: executeAlunoArchivePlan() → EXECUTA o plano (ações)
 */
export async function executeAlunoArchivePlan(
  plan: AlunoArchivePlan,
  deps: ExecuteAlunoArchivePlanDeps = {}
): Promise<AlunoArchiveExecutionResult> {
  const results: MatriculaActionResult[] = [];
  const errors: GatewaySyncError[] = [];

  // Fase 1: cancelar todas as assinaturas externas. Nenhuma matrícula é
  // alterada localmente enquanto ainda houver uma falha nessa fase.
  for (const action of plan.matriculaActions) {
    const result = await executeMatriculaGatewayAction(action, plan, deps);
    results.push(result);

    if (result.asaasAction === 'ERROR' && result.error) {
      errors.push({
        code: 'MATRICULA_CANCEL_FAILED',
        message: result.error,
        matriculaId: result.matriculaId,
      });
    }
  }

  if (errors.length === 0) {
    // Fase 2: somente após a confirmação do gateway, aplicar as alterações
    // locais. Se uma escrita local falhar, a operação permanece retentável:
    // o gateway trata o cancelamento repetido como idempotente.
    for (let index = 0; index < plan.matriculaActions.length; index += 1) {
      const action = plan.matriculaActions[index];
      const gatewayResult = results[index];
      if (!action || !gatewayResult) continue;

      const result = await commitMatriculaLocalAction(action, plan, gatewayResult);
      results[index] = result;
      if (result.asaasAction === 'ERROR' && result.error) {
        errors.push({
          code: 'MATRICULA_LOCAL_UPDATE_FAILED',
          message: result.error,
          matriculaId: result.matriculaId,
        });
      }
    }
  }

  const matriculasCancelled = results.filter((r) => r.cancelled).length;
  const matriculasErrors = results.filter((r) => r.asaasAction === 'ERROR').length;
  const subscriptionsDeleted = results.filter((r) => r.subscriptionDeleted).length;
  // Subscriptions que deveriam ter sido deletadas mas falharam
  const subscriptionsErrors = results.filter(
    (r) => r.asaasAction === 'ERROR' && !r.subscriptionDeleted
  ).length;

  return {
    alunoId: plan.alunoId,
    ok: errors.length === 0,
    errors,
    matriculaResults: results,
    impact: {
      matriculas: { cancelled: matriculasCancelled, errors: matriculasErrors },
      subscriptions: { deleted: subscriptionsDeleted, errors: subscriptionsErrors },
    },
  };
}

async function executeMatriculaGatewayAction(
  action: MatriculaArchiveAction,
  plan: AlunoArchivePlan,
  deps: ExecuteAlunoArchivePlanDeps
): Promise<MatriculaActionResult> {
  const { matriculaId, currentStatus, requiredAction } = action;
  let subscriptionDeleted = false;

  try {
    if (requiredAction === 'DELETE_SUBSCRIPTION' && !deps.paymentsProvider) {
      throw new Error('Processador de pagamentos não configurado para cancelar a assinatura.');
    }

    if (requiredAction === 'DELETE_SUBSCRIPTION' && deps.paymentsProvider) {
      // Buscar assinatura para obter subscriptionId
      const subscription = await prisma.subscription.findFirst({
        where: {
          matriculaId,
          matricula: { aluno: { contaId: plan.contaId } },
        },
        select: { id: true, asaasSubscriptionId: true, status: true },
      });

      if (subscription?.asaasSubscriptionId) {
        // Se já está deletada, considerar sucesso (idempotência)
        if (subscription.status === 'DELETED') {
          subscriptionDeleted = true;
        } else {
          try {
            // Cancelar no gateway
            await deps.paymentsProvider.cancelSubscription({
              contaId: plan.contaId,
              subscriptionId: subscription.asaasSubscriptionId,
            });
            subscriptionDeleted = true;
          } catch (cancelError) {
            // 404 = já deletada, considerar sucesso
            const statusCode = (cancelError as { response?: { status?: number } }).response?.status;
            if (statusCode === 404) {
              subscriptionDeleted = true;
            } else {
              throw cancelError;
            }
          }

        }
      }
    }

    return {
      matriculaId,
      previousStatus: currentStatus,
      cancelled: false,
      subscriptionDeleted,
      asaasAction: requiredAction === 'DELETE_SUBSCRIPTION' ? 'DELETE_SUBSCRIPTION' : 'LOCAL_ONLY',
    };
  } catch (error) {
    // Registrar erro na auditoria
    await prisma.auditLog.create({
      data: {
        contaId: plan.contaId,
        actorType: 'SYSTEM',
        action: 'MATRICULA_CANCEL_FAILED',
        entityType: 'MATRICULA',
        entityId: matriculaId,
        metadata: {
          alunoId: plan.alunoId,
          previousStatus: currentStatus,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        },
      },
    });

    return {
      matriculaId,
      previousStatus: currentStatus,
      cancelled: false,
      subscriptionDeleted: false,
      asaasAction: 'ERROR',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

async function commitMatriculaLocalAction(
  action: MatriculaArchiveAction,
  plan: AlunoArchivePlan,
  gatewayResult: MatriculaActionResult,
): Promise<MatriculaActionResult> {
  const { matriculaId, currentStatus, requiredAction } = action;

  try {
    if (requiredAction === 'DELETE_SUBSCRIPTION' && gatewayResult.subscriptionDeleted) {
      await prisma.subscription.updateMany({
        where: {
          matriculaId,
          matricula: { aluno: { contaId: plan.contaId } },
        },
        data: { status: 'DELETED', statusUpdatedAt: new Date() },
      });
    }

    const updateResult = await prisma.matricula.updateMany({
      where: { id: matriculaId, aluno: { contaId: plan.contaId } },
      data: { status: 'CANCELADA' },
    });

    if (updateResult.count === 0) {
      throw new Error('Matrícula não encontrada ou não pertence à conta do plano de arquivamento.');
    }

    await prisma.auditLog.create({
      data: {
        contaId: plan.contaId,
        actorType: plan.actorId === 'system' ? 'SYSTEM' : 'USER',
        actorId: plan.actorId !== 'system' ? plan.actorId : undefined,
        action: 'MATRICULA_CANCELLED_VIA_ARCHIVE',
        entityType: 'MATRICULA',
        entityId: matriculaId,
        metadata: {
          alunoId: plan.alunoId,
          previousStatus: currentStatus,
          motivo: plan.motivo,
          requiredAction,
          subscriptionDeleted: gatewayResult.subscriptionDeleted,
        },
      },
    });

    return {
      ...gatewayResult,
      cancelled: true,
    };
  } catch (error) {
    await prisma.auditLog.create({
      data: {
        contaId: plan.contaId,
        actorType: 'SYSTEM',
        action: 'MATRICULA_CANCEL_FAILED',
        entityType: 'MATRICULA',
        entityId: matriculaId,
        metadata: {
          alunoId: plan.alunoId,
          previousStatus: currentStatus,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        },
      },
    });

    return {
      matriculaId,
      previousStatus: currentStatus,
      cancelled: false,
      subscriptionDeleted: gatewayResult.subscriptionDeleted,
      asaasAction: 'ERROR',
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}

/**
 * Helper para buscar dados necessários para construir o plano
 */
export async function fetchAlunoDataForPlan(alunoId: string, contaId: string) {
  const aluno = await prisma.aluno.findFirst({
    where: { id: alunoId, contaId },
    select: {
      id: true,
      nome: true,
      status: true,
    },
  });

  if (!aluno) {
    return null;
  }

  const matriculas = await prisma.matricula.findMany({
    where: { alunoId, aluno: { contaId } },
    select: {
      id: true,
      status: true,
      asaasSubscriptionId: true,
    },
  });

  return { aluno, matriculas };
}
