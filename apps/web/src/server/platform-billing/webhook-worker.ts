import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { StripeWebhookEvent } from '@alusa/stripe';
import {
  PlatformBillingError,
  classifyPlatformBillingWebhookError,
  computePlatformBillingWebhookNextAttemptAt,
  createPrismaPlatformBillingStore,
  hasExhaustedPlatformBillingWebhookAttempts,
  processPersistedPlatformBillingWebhookEvent,
} from '@alusa/platform-billing';
import type { PlatformBillingEnvironment } from '@alusa/platform-billing';
import { resolvePlatformBillingEnvironment } from './platform-billing-server';
import { notifyPlatformBillingEvent } from './platform-billing-notifications';

type ClaimedStripeWebhookEvent = {
  id: string;
  eventId: string;
  eventType: string;
  contaId: string | null;
  attempts: number;
  payload: unknown;
};

export type DrainStripeWebhookWorkerResult = {
  workerId: string;
  claimed: number;
  processed: number;
  failed: number;
  exhausted: number;
  ignored: number;
};

const DEFAULT_BATCH_LIMIT = 25;
const PROCESSING_TIMEOUT_MS = 2 * 60_000;

export async function drainStripeWebhookWorker(input: {
  prisma: PrismaClient;
  limit?: number;
  workerId?: string;
  environment?: PlatformBillingEnvironment;
}): Promise<DrainStripeWebhookWorkerResult> {
  const workerId = input.workerId ?? `stripe-worker-${randomUUID()}`;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_BATCH_LIMIT, 100));
  await recoverTimedOutStripeWebhookEvents(input.prisma, {
    environment,
  });

  const claimed = await claimStripeWebhookEvents(input.prisma, {
    environment,
    limit,
    workerId,
  });

  const result: DrainStripeWebhookWorkerResult = {
    workerId,
    claimed: claimed.length,
    processed: 0,
    failed: 0,
    exhausted: 0,
    ignored: 0,
  };

  const store = createPrismaPlatformBillingStore(input.prisma);

  for (const event of orderStripeWebhookEventsForProcessing(claimed)) {
    try {
      const processed = await processPersistedPlatformBillingWebhookEvent(
        {
          event: event.payload as StripeWebhookEvent,
          environment,
          envSource: process.env,
          inboxId: event.id,
        },
        store,
      );

      if (processed.status === 'ignored') {
        result.ignored += 1;
      } else {
        result.processed += 1;
        await notifyPlatformBillingEvent({
          contaId: processed.contaId,
          eventId: event.eventId,
          eventType: event.eventType,
        }).catch((notificationError) => {
          logStripeWebhookWorker('webhook_notification_failed', {
            workerId,
            eventId: event.eventId,
            eventType: event.eventType,
            contaId: processed.contaId,
            error: notificationError instanceof Error
              ? notificationError.message.slice(0, 300)
              : String(notificationError).slice(0, 300),
          });
        });
      }

      logStripeWebhookWorker('webhook_processed', {
        workerId,
        eventId: event.eventId,
        eventType: event.eventType,
        contaId: processed.contaId,
      });
    } catch (error) {
      const failureKind = classifyPlatformBillingWebhookError(error);
      const attempts = event.attempts;
      const exhausted = failureKind === 'PERMANENT' ||
        hasExhaustedPlatformBillingWebhookAttempts({ attempts });
      const nextAttemptAt = exhausted
        ? undefined
        : computePlatformBillingWebhookNextAttemptAt({ attempts });
      const sanitizedError = sanitizeWebhookWorkerError(error);

      await store.markWebhookEventFailed({
        id: event.id,
        contaId: event.contaId ?? undefined,
        error: sanitizedError.message,
        errorCode: sanitizedError.code,
        nextAttemptAt,
        exhausted,
      });

      if (exhausted) {
        result.exhausted += 1;
      } else {
        result.failed += 1;
      }

      logStripeWebhookWorker(exhausted ? 'webhook_exhausted' : 'webhook_retry_scheduled', {
        workerId,
        eventId: event.eventId,
        eventType: event.eventType,
        contaId: event.contaId,
        attempts,
        failureKind,
        errorCode: sanitizedError.code,
      });
    }
  }

  return result;
}

function orderStripeWebhookEventsForProcessing(events: ClaimedStripeWebhookEvent[]): ClaimedStripeWebhookEvent[] {
  return [...events].sort((left, right) => {
    const priorityDiff = getStripeWebhookEventPriority(left.eventType) - getStripeWebhookEventPriority(right.eventType);
    if (priorityDiff !== 0) return priorityDiff;
    return left.eventId.localeCompare(right.eventId);
  });
}

function getStripeWebhookEventPriority(eventType: string): number {
  if (eventType === 'checkout.session.completed') return 10;
  if (eventType.startsWith('customer.subscription.')) return 20;
  if (eventType.startsWith('invoice.')) return 30;
  return 100;
}

