import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import {
  createBillingWebhookNotification,
  type BillingNotificationEventInput,
} from '../services/notifications.service';

export const PENDING_INBOX_KIND_BILLING_WEBHOOK = 'BILLING_WEBHOOK';

export type PendingBillingWebhookPayload = {
  eventId?: string | null;
  eventName: BillingNotificationEventInput;
  asaasPaymentId: string;
  occurredAt?: string | null;
  sourceType?: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
};

function buildPendingDedupeKey(asaasPaymentId: string, eventName: string): string {
  return `pending:billing:${eventName}:${asaasPaymentId}`;
}

export async function enqueuePendingBillingWebhookNotification(
  params: PendingBillingWebhookPayload,
): Promise<void> {
  const dedupeKey = buildPendingDedupeKey(params.asaasPaymentId, params.eventName);

  try {
    await prisma.pendingInboxNotification.upsert({
      where: { dedupeKey },
      create: {
        contaId: null,
        kind: PENDING_INBOX_KIND_BILLING_WEBHOOK,
        payload: params,
        dedupeKey,
        status: 'PENDING',
        nextRetryAt: new Date(Date.now() + 60_000),
      },
      update: {
        payload: params,
        status: 'PENDING',
        nextRetryAt: new Date(Date.now() + 60_000),
        lastError: null,
      },
    });
    logInboxMetric('inbox.pending.enqueued', {
      dedupeKey,
      asaasPaymentId: params.asaasPaymentId,
      eventName: params.eventName,
    });
  } catch (error) {
    console.warn('[Notifications] Falha ao enfileirar pending inbox', {
      dedupeKey,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function computeNextRetry(attempts: number): Date {
  const delayMinutes = Math.min(60, Math.pow(2, attempts));
  return new Date(Date.now() + delayMinutes * 60_000);
}

export async function processPendingInboxNotifications(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ attempted: number; processed: number; failed: number }> {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
  const now = new Date();

  const pending = await prisma.pendingInboxNotification.findMany({
    where: {
      status: 'PENDING',
      nextRetryAt: { lte: now },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  let failed = 0;

  for (const row of pending) {
    const attempts = row.attempts + 1;

    if (row.kind !== PENDING_INBOX_KIND_BILLING_WEBHOOK) {
      await prisma.pendingInboxNotification.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          attempts,
          lastError: `Kind não suportado: ${row.kind}`,
          processedAt: new Date(),
        },
      });
      failed += 1;
      continue;
    }

    const payload = row.payload as PendingBillingWebhookPayload;

    try {
      const result = await createBillingWebhookNotification({
        eventId: payload.eventId ?? null,
        eventName: payload.eventName,
        asaasPaymentId: payload.asaasPaymentId,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
        sourceType: payload.sourceType ?? 'ASAAS_WEBHOOK',
      });

      if (result.notificationId) {
        await prisma.pendingInboxNotification.update({
          where: { id: row.id },
          data: {
            status: 'DONE',
            attempts,
            processedAt: new Date(),
            lastError: null,
          },
        });
        processed += 1;
        logInboxMetric('inbox.pending.processed', {
          dedupeKey: row.dedupeKey,
          notificationId: result.notificationId,
        });
        continue;
      }

      if (attempts >= row.maxAttempts) {
        await prisma.pendingInboxNotification.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            attempts,
            lastError: 'Entidade local não encontrada após tentativas máximas',
            processedAt: new Date(),
          },
        });
        failed += 1;
        logInboxMetric('inbox.pending.failed', { dedupeKey: row.dedupeKey, attempts });
      } else {
        await prisma.pendingInboxNotification.update({
          where: { id: row.id },
          data: {
            attempts,
            nextRetryAt: computeNextRetry(attempts),
            lastError: 'Entidade local ainda não disponível',
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempts >= row.maxAttempts) {
        await prisma.pendingInboxNotification.update({
          where: { id: row.id },
          data: { status: 'FAILED', attempts, lastError: message, processedAt: new Date() },
        });
        failed += 1;
      } else {
        await prisma.pendingInboxNotification.update({
          where: { id: row.id },
          data: { attempts, nextRetryAt: computeNextRetry(attempts), lastError: message },
        });
      }
    }
  }

  return { attempted: pending.length, processed, failed };
}
