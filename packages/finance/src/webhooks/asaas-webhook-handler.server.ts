import { prisma } from '@alusa/database';
import { Prisma, NotificationType, NotificationCategory, NotificationSeverity, Role } from '@prisma/client';
import { createNotification } from '@alusa/lib';
import { handlePaymentWebhook } from './payment-webhook-handler';
import { handleTransferWebhook } from './transfer-webhook-handler';
import { handleSubscriptionWebhook } from './subscription-webhook-handler';
import { handleInstallmentWebhook } from './installment-webhook-handler';
import { handleAccountWebhook } from './account-webhook-handler';
import { handleInternalTransferWebhook } from './internal-transfer-webhook-handler';
import { auditLogService } from '../foundation/audit-log.service';
import { computeNextRetryAt } from './webhook-backoff';
import { withCorrelationId, generateCorrelationId } from '../foundation/correlation';
import {
  logWebhookProcessing,
  createWebhookLogEntry,
  alertIfUnhandledCritical,
  alertIfUnknownEvent,
  alertTokenRejected,
  alertQueueLagCritical,
} from './webhook-observability.service';
import { getWebhookQueueMetrics, evaluateRetentionAlert } from './webhook-reconciliation.service';
import {
  authenticateAsaasWebhookToken,
  hashWebhookPayload,
  getAsaasWebhookTokenHashPrefix,
} from './asaas-webhook-auth';
import { redactWebhookLogObject } from './webhook-redaction';
import { syncAsaasOperationalStatus } from '../foundation/asaas-operational-guard';
import { shouldAlertUnknownWebhookEvent } from './asaas-event-registry';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

type AttemptLogEntry = {
  at: string;
  ok: boolean;
  status: 'PROCESSADO' | 'ERRO';
  duracaoMs: number;
  error?: string;
  source?: 'WEBHOOK' | 'REPLAY' | 'REPROCESS';
  workerId?: string;
  correlationId?: string;
};

type AsaasEntityReference = string | { id?: string | null } | null | undefined;

const DEFAULT_MAX_REPROCESS_ATTEMPTS = 5;

