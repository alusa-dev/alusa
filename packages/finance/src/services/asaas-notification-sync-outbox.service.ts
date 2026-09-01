import { prisma } from '@alusa/database';

import { auditLogService, type AuditActorRef } from '../foundation/audit-log.service';
import { ensureCustomerNotificationsEnabled } from './customer-notification.service';
import {
  channelPreferencesFromWizardSelection,
  syncCustomerNotificationsForUserSelection,
} from './sync-customer-notifications-at-charge';

export const NOTIFICATION_SYNC_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationSyncChannel = (typeof NOTIFICATION_SYNC_CHANNELS)[number];

export type NotificationSyncOutboxStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'DONE'
  | 'FAILED'
  | 'EXHAUSTED';

export type EnqueueAsaasNotificationSyncInput = {
  contaId: string;
  asaasCustomerId: string;
  channels: NotificationSyncChannel[];
  externalReference?: string;
  correlationId?: string;
  reason?: string;
};

export type NotificationSyncAuditStatus =
  | 'STARTED'
  | 'SUCCESS'
  | 'PARTIAL'
  | 'QUEUED'
  | 'FAILED'
  | 'EXHAUSTED';

export type RecordNotificationSyncAuditInput = {
  contaId: string;
  asaasCustomerId: string;
  status: NotificationSyncAuditStatus;
  channels: NotificationSyncChannel[];
  externalReference?: string;
  correlationId?: string;
  outboxId?: string;
  reason?: string;
  warningsCount?: number;
  actor?: AuditActorRef;
};

export type ProcessAsaasNotificationSyncOutboxInput = {
  contaId?: string;
  limit?: number;
  processingTimeoutMinutes?: number;
  maxAttempts?: number;
};

export type ProcessAsaasNotificationSyncOutboxResult = {
  scanned: number;
  processed: number;
  partial: number;
  failed: number;
  exhausted: number;
  errors: Array<{ id: string; contaId: string; asaasCustomerId: string; message: string }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function normalizedChannels(channels: NotificationSyncChannel[]): NotificationSyncChannel[] {
  return [...new Set(channels)].sort();
}

function dedupeKey(input: EnqueueAsaasNotificationSyncInput, channels: NotificationSyncChannel[]) {
  const operation = input.externalReference ?? input.correlationId ?? input.asaasCustomerId;
  return `charge-notifications:${operation}:${channels.join(',')}`;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002',
  );
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/access_token[=:][^\s&]+/gi, 'access_token=[redacted]').slice(0, 1000);
}

function nextAttemptDate(attempts: number): Date {
  const minutes = Math.min(120, Math.max(1, 2 ** Math.min(6, attempts)));
  return new Date(Date.now() + minutes * 60_000);
}

export async function recordNotificationSyncAudit(input: RecordNotificationSyncAuditInput) {
  try {
    return await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: `finance.notification_sync.${input.status.toLowerCase()}`,
      entity: { type: 'AsaasNotification', id: input.asaasCustomerId },
      correlationId: input.correlationId,
      metadata: {
        status: input.status,
        channels: normalizedChannels(input.channels),
        externalReference: input.externalReference,
        outboxId: input.outboxId,
        reason: input.reason,
        warningsCount: input.warningsCount ?? 0,
      },
    });
  } catch (error) {
    // Auditoria nunca deve esconder o erro financeiro original, mas a falha
    // fica visível no log para não transformar o registro em best-effort mudo.
    console.error('[notification-sync] Falha ao persistir auditoria', {
      contaId: input.contaId,
      customerId: input.asaasCustomerId,
      status: input.status,
      error: safeErrorMessage(error),
    });
    return null;
  }
}

export async function enqueueAsaasNotificationSync(input: EnqueueAsaasNotificationSyncInput) {
  const channels = normalizedChannels(input.channels);
  const key = dedupeKey(input, channels);
  const delegate = prisma.asaasNotificationSyncOutbox;
  const existing = await delegate.findUnique({
    where: {
      uq_asaas_notification_sync_conta_dedupe: {
        contaId: input.contaId,
        dedupeKey: key,
      },
    },
  });

  if (existing) return existing;

  try {
    return await delegate.create({
      data: {
        contaId: input.contaId,
        asaasCustomerId: input.asaasCustomerId,
        dedupeKey: key,
        requestedChannels: channels,
        externalReference: input.externalReference ?? null,
        correlationId: input.correlationId ?? null,
        reason: input.reason ?? null,
      },
    });
  } catch (error) {
    // A retry concorrente pode criar o mesmo item entre findUnique/create.
    if (!isUniqueViolation(error)) throw error;
    return delegate.findUniqueOrThrow({
      where: {
        uq_asaas_notification_sync_conta_dedupe: {
          contaId: input.contaId,
          dedupeKey: key,
        },
      },
    });
  }
}