export async function replayStripeWebhookEvents(input: {
  prisma: PrismaClient;
  ids: string[];
  actorUserId: string;
  reason: string;
  environment?: PlatformBillingEnvironment;
}): Promise<{ replayed: number }> {
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return { replayed: 0 };

  const updated = await input.prisma.platformBillingWebhookEvent.updateMany({
    where: {
      id: { in: ids },
      environment,
      status: { in: ['FAILED', 'EXHAUSTED'] },
    },
    data: {
      status: 'PENDING',
      lockedAt: null,
      processingTimeoutAt: null,
      exhaustedAt: null,
      workerId: null,
      lastError: null,
      lastErrorCode: null,
    },
  });

  if (updated.count > 0) {
    await input.prisma.$executeRaw`
      UPDATE "PlatformBillingWebhookEvent"
      SET
        "nextAttemptAt" = LOCALTIMESTAMP,
        "updatedAt" = LOCALTIMESTAMP
      WHERE "id" IN (${Prisma.join(ids)})
        AND "environment" = ${environment}::"PlatformBillingEnvironment"
    `;
  }

  const events = await input.prisma.platformBillingWebhookEvent.findMany({
    where: { id: { in: ids }, environment },
    select: { id: true, contaId: true, eventId: true, eventType: true },
  });

  for (const event of events) {
    if (!event.contaId) continue;
    await input.prisma.platformBillingAuditLog.create({
      data: {
        contaId: event.contaId,
        actorUserId: input.actorUserId,
        action: 'PLATFORM_BILLING_WEBHOOK_REPLAY_REQUESTED',
        entityType: 'PlatformBillingWebhookEvent',
        entityId: event.id,
        correlationId: event.eventId,
        metadata: {
          reason: input.reason,
          eventType: event.eventType,
        },
      },
    });
  }

  logStripeWebhookWorker('webhook_replay_requested', {
    actorUserId: input.actorUserId,
    reason: input.reason,
    count: updated.count,
  });

  return { replayed: updated.count };
}

async function recoverTimedOutStripeWebhookEvents(
  prisma: PrismaClient,
  input: { environment: PlatformBillingEnvironment },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "PlatformBillingWebhookEvent"
    SET
      "status" = 'FAILED',
      "lockedAt" = NULL,
      "workerId" = NULL,
      "nextAttemptAt" = LOCALTIMESTAMP,
      "lastError" = 'Processing timeout expired before worker completion.',
      "lastErrorCode" = 'PROCESSING_TIMEOUT',
      "updatedAt" = LOCALTIMESTAMP
    WHERE "environment" = ${input.environment}::"PlatformBillingEnvironment"
      AND "status" = 'PROCESSING'
      AND "processingTimeoutAt" <= LOCALTIMESTAMP
  `;
}

async function claimStripeWebhookEvents(
  prisma: PrismaClient,
  input: {
    environment: PlatformBillingEnvironment;
    limit: number;
    workerId: string;
  },
): Promise<ClaimedStripeWebhookEvent[]> {
  return prisma.$transaction(async (tx) => {
    return tx.$queryRaw<ClaimedStripeWebhookEvent[]>`
      UPDATE "PlatformBillingWebhookEvent"
      SET
        "status" = 'PROCESSING',
        "attempts" = "attempts" + 1,
        "lockedAt" = LOCALTIMESTAMP,
        "lastAttemptAt" = LOCALTIMESTAMP,
        "processingTimeoutAt" = LOCALTIMESTAMP + (${PROCESSING_TIMEOUT_MS}::text || ' milliseconds')::interval,
        "workerId" = ${input.workerId},
        "updatedAt" = LOCALTIMESTAMP
      WHERE "id" IN (
        SELECT "id"
        FROM "PlatformBillingWebhookEvent"
        WHERE "environment" = ${input.environment}::"PlatformBillingEnvironment"
          AND "status" IN ('PENDING', 'RECEIVED', 'FAILED')
          AND "nextAttemptAt" <= LOCALTIMESTAMP
        ORDER BY "receivedAt" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        "id",
        "eventId",
        "eventType",
        "contaId",
        "attempts",
        "payload"
    `;
  });
}

function sanitizeWebhookWorkerError(error: unknown): { code: string; message: string } {
  if (error instanceof PlatformBillingError) {
    return {
      code: error.code,
      message: error.message.slice(0, 1000),
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED_ERROR',
      message: error.message.slice(0, 1000),
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: String(error).slice(0, 1000),
  };
}

function logStripeWebhookWorker(event: string, metadata: Record<string, unknown>): void {
  console.info('[platform-billing][stripe-webhook-worker]', {
    event,
    ...metadata,
  });
}
