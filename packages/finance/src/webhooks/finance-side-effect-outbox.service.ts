import { prisma } from '@alusa/database';
import { FinanceWebhookSideEffectStatus } from '@prisma/client';
import type { BillingNotificationCandidate } from '@alusa/lib';
import { emitBillingNotifications } from '@alusa/lib';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;

export type FinanceSideEffectType = 'BILLING_NOTIFICATION';

export interface EnqueueBillingNotificationSideEffectsParams {
  contaId: string;
  candidates: BillingNotificationCandidate[];
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
  webhookBatchId?: string;
}

function buildDedupeKey(params: {
  contaId: string;
  effectType: FinanceSideEffectType;
  candidate: BillingNotificationCandidate;
  sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
}): string {
  const eventKey = params.candidate.eventId?.trim() || `${params.candidate.event}:${params.candidate.asaasPaymentId}`;
  return `${params.contaId}:${params.effectType}:${params.sourceType}:${eventKey}`;
}

export async function enqueueBillingNotificationSideEffects(
  params: EnqueueBillingNotificationSideEffectsParams,
): Promise<{ enqueued: number; skipped: number }> {
  if (!params.candidates.length) {
    return { enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;

  for (const candidate of params.candidates) {
    const dedupeKey = buildDedupeKey({
      contaId: params.contaId,
      effectType: 'BILLING_NOTIFICATION',
      candidate,
      sourceType: params.sourceType,
    });

    try {
      await prisma.financeWebhookSideEffectOutbox.create({
        data: {
          contaId: params.contaId,
          effectType: 'BILLING_NOTIFICATION',
          dedupeKey,
          payload: {
            candidate,
            sourceType: params.sourceType,
            webhookBatchId: params.webhookBatchId ?? null,
          },
          status: FinanceWebhookSideEffectStatus.PENDING,
        },
      });
      enqueued += 1;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return { enqueued, skipped };
}

export async function processFinanceWebhookSideEffectOutboxEvent(
  eventId: string,
): Promise<{ processed: boolean; reason?: string }> {
  const event = await prisma.financeWebhookSideEffectOutbox.findUnique({
    where: { id: eventId },
  });

  if (!event || event.status === FinanceWebhookSideEffectStatus.PROCESSED) {
    return { processed: false, reason: 'not_found_or_done' };
  }

  const claimed = await prisma.financeWebhookSideEffectOutbox.updateMany({
    where: {
      id: eventId,
      status: { in: [FinanceWebhookSideEffectStatus.PENDING, FinanceWebhookSideEffectStatus.FAILED] },
      availableAt: { lte: new Date() },
    },
    data: {
      status: FinanceWebhookSideEffectStatus.PROCESSING,
      lockedAt: new Date(),
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return { processed: false, reason: 'not_claimed' };
  }

  try {
    if (event.effectType === 'BILLING_NOTIFICATION') {
      const payload = event.payload as {
        candidate: BillingNotificationCandidate;
        sourceType: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
      };
      await emitBillingNotifications([payload.candidate], payload.sourceType);
    }

    await prisma.financeWebhookSideEffectOutbox.update({
      where: { id: eventId },
      data: {
        status: FinanceWebhookSideEffectStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });

    return { processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = event.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;

    await prisma.financeWebhookSideEffectOutbox.update({
      where: { id: eventId },
      data: {
        status: exhausted
          ? FinanceWebhookSideEffectStatus.FAILED
          : FinanceWebhookSideEffectStatus.PENDING,
        lockedAt: null,
        lastError: message,
        availableAt: exhausted ? event.availableAt : new Date(Date.now() + RETRY_DELAY_MS),
      },
    });

    return { processed: false, reason: message };
  }
}

export async function drainFinanceWebhookSideEffectOutbox(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ attempted: number; processed: number; failed: number }> {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));

  const events = await prisma.financeWebhookSideEffectOutbox.findMany({
    where: {
      status: { in: [FinanceWebhookSideEffectStatus.PENDING, FinanceWebhookSideEffectStatus.FAILED] },
      availableAt: { lte: new Date() },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { availableAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    const result = await processFinanceWebhookSideEffectOutboxEvent(event.id);
    if (result.processed) {
      processed += 1;
    } else if (result.reason && result.reason !== 'not_found_or_done' && result.reason !== 'not_claimed') {
      failed += 1;
    }
  }

  return {
    attempted: events.length,
    processed,
    failed,
  };
}
