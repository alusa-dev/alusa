/**
 * Webhook Health Check Service
 *
 * Detecta webhooks com `interrupted=true` no Asaas e tenta
 * remover a penalização automaticamente (removeBackoff).
 *
 * Regras:
 * - Consulta GET /webhooks para cada subconta ativa
 * - Se `interrupted=true`, chama POST /webhooks/{id}/removeBackoff
 * - Confirma via GET /webhooks/{id} que `interrupted=false`
 * - Registra auditoria com correlação
 * - Fail-safe: erros não bloqueiam a verificação de outras contas
 */

import { listWebhooks, removeWebhookBackoff } from '@alusa/asaas';
import type { AsaasWebhookConfig } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { createNotification } from '@alusa/lib';
import { NotificationType, NotificationCategory, NotificationSeverity, Role } from '@prisma/client';

import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { auditLogService } from '../foundation/audit-log.service';
import { alertService } from '../foundation/alert-channel';
import { redactWebhookLogObject } from './webhook-redaction';

// ── Types ────────────────────────────────────────────────────────────────

export interface WebhookHealthCheckResult {
  checkedAccounts: number;
  interruptedFound: number;
  recoveredSuccessfully: number;
  recoveryFailed: number;
  errors: Array<{ contaId: string; webhookId?: string; error: string; category?: string; status?: number | null }>;
  executedAt: Date;
}

export interface WebhookHealthStatus {
  contaId: string;
  asaasAccountId: string | null;
  webhooks: Array<{
    id: string;
    url: string;
    enabled: boolean;
    interrupted: boolean;
  }>;
  hasInterrupted: boolean;
}

// ── Health Check ─────────────────────────────────────────────────────────

/**
 * Verifica o estado dos webhooks de todas as subcontas ativas.
 * Se encontrar `interrupted=true`, tenta remover a penalização.
 */
export async function checkWebhookHealth(opts?: {
  contaId?: string;
  autoRecover?: boolean;
}): Promise<WebhookHealthCheckResult> {
  const autoRecover = opts?.autoRecover ?? true;

  const result: WebhookHealthCheckResult = {
    checkedAccounts: 0,
    interruptedFound: 0,
    recoveredSuccessfully: 0,
    recoveryFailed: 0,
    errors: [],
    executedAt: new Date(),
  };

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      ...(opts?.contaId
        ? { financeProfile: { contaId: opts.contaId } }
        : { status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] } }),
    },
    select: {
      id: true,
      asaasAccountId: true,
      financeProfile: { select: { contaId: true } },
    },
  });

  result.checkedAccounts = accounts.length;

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;

    try {
      const creds = await loadAsaasCredentials(contaId);
      if (!creds) continue;

      const webhookList = await listWebhooks({ apiKey: creds.apiKey });
      const interrupted = webhookList.data.filter((w) => w.interrupted === true);

      if (interrupted.length === 0) continue;

      result.interruptedFound += interrupted.length;

      console.warn('[webhook-health] Webhook interrompido detectado', redactWebhookLogObject({
        contaId,
        asaasAccountId: account.asaasAccountId,
        webhookIds: interrupted.map((w) => w.id),
      }));

      await alertService
        .alertInterruptedQueue(contaId, interrupted.map((w) => w.id))
        .catch((err: unknown) => {
          console.warn('[webhook-health][alert-failed]', redactWebhookLogObject({ contaId, err }));
        });

      // Notificação interna para admins
      await createNotification({
        contaId,
        type: NotificationType.WEBHOOK_INTERRUPTED,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.CRITICAL,
        title: 'Fila de webhook interrompida',
        message: `${interrupted.length} webhook(s) interrompido(s) no Asaas. Eventos financeiros podem não estar chegando. ${autoRecover ? 'Recuperação automática em andamento.' : 'Intervenção manual necessária.'}`,
        dedupeKey: `webhook_interrupted:${contaId}:${new Date().toISOString().split('T')[0]}`,
        sourceType: 'SYSTEM',
        sourceId: null,
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
        metadata: {
          webhookIds: interrupted.map((w) => w.id),
          asaasAccountId: account.asaasAccountId,
        },
      }).catch((err: unknown) => {
        console.warn('[webhook-health][notify-failed]', redactWebhookLogObject({ contaId, err }));
      });

      if (!autoRecover) continue;

      for (const webhook of interrupted) {
        try {
          await removeWebhookBackoff({
            apiKey: creds.apiKey,
            webhookId: webhook.id,
          });

          // Confirma via GET que interrupted=false
          const refreshed = await listWebhooks({ apiKey: creds.apiKey });
          const stillInterrupted = refreshed.data.find(
            (w) => w.id === webhook.id && w.interrupted === true,
          );

          if (stillInterrupted) {
            result.recoveryFailed++;
            result.errors.push({
              contaId,
              webhookId: webhook.id,
              error: 'removeBackoff chamado mas webhook continua interrupted=true',
            });
          } else {
            result.recoveredSuccessfully++;

            console.info('[webhook-health] Webhook recuperado', redactWebhookLogObject({
              contaId,
              webhookId: webhook.id,
            }));
          }

          await auditLogService.record({
            contaId,
            action: 'finance.webhook.backoff_removed',
            entity: { type: 'AsaasAccount', id: account.id },
            metadata: {
              webhookId: webhook.id,
              url: webhook.url,
              recovered: !stillInterrupted,
            },
            actor: { type: 'SYSTEM' },
          });
        } catch (err) {
          const failure = classifyAsaasOperationalError(err, 'subaccount');
          result.recoveryFailed++;
          result.errors.push({
            contaId,
            webhookId: webhook.id,
            error: failure.message,
            category: failure.category,
            status: failure.status,
          });
        }
      }
    } catch (err) {
      const failure = classifyAsaasOperationalError(err, 'subaccount');
      result.errors.push({
        contaId,
        error: failure.message,
        category: failure.category,
        status: failure.status,
      });
    }
  }

  console.info('[webhook-health] Health check concluído', redactWebhookLogObject({
    checkedAccounts: result.checkedAccounts,
    interruptedFound: result.interruptedFound,
    recoveredSuccessfully: result.recoveredSuccessfully,
    recoveryFailed: result.recoveryFailed,
    errors: result.errors.length,
  }));

  return result;
}

/**
 * Retorna o status detalhado dos webhooks de uma subconta.
 */
export async function getWebhookHealthStatus(contaId: string): Promise<WebhookHealthStatus | null> {
  const account = await prisma.asaasAccount.findFirst({
    where: { financeProfile: { contaId } },
    select: {
      asaasAccountId: true,
      financeProfile: { select: { contaId: true } },
    },
  });

  if (!account?.asaasAccountId) return null;

  const creds = await loadAsaasCredentials(contaId);
  if (!creds) return null;

  const webhookList = await listWebhooks({ apiKey: creds.apiKey });

  return {
    contaId,
    asaasAccountId: account.asaasAccountId,
    webhooks: webhookList.data.map((w: AsaasWebhookConfig) => ({
      id: w.id,
      url: w.url,
      enabled: w.enabled ?? false,
      interrupted: w.interrupted ?? false,
    })),
    hasInterrupted: webhookList.data.some((w) => w.interrupted === true),
  };
}
