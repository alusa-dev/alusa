/**
 * Webhook Replay Service (Admin)
 *
 * Mecanismo interno de replay seguro para webhooks já recebidos.
 *
 * Funcionalidades:
 * - Replay por eventId específico
 * - Replay por intervalo de datas (from/to)
 * - Apenas eventos handled=true podem ser reprocessados
 * - Auditoria completa com source=REPLAY
 *
 * Princípios:
 * - Idempotente: reutiliza o pipeline existente
 * - Seguro: não processa eventos unhandled
 * - Auditável: registra cada replay no attemptsLog
 * - Paginado: controle de volume para intervalos
 */

import { prisma } from '@alusa/database';
import { isHandledEvent, getEventDefinition } from './asaas-event-registry';
import {
  logWebhookProcessing,
  createWebhookLogEntry,
} from './webhook-observability.service';
import { syncAsaasOperationalStatus } from '../foundation/asaas-operational-guard';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ReplayByEventIdParams {
  contaId: string;
  eventId: string;
  /** Permite forçar replay mesmo se handled=false (uso restrito) */
  force?: boolean;
}

export interface ReplayByEventIdResult {
  success: boolean;
  eventId: string;
  status: 'REPLAYED' | 'NOT_FOUND' | 'UNHANDLED_EVENT' | 'ALREADY_PROCESSING' | 'ERROR';
  message?: string;
  error?: string;
}

export interface ReplayByDateRangeParams {
  contaId: string;
  from: Date;
  to: Date;
  /** Limite de eventos por chamada (default: 50, max: 200) */
  limit?: number;
  /** Offset para paginação */
  offset?: number;
  /** Filtrar por status específico */
  status?: 'PROCESSADO' | 'ERRO' | 'PENDENTE';
  /** Filtrar por categoria de evento */
  category?: string;
}

export interface ReplayByDateRangeResult {
  success: boolean;
  total: number;
  replayed: number;
  skipped: number;
  failed: number;
  hasMore: boolean;
  details: Array<{
    eventId: string | null;
    webhookId: string;
    evento: string;
    status: 'REPLAYED' | 'SKIPPED' | 'ERROR';
    reason?: string;
  }>;
}

type AttemptLogEntry = {
  at: string;
  ok: boolean;
  status: 'PROCESSADO' | 'ERRO';
  duracaoMs: number;
  error?: string;
  source?: 'WEBHOOK' | 'REPLAY' | 'REPROCESS';
};

type AsaasEntityReference = string | { id?: string | null } | null | undefined;

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function buildNextAttemptsLog(prev: unknown, entry: AttemptLogEntry): AttemptLogEntry[] {
  const prevArray = Array.isArray(prev) ? (prev as AttemptLogEntry[]) : [];
  const next = [...prevArray, entry];
  if (next.length <= 20) return next;
  return next.slice(next.length - 20);
}

/**
 * Importa dinamicamente o processador para evitar dependência circular
 */
async function getWebhookProcessor() {
  // Importação dinâmica para evitar circular dependency
  const { handlePaymentWebhook } = await import('./payment-webhook-handler');
  const { handleSubscriptionWebhook } = await import('./subscription-webhook-handler');
  const { handleTransferWebhook } = await import('./transfer-webhook-handler');
  const { handleAccountWebhook } = await import('./account-webhook-handler');
  const { handleInternalTransferWebhook } = await import('./internal-transfer-webhook-handler');
  const { handleInstallmentWebhook } = await import('./installment-webhook-handler');

  return {
    handlePaymentWebhook,
    handleSubscriptionWebhook,
    handleTransferWebhook,
    handleAccountWebhook,
    handleInternalTransferWebhook,
    handleInstallmentWebhook,
  };
}