function parseChannels(value: unknown): NotificationSyncChannel[] {
  if (!Array.isArray(value)) return [];
  return normalizedChannels(
    value.filter((channel): channel is NotificationSyncChannel =>
      NOTIFICATION_SYNC_CHANNELS.includes(channel as NotificationSyncChannel),
    ),
  );
}

export async function processAsaasNotificationSyncOutbox(
  input: ProcessAsaasNotificationSyncOutboxInput = {},
): Promise<ProcessAsaasNotificationSyncOutboxResult> {
  const limit = clampInt(input.limit, 25, 1, 100);
  const processingTimeoutMinutes = clampInt(input.processingTimeoutMinutes, 15, 1, 120);
  const maxAttempts = clampInt(input.maxAttempts, 8, 1, 20);
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - processingTimeoutMinutes * 60_000);
  const rows = await prisma.asaasNotificationSyncOutbox.findMany({
    where: {
      contaId: input.contaId,
      attempts: { lt: maxAttempts },
      OR: [
        { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', processingAt: { lt: staleProcessingBefore } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });

  const result: ProcessAsaasNotificationSyncOutboxResult = {
    scanned: rows.length,
    processed: 0,
    partial: 0,
    failed: 0,
    exhausted: 0,
    errors: [],
  };

  for (const row of rows) {
    const attemptLimit = row.maxAttempts ?? maxAttempts;
    const claimed = await prisma.asaasNotificationSyncOutbox.updateMany({
      where: { id: row.id, status: row.status, attempts: { lt: attemptLimit } },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) continue;

    const attempts = row.attempts + 1;
    const channels = parseChannels(row.requestedChannels);
    await recordNotificationSyncAudit({
      contaId: row.contaId,
      asaasCustomerId: row.asaasCustomerId,
      status: 'STARTED',
      channels,
      externalReference: row.externalReference ?? undefined,
      correlationId: row.correlationId ?? undefined,
      outboxId: row.id,
      reason: row.reason ?? undefined,
    });

    try {
      // Com zero canais selecionados, preservar o opt-out global do customer é
      // intencional. A habilitação global só é necessária quando há ao menos
      // um canal que precisa receber PAYMENT_CREATED.
      if (channels.length > 0) {
        const enabled = await ensureCustomerNotificationsEnabled(row.contaId, row.asaasCustomerId);
        if (!enabled.success) throw new Error(enabled.reason ?? 'Customer com notificações bloqueadas');
      }

      const sync = await syncCustomerNotificationsForUserSelection(
        row.contaId,
        row.asaasCustomerId,
        channelPreferencesFromWizardSelection(channels),
      );
      if (!sync.success) throw new Error('Preferências de notificação não foram aplicadas');

      await prisma.asaasNotificationSyncOutbox.update({
        where: { id: row.id },
        data: {
          status: 'DONE',
          processingAt: null,
          processedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
      });

      const auditStatus = sync.warnings.length > 0 ? 'PARTIAL' : 'SUCCESS';
      await recordNotificationSyncAudit({
        contaId: row.contaId,
        asaasCustomerId: row.asaasCustomerId,
        status: auditStatus,
        channels,
        externalReference: row.externalReference ?? undefined,
        correlationId: row.correlationId ?? undefined,
        outboxId: row.id,
        reason: row.reason ?? undefined,
        warningsCount: sync.warnings.length,
      });
      result.processed += 1;
      if (sync.warnings.length > 0) result.partial += 1;
    } catch (error) {
      const message = safeErrorMessage(error);
      const exhausted = attempts >= attemptLimit;
      await prisma.asaasNotificationSyncOutbox.update({
        where: { id: row.id },
        data: {
          status: exhausted ? 'EXHAUSTED' : 'FAILED',
          processingAt: null,
          ...(exhausted ? {} : { nextAttemptAt: nextAttemptDate(attempts) }),
          lastError: message,
          lastErrorAt: new Date(),
        },
      });
      await recordNotificationSyncAudit({
        contaId: row.contaId,
        asaasCustomerId: row.asaasCustomerId,
        status: exhausted ? 'EXHAUSTED' : 'FAILED',
        channels,
        externalReference: row.externalReference ?? undefined,
        correlationId: row.correlationId ?? undefined,
        outboxId: row.id,
        reason: message,
      });
      result.failed += 1;
      if (exhausted) result.exhausted += 1;
      result.errors.push({
        id: row.id,
        contaId: row.contaId,
        asaasCustomerId: row.asaasCustomerId,
        message,
      });
    }
  }

  return result;
}
