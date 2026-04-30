import { prisma } from '@alusa/database';
import type { StatusMatricula, SubscriptionStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { parseExternalReference } from '../core';
import { isTerminalStatus, canTransition } from '@alusa/domain';

/**
 * Verifica se uma atualização de status de matrícula deve ser aplicada,
 * usando a máquina de estados canônica do domínio.
 */
function shouldApplyMatriculaUpdate(
  currentStatus: StatusMatricula,
  targetStatus: StatusMatricula
): { allowed: boolean; reason?: string; anomaly?: boolean } {
  // Usar máquina de estados canônica
  if (isTerminalStatus(currentStatus)) {
    return {
      allowed: false,
      reason: `Status terminal ${currentStatus} não pode ser sobrescrito por webhook`,
      anomaly: true,
    };
  }
  if (currentStatus === targetStatus) {
    return { allowed: false, reason: 'Status já é o target' };
  }
  if (!canTransition(currentStatus, targetStatus)) {
    return {
      allowed: false,
      reason: `Transição ${currentStatus} → ${targetStatus} não é válida`,
      anomaly: true,
    };
  }
  return { allowed: true };
}

export type SubscriptionWebhookPayload = {
  event: string;
  subscription: {
    id: string;
    status?: string;
    externalReference?: string;
    deleted?: boolean;
  };
};

async function markMatriculaDivergence(params: {
  matriculaId: string;
  warningCode: string;
}) {
  await prisma.matricula.update({
    where: { id: params.matriculaId },
    data: {
      integrationStatus: 'DIVERGENTE',
      warningCode: params.warningCode,
    },
  });

  await prisma.matriculaOperacao.updateMany({
    where: {
      matriculaId: params.matriculaId,
      status: 'PENDENTE_SINCRONISMO',
      tipo: { in: ['PAUSA', 'REATIVACAO'] },
    },
    data: {
      status: 'ERRO',
      processedAt: new Date(),
      erro: `Divergência detectada no webhook (${params.warningCode})`,
    },
  });
}

function mapAsaasSubscriptionStatus(params: {
  event: string;
  status: string | undefined;
  deleted: boolean | undefined;
}): SubscriptionStatus {
  if (params.deleted || params.event === 'SUBSCRIPTION_DELETED') return 'DELETED';
  if (params.event === 'SUBSCRIPTION_INACTIVATED') return 'INACTIVE';

  switch (params.status) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'INACTIVE':
      return 'INACTIVE';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'FAILED';
  }
}

function resolveNextStatus(payload: SubscriptionWebhookPayload): SubscriptionStatus | null {
  const event = payload.event;
  const deleted = payload.subscription.deleted;
  const status = payload.subscription.status;

  if (deleted || event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    return mapAsaasSubscriptionStatus({ event, status, deleted });
  }

  if (!status) return null;
  return mapAsaasSubscriptionStatus({ event, status, deleted });
}

