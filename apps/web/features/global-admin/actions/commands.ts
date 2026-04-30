import { auditLogService, checkWebhookHealth, processAsaasWebhookQueue, reconcileAsaasAccount, reconcileWithAsaas, repairWebhookConfigDrift, replayWebhookByEventId, syncPaymentStateFromAsaas } from '@alusa/finance';

import {
  emitBillingNotificationCandidate,
  emitBillingNotifications,
} from '@/lib/notifications/emit-billing-notifications';

import {
  globalAdminProcessQueueRequestDTOSchema,
  globalAdminReconcilePaymentRequestDTOSchema,
  globalAdminReconcileTenantRequestDTOSchema,
  globalAdminRemoveBackoffRequestDTOSchema,
  globalAdminRepairWebhookRequestDTOSchema,
  globalAdminReplayEventRequestDTOSchema,
} from './dtos';
import { mapGlobalAdminActionResultToDTO } from './mappers';

type GlobalAdminActor = {
  username: string;
};

function getActorId(actor: GlobalAdminActor) {
  return `global-admin:${actor.username}`;
}

async function recordGlobalAdminAudit(params: {
  tenantId: string;
  action: string;
  actor: GlobalAdminActor;
  targetType: string;
  targetId?: string;
  reason: string;
  request: Record<string, unknown>;
  status: 'SUCCESS' | 'ERROR';
  summary: string;
  error?: string;
}) {
  return auditLogService.record({
    contaId: params.tenantId,
    action: params.action,
    entity: { type: params.targetType, id: params.targetId },
    actor: { type: 'ADMIN', id: getActorId(params.actor) },
    metadata: {
      globalAdmin: true,
      actorIdentifier: params.actor.username,
      reason: params.reason,
      request: params.request,
      status: params.status,
      resultSummary: params.summary,
      error: params.error ?? null,
    },
  });
}

async function executeWithAudit<T>(params: {
  tenantId: string;
  reason: string;
  actor: GlobalAdminActor;
  action: string;
  targetType: string;
  targetId?: string;
  request: Record<string, unknown>;
  execute: () => Promise<{ summary: string; data: T }>;
}) {
  try {
    const result = await params.execute();
    const audit = await recordGlobalAdminAudit({
      tenantId: params.tenantId,
      action: params.action,
      actor: params.actor,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason,
      request: params.request,
      status: 'SUCCESS',
      summary: result.summary,
    });

    return mapGlobalAdminActionResultToDTO({
      success: true,
      action: params.action,
      tenantId: params.tenantId,
      summary: result.summary,
      auditId: audit.id,
      data: result.data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const audit = await recordGlobalAdminAudit({
      tenantId: params.tenantId,
      action: params.action,
      actor: params.actor,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason,
      request: params.request,
      status: 'ERROR',
      summary: message,
      error: message,
    });

    return mapGlobalAdminActionResultToDTO({
      success: false,
      action: params.action,
      tenantId: params.tenantId,
      summary: message,
      auditId: audit.id,
      data: null,
    });
  }
}

export async function executeGlobalAdminAction(
  action:
    | 'repair-webhook'
    | 'remove-backoff'
    | 'process-queue'
    | 'replay-event'
    | 'reconcile-payment'
    | 'reconcile-tenant',
  input: unknown,
  actor: GlobalAdminActor,
) {
  switch (action) {
    case 'repair-webhook': {
      const parsed = globalAdminRepairWebhookRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.webhook.repair',
        targetType: 'Conta',
        targetId: parsed.tenantId,
        request: parsed,
        execute: async () => {
          const result = await repairWebhookConfigDrift({
            contaId: parsed.tenantId,
            actor: { type: 'ADMIN', id: getActorId(actor) },
          });
          return {
            summary: result.repaired ? 'Webhook reparado com sucesso.' : 'Nenhum drift relevante encontrado.',
            data: result,
          };
        },
      });
    }
    case 'remove-backoff': {
      const parsed = globalAdminRemoveBackoffRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.webhook.remove_backoff',
        targetType: 'Conta',
        targetId: parsed.tenantId,
        request: parsed,
        execute: async () => {
          const result = await checkWebhookHealth({ contaId: parsed.tenantId, autoRecover: true });
          return {
            summary:
              result.recoveredSuccessfully > 0
                ? `${result.recoveredSuccessfully} webhook(s) recuperado(s).`
                : 'Nenhum webhook interrompido precisou de recuperação.',
            data: result,
          };
        },
      });
    }
    case 'process-queue': {
      const parsed = globalAdminProcessQueueRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.queue.process',
        targetType: 'Conta',
        targetId: parsed.tenantId,
        request: parsed,
        execute: async () => {
          const result = await processAsaasWebhookQueue({
            contaId: parsed.tenantId,
            limit: parsed.limit ?? 100,
            statuses: ['PENDENTE', 'ERRO'],
            source: 'REPROCESS',
          });

          try {
            await emitBillingNotifications(result.processedPayments, 'ASAAS_WEBHOOK');
          } catch (error) {
            console.warn('[global-admin][process-queue][notify-failed]', error);
          }

          return {
            summary: `${result.processed} webhook(s) processado(s) na fila.`,
            data: result,
          };
        },
      });
    }
    case 'replay-event': {
      const parsed = globalAdminReplayEventRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.webhook.replay',
        targetType: 'WebhookAsaas',
        targetId: parsed.eventId,
        request: parsed,
        execute: async () => {
          const result = await replayWebhookByEventId({
            contaId: parsed.tenantId,
            eventId: parsed.eventId,
            force: parsed.force,
          });
          return {
            summary: `Evento ${parsed.eventId} reenfileirado/reprocessado.`,
            data: result,
          };
        },
      });
    }
    case 'reconcile-payment': {
      const parsed = globalAdminReconcilePaymentRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.payment.reconcile',
        targetType: 'AsaasPayment',
        targetId: parsed.asaasPaymentId,
        request: parsed,
        execute: async () => {
          const result = await syncPaymentStateFromAsaas({
            contaId: parsed.tenantId,
            asaasPaymentId: parsed.asaasPaymentId,
            eventName: parsed.eventName,
          });

          if (!result.success) {
            throw new Error(result.error);
          }

          try {
            await emitBillingNotificationCandidate(
              { event: result.appliedEvent, asaasPaymentId: parsed.asaasPaymentId },
              'ASAAS_SYNC',
            );
          } catch (error) {
            console.warn('[global-admin][reconcile-payment][notify-failed]', error);
          }

          return {
            summary: `Pagamento ${parsed.asaasPaymentId} reconciliado via Asaas.`,
            data: result,
          };
        },
      });
    }
    case 'reconcile-tenant': {
      const parsed = globalAdminReconcileTenantRequestDTOSchema.parse(input);
      return executeWithAudit({
        tenantId: parsed.tenantId,
        reason: parsed.reason,
        actor,
        action: 'global_admin.tenant.reconcile',
        targetType: 'Conta',
        targetId: parsed.tenantId,
        request: parsed,
        execute: async () => {
          const [account, finance] = await Promise.all([
            reconcileAsaasAccount({
              contaId: parsed.tenantId,
              actor: { type: 'ADMIN', id: getActorId(actor) },
              reason: parsed.reason,
            }),
            reconcileWithAsaas({
              contaId: parsed.tenantId,
              windowHours: parsed.windowHours ?? 72,
              limit: parsed.limit ?? 200,
              dryRun: false,
            }),
          ]);

          return {
            summary: 'Conta sincronizada com sucesso.',
            data: { account, finance },
          };
        },
      });
    }
    default:
      throw new Error('Ação não suportada');
  }
}