type WebhookPayload = {
  id?: string;
  event?: string;
  additionalInfo?: { scheduledDate?: string };
  payment?: {
    id: string;
    status?: unknown;
    value?: number;
    netValue?: number;
    externalReference?: string;
    subscription?: string;
    installment?: string;
    installmentNumber?: number;
    deleted?: unknown;
  };
  transfer?: {
    id: string;
    status?: unknown;
    externalReference?: string;
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
  };
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

/**
 * Processa um webhook específico (replay)
 */
async function processWebhookReplay(params: {
  contaId: string;
  webhookId: string;
  event: string;
  payload: WebhookPayload;
}): Promise<{ ok: boolean; error?: string; durationMs: number }> {
  const startedAt = Date.now();
  const handlers = await getWebhookProcessor();

  try {
    const { contaId, event, payload } = params;

    if (event.startsWith('ACCOUNT_STATUS_')) {
      const result = await handlers.handleAccountWebhook(contaId, {
        event,
        payloadId: payload.id ?? null,
        scheduledDate: payload.additionalInfo?.scheduledDate ?? null,
      });
      return { ok: result.success, error: result.error, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('PAYMENT_')) {
      if (!payload.payment) {
        return { ok: false, error: 'Objeto payment não encontrado', durationMs: Date.now() - startedAt };
      }

      const paymentResult = await handlers.handlePaymentWebhook(contaId, {
        event,
        payment: {
          id: payload.payment.id,
          status: payload.payment.status as never,
          value: Number(payload.payment.value ?? 0),
          netValue: Number(payload.payment.netValue ?? 0),
          externalReference: payload.payment.externalReference,
          subscription: payload.payment.subscription ?? null,
        },
      });

      // Também processar installment se aplicável
      const ref = payload.payment.externalReference;
      const shouldHandleInstallment =
        Boolean(payload.payment.installment) ||
        (typeof ref === 'string' &&
          (ref.startsWith('installmentPlan:') || ref.startsWith('alusa:installment:')));

      const installmentResult = shouldHandleInstallment
        ? await handlers.handleInstallmentWebhook(contaId, {
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
      return {
        ok,
        error: paymentResult.error ?? installmentResult.error,
        durationMs: Date.now() - startedAt,
      };
    }

    if (event.startsWith('TRANSFER_')) {
      if (!payload.transfer) {
        return { ok: false, error: 'Objeto transfer não encontrado', durationMs: Date.now() - startedAt };
      }

      const result = await handlers.handleTransferWebhook(contaId, {
        event,
        transfer: {
          id: payload.transfer.id,
          status: payload.transfer.status as never,
          externalReference: payload.transfer.externalReference,
        },
      });
      return { ok: result.success, error: result.error, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('SUBSCRIPTION_')) {
      const subscriptionId = payload.payment?.subscription ?? payload.subscription?.id;
      if (!subscriptionId) {
        return { ok: false, error: 'Objeto subscription não encontrado', durationMs: Date.now() - startedAt };
      }

      const result = await handlers.handleSubscriptionWebhook(contaId, {
        event,
        subscription: {
          id: subscriptionId,
          status: payload.subscription?.status as never,
          externalReference: payload.subscription?.externalReference,
          deleted: payload.subscription?.deleted as never,
        },
      });
      return { ok: result.success, error: result.error, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('INTERNAL_TRANSFER_')) {
      const result = await handlers.handleInternalTransferWebhook(contaId, {
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
      return { ok: result.success, error: result.error, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('RECEIVABLE_ANTICIPATION_')) {
      const { auditLogService } = await import('../foundation/audit-log.service');
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
          payment: resolveAsaasReferenceId(anticipation?.payment) ?? payload.payment?.id ?? null,
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
          source: 'REPLAY',
        },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('BALANCE_VALUE_')) {
      const { createNotification } = await import('@alusa/lib');
      const { auditLogService } = await import('../foundation/audit-log.service');
      const { NotificationType, NotificationCategory, NotificationSeverity, Role } = await import('@prisma/client');

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
        console.warn('[finance][replayWebhook][balance-notify-failed]', { contaId, event, err });
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
          source: 'REPLAY',
        },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, durationMs: Date.now() - startedAt };
    }

    if (event.startsWith('ACCESS_TOKEN_')) {
      const { createNotification } = await import('@alusa/lib');
      const { auditLogService } = await import('../foundation/audit-log.service');
      const { NotificationType, NotificationCategory, NotificationSeverity, Role } = await import('@prisma/client');

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
          console.warn('[finance][replayWebhook][access-token-notify-failed]', { contaId, event, err });
        });
      }

      await auditLogService.record({
        contaId,
        action: `finance.webhook.${event.toLowerCase()}`,
        entity: { type: 'AsaasAccount', id: contaId },
        metadata: { event, eventId: payload.id ?? null, source: 'REPLAY' },
        actor: { type: 'SYSTEM' },
      });

      return { ok: true, durationMs: Date.now() - startedAt };
    }

    // Evento não roteado (mas handled=true no registry)
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
      durationMs: Date.now() - startedAt,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replay de um webhook específico por eventId
 */
export async function replayWebhookByEventId(
  params: ReplayByEventIdParams
): Promise<ReplayByEventIdResult> {
  const { contaId, eventId, force = false } = params;

  // 1. Buscar webhook
  const webhook = await prisma.webhookAsaas.findFirst({
    where: { contaId, eventId },
  });

  if (!webhook) {
    return {
      success: false,
      eventId,
      status: 'NOT_FOUND',
      message: `Webhook com eventId ${eventId} não encontrado`,
    };
  }

  // 2. Verificar se evento é handled
  const evento = webhook.evento;
  if (!isHandledEvent(evento) && !force) {
    const definition = getEventDefinition(evento);
    return {
      success: false,
      eventId,
      status: 'UNHANDLED_EVENT',
      message: `Evento ${evento} não possui handler (categoria: ${definition?.category ?? 'UNKNOWN'})`,
    };
  }

  // 3. Verificar se já está sendo processado
  if (webhook.status === 'PROCESSANDO') {
    return {
      success: false,
      eventId,
      status: 'ALREADY_PROCESSING',
      message: 'Webhook já está sendo processado',
    };
  }

  // 4. Marcar como processando
  await prisma.webhookAsaas.update({
    where: { id: webhook.id },
    data: {
      status: 'PROCESSANDO',
      ultimaTentativaEm: new Date(),
    },
  });

  // 5. Processar
  const result = await processWebhookReplay({
    contaId,
    webhookId: webhook.id,
    event: evento,
    payload: webhook.payload as WebhookPayload,
  });

  // 6. Atualizar status e attemptsLog
  const finalStatus = result.ok ? 'PROCESSADO' : 'ERRO';
  const attemptsLog = buildNextAttemptsLog(webhook.attemptsLog, {
    at: new Date().toISOString(),
    ok: result.ok,
    status: finalStatus,
    duracaoMs: result.durationMs,
    error: result.error,
    source: 'REPLAY',
  });

  await prisma.webhookAsaas.update({
    where: { id: webhook.id },
    data: {
      status: finalStatus,
      processadoEm: new Date(),
      duracaoMs: result.durationMs,
      ultimoErro: result.ok ? null : result.error ?? 'Erro desconhecido',
      attemptsLog: attemptsLog as unknown as object,
    },
  });

  // 7. Log estruturado
  logWebhookProcessing(
    createWebhookLogEntry({
      event: evento,
      eventId,
      contaId,
      result: result.ok ? 'SUCCESS' : 'ERROR',
      durationMs: result.durationMs,
      error: result.error,
      source: 'REPLAY',
    })
  );

  return {
    success: result.ok,
    eventId,
    status: result.ok ? 'REPLAYED' : 'ERROR',
    message: result.ok ? 'Webhook reprocessado com sucesso' : undefined,
    error: result.error,
  };
}

/**
 * Replay de webhooks por intervalo de datas
 */
export async function replayWebhooksByDateRange(
  params: ReplayByDateRangeParams
): Promise<ReplayByDateRangeResult> {
  const { contaId, from, to, limit = 50, offset = 0, status, category } = params;

  // Validar limite
  const safeLimit = Math.min(Math.max(limit, 1), 200);

  // Buscar webhooks
  const webhooks = await prisma.webhookAsaas.findMany({
    where: {
      contaId,
      recebidoEm: {
        gte: from,
        lte: to,
      },
      ...(status && { status }),
    },
    orderBy: { recebidoEm: 'asc' },
    skip: offset,
    take: safeLimit + 1, // +1 para verificar hasMore
  });

  const hasMore = webhooks.length > safeLimit;
  const toProcess = webhooks.slice(0, safeLimit);

  // Filtrar por categoria se especificado
  const filtered = category
    ? toProcess.filter((w) => {
        const def = getEventDefinition(w.evento);
        return def?.category === category;
      })
    : toProcess;

  const details: ReplayByDateRangeResult['details'] = [];
  let replayed = 0;
  let skipped = 0;
  let failed = 0;

  for (const webhook of filtered) {
    const evento = webhook.evento;

    // Verificar se handled
    if (!isHandledEvent(evento)) {
      details.push({
        eventId: webhook.eventId,
        webhookId: webhook.id,
        evento,
        status: 'SKIPPED',
        reason: 'Evento não possui handler',
      });
      skipped += 1;
      continue;
    }

    // Verificar se já está processando
    if (webhook.status === 'PROCESSANDO') {
      details.push({
        eventId: webhook.eventId,
        webhookId: webhook.id,
        evento,
        status: 'SKIPPED',
        reason: 'Já em processamento',
      });
      skipped += 1;
      continue;
    }

    // Processar
    const result = await replayWebhookByEventId({
      contaId,
      eventId: webhook.eventId ?? webhook.id,
    });

    if (result.status === 'REPLAYED') {
      details.push({
        eventId: webhook.eventId,
        webhookId: webhook.id,
        evento,
        status: 'REPLAYED',
      });
      replayed += 1;
    } else if (result.status === 'ERROR') {
      details.push({
        eventId: webhook.eventId,
        webhookId: webhook.id,
        evento,
        status: 'ERROR',
        reason: result.error,
      });
      failed += 1;
    } else {
      details.push({
        eventId: webhook.eventId,
        webhookId: webhook.id,
        evento,
        status: 'SKIPPED',
        reason: result.message,
      });
      skipped += 1;
    }
  }

  return {
    success: failed === 0,
    total: filtered.length,
    replayed,
    skipped,
    failed,
    hasMore,
    details,
  };
}

/**
 * Verifica se um eventId pode ser reprocessado
 */
export async function canReplayWebhook(
  contaId: string,
  eventId: string
): Promise<{
  canReplay: boolean;
  reason?: string;
  evento?: string;
  category?: string;
}> {
  const webhook = await prisma.webhookAsaas.findFirst({
    where: { contaId, eventId },
  });

  if (!webhook) {
    return { canReplay: false, reason: 'Webhook não encontrado' };
  }

  if (webhook.status === 'PROCESSANDO') {
    return {
      canReplay: false,
      reason: 'Webhook em processamento',
      evento: webhook.evento,
    };
  }

  const definition = getEventDefinition(webhook.evento);
  if (!definition?.handled) {
    return {
      canReplay: false,
      reason: 'Evento não possui handler',
      evento: webhook.evento,
      category: definition?.category,
    };
  }

  return {
    canReplay: true,
    evento: webhook.evento,
    category: definition.category,
  };
}