export async function handleSubscriptionWebhook(
  contaId: string,
  payload: SubscriptionWebhookPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const externalReference = payload.subscription.externalReference;
    
    // Tentar V2 primeiro, depois V1
    const parsed = externalReference ? parseExternalReference(externalReference) : null;
    let subscriptionId: string | null = null;
    
    if (parsed && parsed.type === 'subscription') {
      // V2: podemos ter matriculaId no parsed.ids
      subscriptionId = null; // Subscription ID não vem direto no V2, vamos buscar por outros campos
    } else if (externalReference?.startsWith('subscription:')) {
      // V1: subscription:{subscriptionId}
      subscriptionId = externalReference.slice('subscription:'.length) || null;
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        contaId,
        OR: [
          { asaasSubscriptionId: payload.subscription.id },
          ...(externalReference ? [{ externalReference }] : []),
          ...(subscriptionId ? [{ id: subscriptionId }] : []),
        ],
      },
      select: { id: true, status: true, asaasSubscriptionId: true, externalReference: true, matriculaId: true },
    });

    if (!subscription) {
      return { success: true };
    }

    const nextStatus = resolveNextStatus(payload);

    const updates: { status?: SubscriptionStatus; statusUpdatedAt?: Date; asaasSubscriptionId?: string } = {};

    if (!subscription.asaasSubscriptionId) {
      updates.asaasSubscriptionId = payload.subscription.id;
    }

    if (nextStatus && subscription.status !== nextStatus) {
      updates.status = nextStatus;
      updates.statusUpdatedAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      await prisma.subscription.update({ where: { id: subscription.id }, data: updates });

      // Compat: manter matricula.asaasSubscriptionId como fallback de resolução
      await prisma.matricula.update({
        where: { id: subscription.matriculaId },
        data: { asaasSubscriptionId: payload.subscription.id },
      });

      // Se assinatura foi deletada/inativada, atualizar status da matrícula correspondente
      // IMPORTANTE: Isso garante que matrículas não fiquem "órfãs" com status ativo
      // quando a assinatura foi cancelada no Asaas
      if (nextStatus === 'DELETED') {
        const matricula = await prisma.matricula.findUnique({
          where: { id: subscription.matriculaId },
          select: { status: true },
        });

        const guard = matricula
          ? shouldApplyMatriculaUpdate(matricula.status, 'CANCELADA')
          : { allowed: false, reason: 'Matrícula não encontrada' };

        if (guard.allowed) {
          await prisma.matricula.update({
            where: { id: subscription.matriculaId },
            data: { status: 'CANCELADA' },
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.matricula_cancelada_via_subscription',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              reason: 'Assinatura deletada no Asaas',
            },
          });
        } else {
          // Registrar anomalia se transição deveria ter ocorrido mas foi bloqueada
          await auditLogService.record({
            contaId,
            action: guard.anomaly
              ? 'finance.webhook.anomaly_detected'
              : 'finance.webhook.matricula_update_skipped',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              targetStatus: 'CANCELADA',
              currentStatus: matricula?.status ?? 'unknown',
              reason: guard.reason,
              anomaly: guard.anomaly ?? false,
            },
          });
        }
      } else if (nextStatus === 'INACTIVE') {
        // Se assinatura inativada, confirmar pausa da matrícula
        const matricula = await prisma.matricula.findUnique({
          where: { id: subscription.matriculaId },
          select: { status: true, pausaAtiva: true, integrationStatus: true },
        });

        const guard = matricula
          ? shouldApplyMatriculaUpdate(matricula.status, 'PAUSADA')
          : { allowed: false, reason: 'Matrícula não encontrada' };

        if (guard.allowed && matricula?.status === 'ATIVA') {
          await prisma.matricula.update({
            where: { id: subscription.matriculaId },
            data: {
              status: 'PAUSADA',
              pausaAtiva: true,
              integrationStatus: 'SINCRONIZADO',
              warningCode: null,
            },
          });

          // Consolidar operação de pausa pendente
          await prisma.matriculaOperacao.updateMany({
            where: {
              matriculaId: subscription.matriculaId,
              tipo: 'PAUSA',
              status: 'PENDENTE_SINCRONISMO',
            },
            data: { status: 'SINCRONIZADO', processedAt: new Date() },
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.matricula_pausada_via_subscription',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              reason: 'Assinatura inativada no Asaas - pausa confirmada',
            },
          });
        } else if (matricula?.status === 'PAUSADA' && matricula.integrationStatus === 'PENDENTE_SINCRONISMO') {
          // Matrícula já está pausada localmente, apenas confirmar sincronização
          await prisma.matricula.update({
            where: { id: subscription.matriculaId },
            data: { integrationStatus: 'SINCRONIZADO', warningCode: null },
          });

          await prisma.matriculaOperacao.updateMany({
            where: {
              matriculaId: subscription.matriculaId,
              tipo: 'PAUSA',
              status: 'PENDENTE_SINCRONISMO',
            },
            data: { status: 'SINCRONIZADO', processedAt: new Date() },
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.pausa_confirmada',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              reason: 'Webhook confirmou pausa já aplicada localmente',
            },
          });
        } else if (!guard.allowed) {
          if (guard.anomaly || matricula?.integrationStatus === 'PENDENTE_SINCRONISMO') {
            await markMatriculaDivergence({
              matriculaId: subscription.matriculaId,
              warningCode: 'DIVERGENCIA_STATUS_ASSINATURA',
            });
          }

          await auditLogService.record({
            contaId,
            action: guard.anomaly
              ? 'finance.webhook.anomaly_detected'
              : 'finance.webhook.matricula_update_skipped',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              targetStatus: 'PAUSADA',
              currentStatus: matricula?.status ?? 'unknown',
              reason: guard.reason,
              anomaly: guard.anomaly ?? false,
            },
          });
        }
      } else if (nextStatus === 'ACTIVE') {
        // Se assinatura reativada, confirmar reativação da matrícula
        const matricula = await prisma.matricula.findUnique({
          where: { id: subscription.matriculaId },
          select: { status: true, pausaAtiva: true, integrationStatus: true },
        });

        const guard = matricula
          ? shouldApplyMatriculaUpdate(matricula.status, 'ATIVA')
          : { allowed: false, reason: 'Matrícula não encontrada' };

        if (guard.allowed && matricula?.status === 'PAUSADA') {
          await prisma.matricula.update({
            where: { id: subscription.matriculaId },
            data: {
              status: 'ATIVA',
              pausaAtiva: false,
              dataInicioPausa: null,
              dataRetornoPrevista: null,
              motivoPausa: null,
              integrationStatus: 'SINCRONIZADO',
              warningCode: null,
            },
          });

          // Consolidar operação de reativação pendente
          await prisma.matriculaOperacao.updateMany({
            where: {
              matriculaId: subscription.matriculaId,
              tipo: 'REATIVACAO',
              status: 'PENDENTE_SINCRONISMO',
            },
            data: { status: 'SINCRONIZADO', processedAt: new Date() },
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.matricula_reativada_via_subscription',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              reason: 'Assinatura reativada no Asaas - reativação confirmada',
            },
          });
        } else if (matricula?.status === 'ATIVA' && matricula.integrationStatus === 'PENDENTE_SINCRONISMO') {
          // Matrícula já está ativa localmente, apenas confirmar sincronização
          await prisma.matricula.update({
            where: { id: subscription.matriculaId },
            data: { integrationStatus: 'SINCRONIZADO', warningCode: null },
          });

          await prisma.matriculaOperacao.updateMany({
            where: {
              matriculaId: subscription.matriculaId,
              tipo: 'REATIVACAO',
              status: 'PENDENTE_SINCRONISMO',
            },
            data: { status: 'SINCRONIZADO', processedAt: new Date() },
          });

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.reativacao_confirmada',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              reason: 'Webhook confirmou reativação já aplicada localmente',
            },
          });
        } else if (!guard.allowed) {
          if (guard.anomaly || matricula?.integrationStatus === 'PENDENTE_SINCRONISMO') {
            await markMatriculaDivergence({
              matriculaId: subscription.matriculaId,
              warningCode: 'DIVERGENCIA_STATUS_ASSINATURA',
            });
          }

          await auditLogService.record({
            contaId,
            action: guard.anomaly
              ? 'finance.webhook.anomaly_detected'
              : 'finance.webhook.matricula_update_skipped',
            entity: { type: 'Matricula', id: subscription.matriculaId },
            metadata: {
              event: payload.event,
              subscriptionId: subscription.id,
              asaasSubscriptionId: payload.subscription.id,
              targetStatus: 'ATIVA',
              currentStatus: matricula?.status ?? 'unknown',
              reason: guard.reason,
              anomaly: guard.anomaly ?? false,
            },
          });
        }
      }

      await auditLogService.record({
        contaId,
        action: 'finance.webhook.subscription_status_changed',
        entity: { type: 'Subscription', id: subscription.id },
        metadata: {
          event: payload.event,
          asaasSubscriptionId: payload.subscription.id,
          externalReference: subscription.externalReference,
          asaasStatus: payload.subscription.status,
          asaasDeleted: payload.subscription.deleted ?? false,
          previousStatus: subscription.status,
          nextStatus: nextStatus ?? subscription.status,
        },
      });
    }

    // Auditoria dedicada para SUBSCRIPTION_SPLIT_DISABLED
    if (payload.event === 'SUBSCRIPTION_SPLIT_DISABLED') {
      await auditLogService.record({
        contaId,
        action: 'finance.webhook.subscription_split_disabled',
        entity: { type: 'Subscription', id: subscription.id },
        metadata: {
          asaasSubscriptionId: payload.subscription.id,
          externalReference: subscription.externalReference,
          matriculaId: subscription.matriculaId,
          currentStatus: subscription.status,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error('[finance][handleSubscriptionWebhook]', error);
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
