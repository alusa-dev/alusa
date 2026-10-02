/**
 * Webhook Health Check Service
 *
 * Detecta webhooks com `interrupted=true` no Asaas e, somente quando
 * explicitamente solicitado, remove a penalização (removeBackoff).
 *
 * Regras:
 * - Consulta GET /webhooks para cada subconta ativa
 * - Se `interrupted=true` e autoRecover=true, chama POST /webhooks/{id}/removeBackoff
 * - Confirma via GET /webhooks/{id} que `interrupted=false`
 * - Registra auditoria com correlação
 * - Fail-safe: erros não bloqueiam a verificação de outras contas
 */

import { listWebhooks, removeWebhookBackoff } from '@alusa/asaas';
import type { AsaasWebhookConfig } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import { createNotification } from '@alusa/lib/services/notifications.service';
import { NotificationType, NotificationCategory, NotificationSeverity, Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';

import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { auditLogService } from '../foundation/audit-log.service';
import { alertService } from '../foundation/alert-channel';
import {
  createStructuredLog,
  normalizeMetricDimensions,
  sharedTelemetry,
} from '@alusa/observability';

function logWebhookHealthEvent(params: {
  severity: 'warn' | 'error';
  eventName: string;
  operation: string;
  error?: unknown;
}): void {
  const errorType = params.error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(params.error.name)
    ? params.error.name
    : params.error === undefined
      ? undefined
      : 'unknown_error';
  const log = createStructuredLog({
    severity: params.severity,
    'service.name': 'alusa-finance',
    'event.name': params.eventName,
    'error.type': errorType,
    attributes: { operation: params.operation },
    allowedAttributes: ['operation'],
  });
  const serialized = JSON.stringify(log);
  if (params.severity === 'error') console.error(serialized);
  else console.warn(serialized);
  void sharedTelemetry.publishLog(log);
}

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
  // O Asaas recomenda corrigir a causa antes de reativar uma fila penalizada.
  // Recovery automático só pode ocorrer por opt-in explícito de uma rotina
  // administrativa/operacional.
  const autoRecover = opts?.autoRecover ?? false;

  const result: WebhookHealthCheckResult = {
    checkedAccounts: 0,
    interruptedFound: 0,
    recoveredSuccessfully: 0,
    recoveryFailed: 0,
    errors: [],
    executedAt: new Date(),
  };
  const startedAt = Date.now();

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
      apiKeyStatus: true,
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

      // Notificação interna para admins
      const interruptedFingerprint = createHash('sha256')
        .update(interrupted.map((webhook) => webhook.id).sort().join('|'))
        .digest('hex')
        .slice(0, 16);
      let shouldDispatchAlert = true;
      let notificationIdForAlert: string | null = null;
      await createNotification({
        contaId,
        type: NotificationType.WEBHOOK_INTERRUPTED,
        category: NotificationCategory.SYSTEM,
        severity: NotificationSeverity.CRITICAL,
        title: 'Fila de webhook interrompida',
        message: `${interrupted.length} webhook(s) interrompido(s) no Asaas. Eventos financeiros podem não estar chegando. ${autoRecover ? 'Recuperação automática em andamento.' : 'Intervenção manual necessária.'}`,
        dedupeKey: `webhook_interrupted:${contaId}:${interruptedFingerprint}`,
        sourceType: 'SYSTEM',
        sourceId: null,
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
        metadata: {
          webhookIds: interrupted.map((w) => w.id),
          asaasAccountId: account.asaasAccountId,
        },
      }).then((notification) => {
        notificationIdForAlert = notification.notificationId;
        // The durable notification's dedupe key is also the alert transition
        // boundary: repeated health checks for the same interrupted set must
        // not page external channels on every scheduler run. If no internal
        // notification could be persisted (for example, no recipients), keep
        // the external alert as the fallback.
        shouldDispatchAlert = notification.created || notification.notificationId === null;
        if (notification.notificationId) {
          return prisma.notification.findFirst({
            where: { id: notification.notificationId, contaId },
            select: { metadata: true },
          }).then((stored) => {
            shouldDispatchAlert = true;
            const metadata = stored?.metadata;
            if (metadata === null || metadata === undefined || typeof metadata !== 'object' || Array.isArray(metadata)) {
              return;
            }
            const delivery = metadata.externalAlertDelivery;
            if (delivery === null || typeof delivery !== 'object' || Array.isArray(delivery)) return;
            const channels = delivery.channels;
            if (Array.isArray(channels) && channels.length > 0 && channels.every((channel) =>
              channel !== null && typeof channel === 'object' && !Array.isArray(channel) && channel.success === true,
            )) {
              shouldDispatchAlert = false;
            }
          }).catch((error: unknown) => {
            // If we cannot read delivery state, retry the alert. A duplicate
            // is safer than silently losing an operational notification.
            shouldDispatchAlert = true;
            throw error;
          });
        }
      }).catch((err: unknown) => {
        logWebhookHealthEvent({
          severity: 'warn',
          eventName: 'finance.webhook_health.notification.failed',
          operation: 'notify_account_admins',
          error: err,
        });
      });

      if (shouldDispatchAlert) {
        const dispatch = await alertService
          .alertInterruptedQueue(contaId, interrupted.map((w) => w.id))
          .catch((err: unknown) => {
            logWebhookHealthEvent({
              severity: 'warn',
              eventName: 'finance.webhook_health.alert.failed',
              operation: 'notify_interrupted_queue',
              error: err,
            });
            return null;
          });

        if (dispatch && notificationIdForAlert) {
          // Save only low-cardinality delivery status; channel error strings
          // can contain provider details and are not needed for retry.
          await prisma.$executeRaw(Prisma.sql`
            UPDATE "Notification"
            SET "metadata" = jsonb_set(
              CASE
                WHEN jsonb_typeof("metadata") = 'object' THEN "metadata"
                ELSE '{}'::jsonb
              END,
              '{externalAlertDelivery}',
              ${JSON.stringify({
                attemptedAt: new Date().toISOString(),
                channels: dispatch.channelResults.map(({ channel, success }) => ({ channel, success })),
              })}::jsonb,
              true
            ),
            "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${notificationIdForAlert}
              AND "contaId" = ${contaId}
          `).catch((err: unknown) => {
            logWebhookHealthEvent({
              severity: 'warn',
              eventName: 'finance.webhook_health.alert_state_update.failed',
              operation: 'persist_alert_channel_results',
              error: err,
            });
          });
        }
      }

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
      if (failure.category === 'invalid_subaccount_credentials') {
        let transitionedToInvalid = false;
        const updateAccount = (prisma.asaasAccount as typeof prisma.asaasAccount & {
          updateMany?: typeof prisma.asaasAccount.updateMany;
        }).updateMany;
        if (typeof updateAccount === 'function') {
          try {
            const updateResult = await updateAccount({
              where: { id: account.id, apiKeyStatus: { not: 'INVALID' } },
              data: {
                apiKeyStatus: 'INVALID' as never,
                operationalStatus: 'API_KEY_REQUIRED' as never,
                lastApiKeyCheckAt: new Date(),
                lastHealthCheckAt: new Date(),
              },
            });
            transitionedToInvalid = updateResult.count > 0;
          } catch (updateError) {
            logWebhookHealthEvent({
              severity: 'warn',
              eventName: 'finance.webhook_health.credential_status_update.failed',
              operation: 'mark_invalid_credentials',
              error: updateError,
            });
          }
        }

        if (transitionedToInvalid) {
          await alertService.dispatch({
            severity: 'critical',
            title: 'Credencial Asaas inválida',
            message: 'A credencial da subconta Asaas foi rejeitada. As rotinas externas foram interrompidas até a reconexão.',
            contaId,
            metadata: { status: failure.status, category: failure.category },
          }).catch(() => undefined);
        }
      }
      result.errors.push({
        contaId,
        error: failure.message,
        category: failure.category,
        status: failure.status,
      });
    }
  }

  const dimensions = normalizeMetricDimensions({ provider: 'asaas', 'operation.name': 'health_check' });
  const counters: Array<[string, number]> = [
    ['finance.webhook_health.accounts_checked', result.checkedAccounts],
    ['finance.webhook_health.interrupted', result.interruptedFound],
    ['finance.webhook_health.recovered', result.recoveredSuccessfully],
    ['finance.webhook_health.recovery_failed', result.recoveryFailed],
    ['finance.webhook_health.errors', result.errors.length],
  ];
  for (const [name, value] of counters) {
    void sharedTelemetry.recordMetric({ kind: 'counter', name, value, dimensions });
  }
  void sharedTelemetry.recordMetric({
    kind: 'distribution',
    name: 'finance.webhook_health.duration',
    value: Math.max(0, Date.now() - startedAt),
    unit: 'millisecond',
    dimensions,
  });

  const summary = createStructuredLog({
    severity: 'info',
    'service.name': 'alusa-finance',
    'event.name': 'finance.webhook_health.completed',
    duration_ms: Math.max(0, Date.now() - startedAt),
    attributes: {
      accountsChecked: result.checkedAccounts,
      interrupted: result.interruptedFound,
      recovered: result.recoveredSuccessfully,
      recoveryFailed: result.recoveryFailed,
      errors: result.errors.length,
    },
    allowedAttributes: ['accountsChecked', 'interrupted', 'recovered', 'recoveryFailed', 'errors'],
  });
  console.info(JSON.stringify(summary));

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