function getMaxReprocessAttempts(): number {
  const parsed = Number(process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS ?? DEFAULT_MAX_REPROCESS_ATTEMPTS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_REPROCESS_ATTEMPTS;
  return Math.floor(parsed);
}

function buildNextAttemptsLog(prev: unknown, entry: AttemptLogEntry): AttemptLogEntry[] {
  const prevArray = Array.isArray(prev) ? (prev as AttemptLogEntry[]) : [];
  const next = [...prevArray, entry];
  if (next.length <= 20) return next;
  return next.slice(next.length - 20);
}

type AsaasWebhookBody = {
  id?: string;
  event?: string;
  additionalInfo?: {
    scheduledDate?: string;
  };
  payment?: {
    id: string;
    status?: unknown;
    value?: number;
    netValue?: number;
    originalValue?: number;
    dueDate?: string;
    paymentDate?: string;
    clientPaymentDate?: string;
    externalReference?: string;
    subscription?: string;
    installment?: string;
    installmentNumber?: number;
    deleted?: unknown;
    billingType?: string;
    creditDate?: string;
    estimatedCreditDate?: string;
  };
  transfer?: {
    id: string;
    status?: unknown;
    externalReference?: string;
    effectiveDate?: string | null;
    endToEndIdentifier?: string | null;
    type?: string | null;
    value?: number;
    netValue?: number;
    transferFee?: number;
    authorized?: boolean | null;
    failReason?: string | null;
    transactionReceiptUrl?: string | null;
    operationType?: string | null;
    description?: string | null;
    bankAccount?: {
      ownerName?: string | null;
      cpfCnpj?: string | null;
      pixAddressKey?: string | null;
      bank?: {
        name?: string | null;
        code?: string | null;
      } | null;
    } | null;
  };
  subscription?: {
    id: string;
    status?: unknown;
    externalReference?: string;
    deleted?: unknown;
  };
  anticipation?: {
    id?: string;
    status?: string;
    payment?: AsaasEntityReference;
    installment?: AsaasEntityReference;
    value?: number;
    totalValue?: number;
    netValue?: number;
    fee?: number;
    anticipationDays?: number;
    dueDate?: string;
    creditDate?: string;
    anticipatedDate?: string;
    createdAt?: string;
    dateCreated?: string;
  };
  // Transferências internas (crédito/débito entre subcontas)
  internalTransfer?: {
    id: string;
    value?: number;
    netValue?: number;
    description?: string;
    dateCreated?: string;
    status?: string;
  };
};

function resolveAsaasReferenceId(reference: AsaasEntityReference): string | null {
  if (!reference) return null;
  if (typeof reference === 'string') return reference;
  return typeof reference.id === 'string' && reference.id.length > 0 ? reference.id : null;
}

function getPayloadAsaasPaymentId(payload: AsaasWebhookBody): string | null {
  return payload.payment?.id ?? resolveAsaasReferenceId(payload.anticipation?.payment);
}

function getPayloadAsaasSubscriptionId(payload: AsaasWebhookBody): string | null {
  return payload.payment?.subscription ?? payload.subscription?.id ?? null;
}

function getPayloadAsaasTransferId(payload: AsaasWebhookBody): string | null {
  return payload.transfer?.id ?? null;
}

export type HandleAsaasWebhookEventParams = {
  rawBody: string;
  accessToken?: string | null;
};

export type QueueWebhookResult = {
  success: boolean;
  status: number;
  persisted: boolean;
  message?: string;
  error?: string;
  webhookId?: string;
  contaId?: string;
  event?: string;
  eventId?: string | null;
};

/**
 * Persiste webhook rejeitado para auditoria.
 * Rejeições (JSON inválido, token inválido, evento ausente) são registradas
 * com status REJEITADO para permitir diagnóstico e rastreabilidade.
 */
async function persistRejectedWebhook(params: {
  contaId: string | null;
  rawBody: string;
  reason: string;
  event: string | null;
  eventId: string | null;
}): Promise<void> {
  try {
    const safePayload = (() => {
      try { return JSON.parse(params.rawBody); }
      catch { return { _raw: params.rawBody.slice(0, 2048) }; }
    })();

    await prisma.webhookAsaasRejection.create({
      data: {
        contaId: params.contaId ?? null,
        evento: params.event ?? 'UNKNOWN',
        eventId: params.eventId,
        payloadHash: hashWebhookPayload(params.rawBody),
        payload: safePayload as object,
        reason: params.reason,
      },
    });
  } catch {
    // Fail-safe: não travar fluxo por falha de auditoria
  }
}

async function processAsaasWebhookForRecord(params: {
  contaId: string;
  webhookId: string;
  event: string;
  payload: AsaasWebhookBody;
}): Promise<{
  ok: boolean;
  httpStatus: number;
  error?: string;
  message?: string;
  duracaoMs: number;
  processedPayment?: {
    contaId: string;
    event: string;
    eventId: string | null;
    asaasPaymentId: string;
    occurredAt: string | null;
  };
}> {
  const startedAt = Date.now();

  try {
    const { contaId, event, payload } = params;

    if (event.startsWith('ACCOUNT_STATUS_')) {
      const result = await handleAccountWebhook(contaId, {
        event,
        payloadId: payload.id ?? null,
        scheduledDate: payload.additionalInfo?.scheduledDate ?? null,
      });

      return {
        ok: result.success,
        httpStatus: result.success ? 200 : 500,
        error: result.error,
        duracaoMs: Date.now() - startedAt,
      };
    }

    if (event.startsWith('PAYMENT_')) {
      if (!payload.payment) {
        return {
          ok: false,
          httpStatus: 400,
          error: 'Objeto payment não encontrado para evento de pagamento',
          duracaoMs: Date.now() - startedAt,
        };
      }

      const paymentResult = await handlePaymentWebhook(contaId, {
        event,
        payment: {
          id: payload.payment.id,
          status: payload.payment.status as never,
          value: Number(payload.payment.value ?? 0),
          netValue: Number(payload.payment.netValue ?? 0),
          originalValue: typeof payload.payment.originalValue === 'number' ? payload.payment.originalValue : null,
          externalReference: payload.payment.externalReference,
          subscription: payload.payment.subscription ?? null,
          installment: payload.payment.installment ?? null,
          installmentNumber: payload.payment.installmentNumber ?? null,
          billingType: payload.payment.billingType ?? null,
          dueDate: payload.payment.dueDate ?? null,
          paymentDate: payload.payment.paymentDate ?? null,
          clientPaymentDate: payload.payment.clientPaymentDate ?? null,
          creditDate: payload.payment.creditDate ?? null,
          estimatedCreditDate: payload.payment.estimatedCreditDate ?? null,
        },
      });

      const shouldHandleInstallment =
        Boolean(payload.payment.installment) ||
        (typeof payload.payment.externalReference === 'string' && 
          (payload.payment.externalReference.startsWith('installmentPlan:') ||
           payload.payment.externalReference.startsWith('alusa:installment:')));

      const installmentResult = shouldHandleInstallment
        ? await handleInstallmentWebhook(contaId, {
            event,
            payment: {
              id: payload.payment.id,
              status: typeof payload.payment.status === 'string' ? payload.payment.status : undefined,
              externalReference: payload.payment.externalReference,
              installment: payload.payment.installment ?? null,
              installmentNumber: payload.payment.installmentNumber ?? null,
              deleted: typeof payload.payment.deleted === 'boolean' ? payload.payment.deleted : null,
            },
          })
        : { success: true };

      const ok = paymentResult.success && installmentResult.success;
      const error = paymentResult.error ?? installmentResult.error;
      const occurredAt = [
        payload.payment.clientPaymentDate,
        payload.payment.paymentDate,
        payload.payment.creditDate,
      ].find((value) => typeof value === 'string' && value.length > 0) ?? null;

      return {
        ok,
        httpStatus: ok ? 200 : 500,
        error,
        duracaoMs: Date.now() - startedAt,
        processedPayment: ok
          ? {
              contaId,
              event,
              eventId: payload.id ?? null,
              asaasPaymentId: payload.payment.id,
              occurredAt,
            }
          : undefined,
      };
    }

    if (event.startsWith('TRANSFER_')) {
      if (!payload.transfer) {
        return {
          ok: false,
          httpStatus: 400,
          error: 'Objeto transfer não encontrado para evento de transferência',
          duracaoMs: Date.now() - startedAt,
        };
      }

      const result = await handleTransferWebhook(contaId, {
        event,
        transfer: {
          id: payload.transfer.id,
          status: payload.transfer.status as string | undefined,
          externalReference: payload.transfer.externalReference,
          effectiveDate: payload.transfer.effectiveDate ?? null,
          failReason: payload.transfer.failReason ?? null,
          description: payload.transfer.description ?? null,
          authorized: payload.transfer.authorized ?? null,
          operationType: payload.transfer.operationType ?? null,
          type: payload.transfer.type ?? null,
          transactionReceiptUrl: payload.transfer.transactionReceiptUrl ?? null,
          bankAccount: payload.transfer.bankAccount ?? null,
        },
      });

      return {
        ok: result.success,
        httpStatus: result.success ? 200 : 500,
        error: result.error,
        duracaoMs: Date.now() - startedAt,
      };
    }

    if (event.startsWith('SUBSCRIPTION_')) {
      const subscriptionId = payload.payment?.subscription ?? payload.subscription?.id;
      if (!subscriptionId) {
        return {
          ok: false,
          httpStatus: 400,
          error: 'Objeto subscription não encontrado para evento de assinatura',
          duracaoMs: Date.now() - startedAt,
        };
      }

      const result = await handleSubscriptionWebhook(contaId, {
        event,
        subscription: {
          id: subscriptionId,
          status: payload.subscription?.status as never,
          externalReference: payload.subscription?.externalReference,
          deleted: payload.subscription?.deleted as never,
        },
      });

      return {
        ok: result.success,
        httpStatus: result.success ? 200 : 500,
        error: result.error,
        duracaoMs: Date.now() - startedAt,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL_TRANSFER_* — Transferências internas entre subcontas
    // Eventos: INTERNAL_TRANSFER_CREDIT, INTERNAL_TRANSFER_DEBIT
    // Ação: apenas observabilidade (auditoria), sem efeito financeiro local.
    // Justificativa: no modelo whitelabel da Alusa, cada subconta é isolada
    // e transferências internas não afetam o fluxo matrícula→cobrança→pagamento.
    // ─────────────────────────────────────────────────────────────────────────
    if (event.startsWith('INTERNAL_TRANSFER_')) {
      const result = await handleInternalTransferWebhook(contaId, {
        event,
        transfer: {
          id: payload.internalTransfer?.id ?? payload.id ?? 'unknown',
          value: payload.internalTransfer?.value,
          netValue: payload.internalTransfer?.netValue,
          description: payload.internalTransfer?.description,
          dateCreated: payload.internalTransfer?.dateCreated,
          status: payload.internalTransfer?.status,
        },
      });

      return {
        ok: result.success,
        httpStatus: result.success ? 200 : 500,
        error: result.error,
        duracaoMs: Date.now() - startedAt,
      };
    }

    if (event.startsWith('RECEIVABLE_ANTICIPATION_')) {
      const anticipation = payload.anticipation;
      const anticipationId = anticipation?.id ?? payload.id ?? params.webhookId;

      await auditLogService.record({
        contaId,
        action: `finance.webhook.${event.toLowerCase()}`,
        entity: { type: 'ReceivableAnticipation', id: anticipationId },
        metadata: {
          event,
          eventId: payload.id ?? null,
          anticipationId: anticipation?.id ?? null,
          payment: getPayloadAsaasPaymentId(payload),
          installment: resolveAsaasReferenceId(anticipation?.installment),
          status: anticipation?.status ?? null,
          value: typeof anticipation?.value === 'number' ? anticipation.value : null,
          totalValue: typeof anticipation?.totalValue === 'number' ? anticipation.totalValue : null,
          netValue: typeof anticipation?.netValue === 'number' ? anticipation.netValue : null,
          fee: typeof anticipation?.fee === 'number' ? anticipation.fee : null,
          anticipationDays: typeof anticipation?.anticipationDays === 'number' ? anticipation.anticipationDays : null,
          dueDate: anticipation?.dueDate ?? null,
          creditDate: anticipation?.creditDate ?? null,
          anticipatedDate: anticipation?.anticipatedDate ?? null,
          webhookId: params.webhookId,
          note: 'Anticipation state is read from Asaas on demand; webhook is kept for audit and traceability.',
        },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, httpStatus: 200, duracaoMs: Date.now() - startedAt };
    }

    // ─────────────────────────────────────────────────────────────────────────    // BALANCE_VALUE_* — Saldo da subconta bloqueado/desbloqueado
    // Eventos: BALANCE_VALUE_BLOCKED, BALANCE_VALUE_UNBLOCKED
    // Impacto: BLOCKED = operações financeiras congeladas (crítico)
    // ───────────────────────────────────────────────────────────────────────────
    if (event.startsWith('BALANCE_VALUE_')) {
      const isBlocked = event === 'BALANCE_VALUE_BLOCKED';

      await createNotification({
        contaId,
        type: NotificationType.BALANCE_BLOCKED,
        category: NotificationCategory.SYSTEM,
        severity: isBlocked ? NotificationSeverity.CRITICAL : NotificationSeverity.SUCCESS,
        title: isBlocked ? 'Saldo bloqueado na conta' : 'Saldo desbloqueado na conta',
        message: isBlocked
          ? 'O saldo desta conta foi bloqueado pelo Asaas. Operações financeiras podem estar indisponíveis. Verifique a situação da conta no painel.'
          : 'O bloqueio de saldo desta conta foi removido. As operações financeiras voltaram ao normal.',
        dedupeKey: `balance:${event}:${payload.id ?? contaId}`,
        sourceType: 'WEBHOOK',
        sourceId: payload.id ?? null,
        recipientRoles: [Role.ADMIN, Role.FINANCEIRO],
        metadata: { webhookEvent: event, eventId: payload.id ?? null },
      }).catch((err: unknown) => {
          console.warn('[finance][handleAsaasWebhook][balance-notify-failed]', redactWebhookLogObject({ contaId, event, err }));
      });

      await auditLogService.record({
        contaId,
        action: `finance.webhook.${event.toLowerCase()}`,
        entity: { type: 'AsaasAccount', id: contaId },
        metadata: {
          event,
          eventId: payload.id ?? null,
          note: isBlocked
            ? 'Saldo bloqueado — operações financeiras podem estar indisponíveis.'
            : 'Saldo desbloqueado — operações retomadas.',
        },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, httpStatus: 200, duracaoMs: Date.now() - startedAt };
    }

    // ───────────────────────────────────────────────────────────────────────────
    // ACCESS_TOKEN_* — Alerta de expiração/revogação de token de API
    // Eventos críticos: ACCESS_TOKEN_EXPIRING_SOON, ACCESS_TOKEN_EXPIRED
    // Impacto: token expirado = falha silenciosa em todas as operações Asaas
    // ───────────────────────────────────────────────────────────────────────────
    if (event.startsWith('ACCESS_TOKEN_')) {
      const isExpired = event === 'ASAAS_TOKEN_EXPIRED' || event === 'ACCESS_TOKEN_EXPIRED';
      const isExpiringSoon = event === 'ACCESS_TOKEN_EXPIRING_SOON';
      const nextApiKeyStatus =
        event === 'ACCESS_TOKEN_ENABLED'
          ? 'CONNECTED'
          : event === 'ACCESS_TOKEN_EXPIRED' || event === 'ASAAS_TOKEN_EXPIRED'
            ? 'EXPIRED'
            : event === 'ACCESS_TOKEN_DISABLED'
              ? 'DISABLED'
              : event === 'ACCESS_TOKEN_DELETED'
                ? 'DELETED'
                : null;

      if (nextApiKeyStatus) {
        await prisma.asaasAccount.updateMany({
          where: { financeProfile: { contaId } },
          data: {
            apiKeyStatus: nextApiKeyStatus as never,
            operationalStatus: nextApiKeyStatus === 'CONNECTED' ? 'NOT_READY' : 'API_KEY_REQUIRED',
            lastApiKeyCheckAt: new Date(),
          },
        });
        await syncAsaasOperationalStatus(contaId);
      }

      if (isExpired || isExpiringSoon || event === 'ACCESS_TOKEN_DISABLED' || event === 'ACCESS_TOKEN_DELETED') {
        await createNotification({
          contaId,
          type: NotificationType.ACCESS_TOKEN_ALERT,
          category: NotificationCategory.SYSTEM,
          severity: isExpired || event === 'ACCESS_TOKEN_DISABLED' || event === 'ACCESS_TOKEN_DELETED'
            ? NotificationSeverity.CRITICAL
            : NotificationSeverity.WARNING,
          title: isExpired
            ? 'Token de API expirado'
            : event === 'ACCESS_TOKEN_DISABLED'
              ? 'Token de API desabilitado'
              : event === 'ACCESS_TOKEN_DELETED'
                ? 'Token de API excluído'
                : 'Token de API próximo do vencimento',
          message: isExpired
            ? 'O token de API do Asaas desta conta expirou. Todas as operações financeiras estão bloqueadas. Renove imediatamente no painel do Asaas.'
            : event === 'ACCESS_TOKEN_DISABLED'
              ? 'O token de API do Asaas desta conta foi desabilitado. Todas as operações financeiras estão bloqueadas até a reconexão.'
              : event === 'ACCESS_TOKEN_DELETED'
                ? 'O token de API do Asaas desta conta foi excluído. Todas as operações financeiras estão bloqueadas até salvar uma nova chave.'
                : 'O token de API do Asaas desta conta está próximo do vencimento. Renove antes que expire para evitar interrupção das operações financeiras.',
          dedupeKey: `access_token:${event}:${contaId}`,
          sourceType: 'WEBHOOK',
          sourceId: payload.id ?? null,
          recipientRoles: [Role.ADMIN],
          metadata: { webhookEvent: event, eventId: payload.id ?? null },
        }).catch((err: unknown) => {
          console.warn('[finance][handleAsaasWebhook][access-token-notify-failed]', redactWebhookLogObject({ contaId, event, err }));
        });
      }

      await auditLogService.record({
        contaId,
        action: `finance.webhook.${event.toLowerCase()}`,
        entity: { type: 'AsaasAccount', id: contaId },
        metadata: { event, eventId: payload.id ?? null },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, httpStatus: 200, duracaoMs: Date.now() - startedAt };
    }

    // ───────────────────────────────────────────────────────────────────────────    // Fallback: eventos não roteados
    // Registra recebimento mas não gera efeitos colaterais.
    // Se um evento novo aparecer aqui com frequência, considerar criar handler.
    // ─────────────────────────────────────────────────────────────────────────
    
    // Alertas de observabilidade para eventos sem handler
    alertIfUnhandledCritical(event);
    alertIfUnknownEvent(event);
    if (shouldAlertUnknownWebhookEvent(event)) {
      await upsertFinanceReconciliationIssue({
        contaId,
        entityType: 'WEBHOOK',
        entityId: params.webhookId,
        asaasId: payload.id ?? null,
        issueType: 'WEBHOOK_DROPPED_RISK',
        severity: 'HIGH',
        localStatus: 'UNKNOWN_EVENT',
        remoteStatus: event,
        metadata: {
          event,
          eventId: payload.id ?? null,
          source: 'asaas-webhook-handler',
        },
      });
    }

    return {
      ok: true,
      httpStatus: 200,
      message: `Evento ${event} recebido (sem handler dedicado ainda)`,
      duracaoMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 500,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      duracaoMs: Date.now() - startedAt,
    };
  }
}

/**
 * Enfileira webhook no banco para processamento assíncrono.
 * Usado quando FIN_WEBHOOK_ASYNC_ENABLED=true.
 */
export async function enqueueAsaasWebhookEvent(
  params: HandleAsaasWebhookEventParams
): Promise<QueueWebhookResult> {
  let payload: AsaasWebhookBody;

  try {
    payload = JSON.parse(params.rawBody) as AsaasWebhookBody;
  } catch {
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'JSON inválido', event: null, eventId: null });
    return { success: false, status: 400, persisted: false, error: 'JSON inválido' };
  }

  const event = payload.event;
  if (!event) {
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Evento não especificado', event: null, eventId: payload.id ?? null });
    return { success: false, status: 400, persisted: false, error: 'Evento não especificado' };
  }

  if (!params.accessToken) {
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Token ausente', event, eventId: payload.id ?? null });
    return { success: false, status: 401, persisted: false, error: 'Assinatura inválida' };
  }

  const auth = await authenticateAsaasWebhookToken(params.accessToken);
  if (!auth) {
    alertTokenRejected({
      tokenHashPrefix: getAsaasWebhookTokenHashPrefix(params.accessToken) ?? 'invalid-format',
      event,
      eventId: payload.id ?? null,
    });
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Token inválido', event, eventId: payload.id ?? null });
    return { success: false, status: 403, persisted: false, error: 'Assinatura inválida' };
  }
  const contaId = auth.contaId;

  const payloadHash = hashWebhookPayload(params.rawBody);
  const eventId = payload.id ?? null;
  const now = new Date();

  const existing = eventId
    ? await prisma.webhookAsaas.findUnique({ where: { uq_webhookasaas_conta_event: { contaId, eventId } } })
    : await prisma.webhookAsaas.findFirst({ where: { contaId, payloadHash } });

  if (existing?.status === 'PROCESSADO') {
    return {
      success: true,
      status: 200,
      persisted: true,
      message: 'Evento já processado',
      webhookId: existing.id,
      contaId,
      event,
      eventId,
    };
  }

  if (existing?.status === 'PROCESSANDO' || existing?.status === 'PENDENTE') {
    return {
      success: true,
      status: 200,
      persisted: true,
      message: 'Evento já enfileirado',
      webhookId: existing.id,
      contaId,
      event,
      eventId,
    };
  }

  let webhookId: string;

  if (existing) {
    const updated = await prisma.webhookAsaas.update({
      where: { id: existing.id },
      data: {
        evento: event,
        payload: payload as unknown as object,
        payloadHash,
        status: 'PENDENTE',
        ultimoErro: null,
        duracaoMs: null,
        processadoEm: null,
        // Não incrementa tentativas no enqueue; incremento ocorre no worker
        asaasPaymentId: getPayloadAsaasPaymentId(payload) ?? existing.asaasPaymentId,
        asaasSubscriptionId: getPayloadAsaasSubscriptionId(payload) ?? existing.asaasSubscriptionId,
        asaasTransferId: getPayloadAsaasTransferId(payload) ?? existing.asaasTransferId,
        recebidoEm: existing.recebidoEm ?? now,
      },
      select: { id: true },
    });
    webhookId = updated.id;
  } else {
    try {
      const created = await prisma.webhookAsaas.create({
        data: {
          contaId,
          evento: event,
          eventId,
          payloadHash,
          payload: payload as unknown as object,
          status: 'PENDENTE',
          tentativas: 0,
          asaasPaymentId: getPayloadAsaasPaymentId(payload),
          asaasSubscriptionId: getPayloadAsaasSubscriptionId(payload),
          asaasTransferId: getPayloadAsaasTransferId(payload),
        },
        select: { id: true },
      });
      webhookId = created.id;
    } catch (error) {
      // Corrida entre requests simultâneas do mesmo evento
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
        const concurrent = eventId
          ? await prisma.webhookAsaas.findUnique({ where: { uq_webhookasaas_conta_event: { contaId, eventId } }, select: { id: true } })
          : await prisma.webhookAsaas.findFirst({ where: { contaId, payloadHash }, select: { id: true } });
        if (concurrent) {
          webhookId = concurrent.id;
        } else {
          return { success: false, status: 500, persisted: false, error: 'Falha ao enfileirar webhook' };
        }
      } else {
        return { success: false, status: 500, persisted: false, error: 'Falha ao enfileirar webhook' };
      }
    }
  }

  logWebhookProcessing(
    createWebhookLogEntry({
      event,
      eventId,
      contaId,
      result: 'SKIPPED',
      durationMs: 0,
      source: 'WEBHOOK',
    })
  );

  return {
    success: true,
    status: 200,
    persisted: true,
    message: 'Evento enfileirado',
    webhookId,
    contaId,
    event,
    eventId,
  };
}

export async function processAsaasWebhookQueue(params?: {
  contaId?: string;
  limit?: number;
  statuses?: Array<'PENDENTE' | 'ERRO'>;
  source?: 'WEBHOOK' | 'REPLAY' | 'REPROCESS';
  tenantFair?: boolean;
}): Promise<{
  attempted: number;
  processed: number;
  failed: number;
  skipped: number;
  workerId: string;
  processedPayments: Array<{
    contaId: string;
    event: string;
    eventId: string | null;
    asaasPaymentId: string;
    occurredAt: string | null;
  }>;
}> {
  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 1000);
  const statuses = params?.statuses?.length ? params.statuses : ['PENDENTE', 'ERRO'];
  const maxAttempts = getMaxReprocessAttempts();
  const source = params?.source ?? 'WEBHOOK';
  const workerId = `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const processedPayments: Array<{
    contaId: string;
    event: string;
    eventId: string | null;
    asaasPaymentId: string;
    occurredAt: string | null;
  }> = [];

  const claimedRows = await prisma.$transaction(async (tx) => {
    const contaFilter = params?.contaId ? Prisma.sql`AND w."contaId" = ${params.contaId}` : Prisma.empty;

    // Tenant-fair: distribui picks entre tenants usando DISTINCT ON + ORDER BY
    if (params?.tenantFair && !params?.contaId) {
      return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        WITH per_tenant AS (
          SELECT DISTINCT ON (w."contaId") w.id, w."contaId", w."recebidoEm"
          FROM "WebhookAsaas" w
          WHERE w.status IN (${Prisma.join(statuses)})
            AND w.tentativas < ${maxAttempts}
            AND (w."nextRetryAt" IS NULL OR w."nextRetryAt" <= NOW())
          ORDER BY w."contaId", w."recebidoEm" ASC
        ),
        picked AS (
          SELECT w.id
          FROM "WebhookAsaas" w
          WHERE w.status IN (${Prisma.join(statuses)})
            AND w.tentativas < ${maxAttempts}
            AND (w."nextRetryAt" IS NULL OR w."nextRetryAt" <= NOW())
            AND (
              w.id IN (SELECT id FROM per_tenant)
              OR w."recebidoEm" <= (SELECT MIN("recebidoEm") FROM per_tenant)
            )
          ORDER BY w."recebidoEm" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "WebhookAsaas" w
        SET
          status = 'PROCESSANDO',
          tentativas = w.tentativas + 1,
          "ultimaTentativaEm" = NOW()
        FROM picked
        WHERE w.id = picked.id
        RETURNING w.id
      `);
    }

    return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH picked AS (
        SELECT w.id
        FROM "WebhookAsaas" w
        WHERE w.status IN (${Prisma.join(statuses)})
          ${contaFilter}
          AND w.tentativas < ${maxAttempts}
          AND (w."nextRetryAt" IS NULL OR w."nextRetryAt" <= NOW())
        ORDER BY w."recebidoEm" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "WebhookAsaas" w
      SET
        status = 'PROCESSANDO',
        tentativas = w.tentativas + 1,
        "ultimaTentativaEm" = NOW()
      FROM picked
      WHERE w.id = picked.id
      RETURNING w.id
    `);
  });

  if (!claimedRows.length) {
    return { attempted: 0, processed: 0, failed: 0, skipped: 0, workerId, processedPayments };
  }

  const hookIds = claimedRows.map((r) => r.id);
  const hooks = await prisma.webhookAsaas.findMany({
    where: { id: { in: hookIds } },
    orderBy: { recebidoEm: 'asc' },
  });

  let attempted = 0;
  let processed = 0;
  let failed = 0;
  const skipped = 0;

  for (const hook of hooks) {
    attempted += 1;

    const event = hook.evento;
    const payload = hook.payload as unknown as AsaasWebhookBody;
    const correlationId = generateCorrelationId();

    const result = await withCorrelationId(
      () => processAsaasWebhookForRecord({
        contaId: hook.contaId,
        webhookId: hook.id,
        event,
        payload: { ...payload, event, id: payload?.id ?? hook.eventId ?? undefined },
      }),
      correlationId,
    );

    const status = result.ok ? 'PROCESSADO' : 'ERRO';
    const attemptsLog = buildNextAttemptsLog(hook.attemptsLog, {
      at: new Date().toISOString(),
      ok: result.ok,
      status,
      duracaoMs: result.duracaoMs,
      error: result.error,
      source,
      workerId,
      correlationId,
    });

    await prisma.webhookAsaas.update({
      where: { id: hook.id },
      data: {
        status,
        processadoEm: new Date(),
        duracaoMs: result.duracaoMs,
        ultimoErro: result.ok ? null : result.error ?? 'Erro desconhecido',
        attemptsLog: attemptsLog as unknown as object,
        nextRetryAt: result.ok ? null : computeNextRetryAt(hook.tentativas),
      },
    });

    logWebhookProcessing(
      createWebhookLogEntry({
        event,
        eventId: hook.eventId ?? null,
        contaId: hook.contaId,
        result: result.ok ? 'SUCCESS' : 'ERROR',
        durationMs: result.duracaoMs,
        error: result.error,
        source,
      })
    );

    if (result.ok) processed += 1;
    else failed += 1;

    if (result.processedPayment) {
      processedPayments.push(result.processedPayment);
    }
  }

  // Avaliar retenção pós-processamento e emitir alerta se necessário
  try {
    const metrics = await getWebhookQueueMetrics({ contaId: params?.contaId });
    const alert = evaluateRetentionAlert(metrics);
    if (alert) {
      alertQueueLagCritical({
        level: alert.level,
        lagSeconds: alert.lagSeconds,
        backlog: alert.backlog,
        contaId: String(alert.contaId),
        message: alert.message,
      });
    }
  } catch {
    // Fail-safe: não travar processamento por falha de métricas
  }

  return { attempted, processed, failed, skipped, workerId, processedPayments };
}

export async function reprocessErroredAsaasWebhooks(params: {
  contaId: string;
  limit?: number;
}): Promise<{ attempted: number; processed: number; failed: number; skipped: number }> {
  return processAsaasWebhookQueue({
    contaId: params.contaId,
    limit: params.limit ?? 50,
    statuses: ['ERRO'],
    source: 'REPROCESS',
  });
}

/**
 * Handler único de webhooks do Asaas (Fase 2)
 * - valida origem (ADR-009)
 * - idempotência por eventId (ou hash do payload) (ADR-002/ADR-009)
 * - roteamento por tipo de evento (payment/subscription/etc)
 */
export async function handleAsaasWebhookEvent(params: HandleAsaasWebhookEventParams): Promise<{
  success: boolean;
  status: number;
  persisted: boolean;
  message?: string;
  error?: string;
  webhookId?: string;
  contaId?: string;
  event?: string;
  eventId?: string | null;
}> {
  let payload: AsaasWebhookBody;

  try {
    payload = JSON.parse(params.rawBody) as AsaasWebhookBody;
  } catch {
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'JSON inválido', event: null, eventId: null });
    return { success: false, status: 400, persisted: false, error: 'JSON inválido' };
  }

  const event = payload.event;
  if (!event) {
    await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Evento não especificado', event: null, eventId: payload.id ?? null });
    return { success: false, status: 400, persisted: false, error: 'Evento não especificado' };
  }

  // Prioridade: authToken por tenant (ADR-009 / Fase 2)
  if (params.accessToken) {
    const auth = await authenticateAsaasWebhookToken(params.accessToken);
    if (!auth) {
      alertTokenRejected({
        tokenHashPrefix: getAsaasWebhookTokenHashPrefix(params.accessToken) ?? 'invalid-format',
        event,
        eventId: payload.id ?? null,
      });
      await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Token inválido', event, eventId: payload.id ?? null });
      return { success: false, status: 403, persisted: false, error: 'Assinatura inválida' };
    }

    const contaId = auth.contaId;

    const payloadHash = hashWebhookPayload(params.rawBody);
    const eventId = payload.id;

    const existing = eventId
      ? await prisma.webhookAsaas.findUnique({ where: { uq_webhookasaas_conta_event: { contaId, eventId } } })
      : await prisma.webhookAsaas.findFirst({ where: { contaId, payloadHash } });

    if (existing?.status === 'PROCESSADO') {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento já processado',
        webhookId: existing.id,
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    if (existing?.status === 'PROCESSANDO') {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento em processamento',
        webhookId: existing.id,
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    const maxAttempts = getMaxReprocessAttempts();
    if (existing && existing.tentativas >= maxAttempts) {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento ignorado (limite de tentativas excedido)',
        webhookId: existing.id,
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    const now = new Date();
    let createdNewWebhookRecord = false;

    const webhookRecord = existing
      ? await (async () => {
          const claimed = await prisma.webhookAsaas.updateMany({
            where: {
              id: existing.id,
              status: { in: ['PENDENTE', 'ERRO'] },
            },
            data: {
              evento: event,
              payload: payload as unknown as object,
              status: 'PROCESSANDO',
              tentativas: { increment: 1 },
              ultimaTentativaEm: now,
            },
          });

          if (claimed.count !== 1) {
            return null;
          }

          return prisma.webhookAsaas.findUnique({ where: { id: existing.id } });
        })()
      : await (async () => {
          try {
            const created = await prisma.webhookAsaas.create({
              data: {
                contaId,
                evento: event,
                eventId: eventId ?? null,
                payloadHash,
                payload: payload as unknown as object,
                status: 'PROCESSANDO',
                tentativas: 1,
                ultimaTentativaEm: now,
                // Campos de correlação para rastreio
                asaasPaymentId: getPayloadAsaasPaymentId(payload),
                asaasSubscriptionId: getPayloadAsaasSubscriptionId(payload),
                asaasTransferId: getPayloadAsaasTransferId(payload),
              },
            });
            createdNewWebhookRecord = true;
            return created;
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
              return eventId
                ? prisma.webhookAsaas.findUnique({ where: { uq_webhookasaas_conta_event: { contaId, eventId } } })
                : prisma.webhookAsaas.findFirst({ where: { contaId, payloadHash } });
            }

            throw error;
          }
        })();

    if (!webhookRecord) {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento em processamento',
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    if (!existing && !createdNewWebhookRecord && webhookRecord.status === 'PROCESSADO') {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento já processado',
        webhookId: webhookRecord.id,
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    if (!existing && !createdNewWebhookRecord && webhookRecord.status === 'PROCESSANDO') {
      return {
        success: true,
        status: 200,
        persisted: true,
        message: 'Evento em processamento',
        webhookId: webhookRecord.id,
        contaId,
        event,
        eventId: eventId ?? null,
      };
    }

    const processedResult = await processAsaasWebhookForRecord({
      contaId,
      webhookId: webhookRecord.id,
      event,
      payload,
    });

    const finalStatus = processedResult.ok ? 'PROCESSADO' : 'ERRO';
    const attemptsLog = buildNextAttemptsLog(webhookRecord.attemptsLog, {
      at: new Date().toISOString(),
      ok: processedResult.ok,
      status: finalStatus,
      duracaoMs: processedResult.duracaoMs,
      error: processedResult.error,
      source: 'WEBHOOK',
    });

    await prisma.webhookAsaas.update({
      where: { id: webhookRecord.id },
      data: {
        status: finalStatus,
        processadoEm: new Date(),
        duracaoMs: processedResult.duracaoMs,
        ultimoErro: processedResult.ok ? null : processedResult.error ?? 'Erro desconhecido',
        attemptsLog: attemptsLog as unknown as object,
        nextRetryAt: processedResult.ok ? null : computeNextRetryAt(webhookRecord.tentativas),
      },
    });

    // Log estruturado para observabilidade
    logWebhookProcessing(
      createWebhookLogEntry({
        event,
        eventId: eventId ?? null,
        contaId,
        result: processedResult.ok ? 'SUCCESS' : 'ERROR',
        durationMs: processedResult.duracaoMs,
        error: processedResult.error,
        source: 'WEBHOOK',
      })
    );

    return {
      success: processedResult.ok,
      status: processedResult.httpStatus,
      persisted: true,
      message: processedResult.message,
      error: processedResult.error,
      webhookId: webhookRecord.id,
      contaId,
      event,
      eventId: eventId ?? null,
    };
  }

  // Sem token de autenticação, rejeitamos.
  alertTokenRejected({
    tokenHashPrefix: 'missing',
    event,
    eventId: payload.id ?? null,
  });
  await persistRejectedWebhook({ contaId: null, rawBody: params.rawBody, reason: 'Token ausente', event, eventId: payload.id ?? null });
  return { success: false, status: 401, persisted: false, error: 'Assinatura inválida' };
}
