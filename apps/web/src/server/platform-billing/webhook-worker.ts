import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/prisma';
import {
  getStripeClient,
  retrieveStripeInvoiceEventObject,
  retrieveStripeSubscriptionEventObject,
  type StripeWebhookEvent,
} from '@alusa/stripe';
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
import {
  logApiOperationalEvent,
  type ApiOperationalEventName,
} from '@/lib/observability/api-logger';

type ClaimedStripeWebhookEvent = {
  id: string;
  eventId: string;
  eventType: string;
  contaId: string | null;
  attempts: number;
  payload: unknown;
};

type ClaimedBillingNotification = {
  id: string;
  eventId: string;
  eventType: string;
  contaId: string | null;
  attempts: number;
};

export type DrainStripeWebhookWorkerResult = {
  workerId: string;
  claimed: number;
  processed: number;
  failed: number;
  exhausted: number;
  ignored: number;
  notifications: { claimed: number; delivered: number; failed: number; exhausted: number };
};

export type ListStripeWebhookEventsInput = {
  contaId: string;
  environment: PlatformBillingEnvironment;
  status: Array<'FAILED' | 'EXHAUSTED' | 'PENDING' | 'PROCESSING'>;
  limit: number;
};

export type ListedStripeWebhookEvent = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  receivedAt: Date;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  lastError: string | null;
  lastErrorCode: string | null;
  exhaustedAt: Date | null;
  correlationId: string | null;
};

export type ListedBillingNotification = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  createdAt: Date;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
  lastError: string | null;
};

const DEFAULT_BATCH_LIMIT = 25;
const PROCESSING_TIMEOUT_MS = 2 * 60_000;
const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 8;

export async function drainStripeWebhookWorker(input: {
  prisma?: PrismaClient;
  limit?: number;
  workerId?: string;
  environment?: PlatformBillingEnvironment;
  eventIds?: string[];
}): Promise<DrainStripeWebhookWorkerResult> {
  const db = input.prisma ?? defaultPrisma;
  const workerId = input.workerId ?? `stripe-worker-${randomUUID()}`;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_BATCH_LIMIT, 100));
  await recoverTimedOutStripeWebhookEvents(db, {
    environment,
    eventIds: input.eventIds,
  });

  const claimed = await claimStripeWebhookEvents(db, {
    environment,
    limit,
    workerId,
    eventIds: input.eventIds,
  });

  const result: DrainStripeWebhookWorkerResult = {
    workerId,
    claimed: claimed.length,
    processed: 0,
    failed: 0,
    exhausted: 0,
    ignored: 0,
    notifications: { claimed: 0, delivered: 0, failed: 0, exhausted: 0 },
  };

  const store = createPrismaPlatformBillingStore(db);

  for (const event of orderStripeWebhookEventsForProcessing(claimed)) {
    try {
      const canonicalEvent = await retrieveCanonicalStripeEvent(event.payload as StripeWebhookEvent);
      const processed = await processPersistedPlatformBillingWebhookEvent(
        {
          event: canonicalEvent,
          environment,
          envSource: process.env,
          workerId,
          inboxId: event.id,
          deferFinalize: true,
        },
        store,
      );

      if (processed.status === 'ignored') {
        result.ignored += 1;
      } else {
        result.processed += 1;
        await db.platformBillingNotificationOutbox.upsert({
          where: { uq_platform_billing_notification_env_event: { environment, eventId: event.eventId } },
          create: {
            environment,
            eventId: event.eventId,
            eventType: resolveCanonicalNotificationEventType(event.eventType, canonicalEvent),
            contaId: processed.contaId,
          },
          update: {},
        });
        await store.markWebhookEventProcessed({
          id: event.id,
          contaId: processed.contaId ?? undefined,
          workerId,
        });
      }
    } catch (error) {
      const failureKind = classifyPlatformBillingWebhookError(error);
      const attempts = event.attempts;
      const exhausted =
        failureKind === 'PERMANENT' || hasExhaustedPlatformBillingWebhookAttempts({ attempts });
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
        workerId,
      });

      if (exhausted) {
        result.exhausted += 1;
      } else {
        result.failed += 1;
      }

      logStripeWebhookWorker(exhausted ? 'webhook_exhausted' : 'webhook_retry_scheduled', {
        error,
      });
    }
  }

  result.notifications = await drainPlatformBillingNotificationOutbox({ prisma: db, limit, eventIds: input.eventIds });

  return result;
}

export async function drainPlatformBillingNotificationOutbox(input: {
  prisma?: PrismaClient;
  limit?: number;
  workerId?: string;
  environment?: PlatformBillingEnvironment;
  eventIds?: string[];
}): Promise<{ claimed: number; delivered: number; failed: number; exhausted: number }> {
  const db = input.prisma ?? defaultPrisma;
  const workerId = input.workerId ?? `stripe-notify-${randomUUID()}`;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_BATCH_LIMIT, 100));
  const eventIds = input.eventIds === undefined ? null : input.eventIds;
  const records = await db.$transaction((tx) => tx.$queryRaw<ClaimedBillingNotification[]>`
    UPDATE "PlatformBillingNotificationOutbox"
    SET "status" = 'PROCESSING', "workerId" = ${workerId}, "lockedAt" = LOCALTIMESTAMP,
        "attempts" = "attempts" + 1, "updatedAt" = LOCALTIMESTAMP
    WHERE "id" IN (
      SELECT "id" FROM "PlatformBillingNotificationOutbox"
      WHERE "environment" = ${environment}::"PlatformBillingEnvironment"
        AND (${eventIds}::text[] IS NULL OR "eventId" = ANY(${eventIds}::text[]))
        AND (("status" = 'PENDING')
          OR ("status" = 'FAILED' AND "nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          OR ("status" = 'PROCESSING' AND "lockedAt" < LOCALTIMESTAMP - INTERVAL '2 minutes'))
      ORDER BY "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING "id", "eventId", "eventType", "contaId", "attempts"
  `);
  let delivered = 0;
  let failed = 0;
  let exhausted = 0;
  for (const record of records) {
    try {
      await notifyPlatformBillingEvent({
        contaId: record.contaId,
        eventId: record.eventId,
        eventType: record.eventType,
        environment,
      });
      const update = await db.platformBillingNotificationOutbox.updateMany({
        where: { id: record.id, status: 'PROCESSING', workerId },
        data: { status: 'DELIVERED', deliveredAt: new Date(), lockedAt: null, workerId: null, lastError: null },
      });
      if (update.count === 1) delivered += 1;
    } catch (error) {
      const delay = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(record.attempts - 1, 7));
      await db.platformBillingNotificationOutbox.updateMany({
        where: { id: record.id, status: 'PROCESSING', workerId },
        data: record.attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS
          ? { status: 'EXHAUSTED', lockedAt: null, workerId: null, lastError: sanitizeWebhookWorkerError(error).message }
          : { status: 'FAILED', nextAttemptAt: new Date(Date.now() + delay), lockedAt: null, workerId: null, lastError: sanitizeWebhookWorkerError(error).message },
      });
      if (record.attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS) {
        exhausted += 1;
        logStripeWebhookWorker('notification_exhausted', { error });
      } else {
        failed += 1;
        logStripeWebhookWorker('notification_retry_scheduled', { error });
      }
    }
  }
  return { claimed: records.length, delivered, failed, exhausted };
}

export function resolveCanonicalNotificationEventType(
  receivedEventType: string,
  canonicalEvent: StripeWebhookEvent,
): string {
  if (receivedEventType === 'invoice.payment_failed') {
    const invoice = canonicalEvent.data.object as unknown as Record<string, unknown>;
    if (invoice.status === 'paid' || invoice.paid === true) return 'invoice.paid';
  }
  return receivedEventType;
}

async function retrieveCanonicalStripeEvent(event: StripeWebhookEvent): Promise<StripeWebhookEvent> {
  const raw = event.data.object as unknown as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return event;

  const client = getStripeClient(process.env);
  try {
    let canonical: Record<string, unknown> | null = null;
    if (event.type.startsWith('customer.subscription.')) {
      canonical = await retrieveStripeSubscriptionEventObject(client, id);
    } else if (event.type.startsWith('invoice.')) {
      canonical = await retrieveStripeInvoiceEventObject(client, id);
    }
    if (!canonical) return event;
    return {
      ...event,
      data: { ...event.data, object: canonical as never },
    } as unknown as StripeWebhookEvent;
  } catch (error) {
    // A deleted subscription may no longer be retrievable; the signed deleted
    // event itself is then the provider's terminal snapshot. Other retrieval
    // failures retry the inbox event instead of applying stale event data.
    const statusCode = error && typeof error === 'object' && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : null;
    if (event.type === 'customer.subscription.deleted' && statusCode === 404) return event;
    throw error;
  }
}

export async function listStripeWebhookEvents(
  input: ListStripeWebhookEventsInput,
): Promise<ListedStripeWebhookEvent[]> {
  const db = defaultPrisma;
  return db.platformBillingWebhookEvent.findMany({
    where: {
      contaId: input.contaId,
      environment: input.environment,
      status: { in: input.status },
    },
    orderBy: [{ receivedAt: 'desc' }],
    take: Math.max(1, Math.min(input.limit, 100)),
    select: {
      id: true,
      eventId: true,
      eventType: true,
      status: true,
      attempts: true,
      receivedAt: true,
      lastAttemptAt: true,
      nextAttemptAt: true,
      lastError: true,
      lastErrorCode: true,
      exhaustedAt: true,
      correlationId: true,
    },
  });
}

export async function listPlatformBillingNotificationOutbox(input: {
  contaId: string;
  environment: PlatformBillingEnvironment;
  limit: number;
}): Promise<ListedBillingNotification[]> {
  return defaultPrisma.platformBillingNotificationOutbox.findMany({
    where: { contaId: input.contaId, environment: input.environment, status: { in: ['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING'] } },
    orderBy: [{ createdAt: 'desc' }],
    take: Math.max(1, Math.min(input.limit, 100)),
    select: { id: true, eventId: true, eventType: true, status: true, attempts: true, createdAt: true, nextAttemptAt: true, deliveredAt: true, lastError: true },
  });
}

export async function replayPlatformBillingNotifications(input: {
  prisma?: PrismaClient;
  ids: string[];
  contaId: string;
  actorUserId: string;
  reason: string;
  environment?: PlatformBillingEnvironment;
}): Promise<{ replayed: number }> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) return { replayed: 0 };
  const updated = await db.platformBillingNotificationOutbox.updateMany({
    where: { id: { in: ids }, contaId: input.contaId, environment, status: 'EXHAUSTED' },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedAt: null, workerId: null, lastError: null, deliveredAt: null },
  });
  if (updated.count) {
    const records = await db.platformBillingNotificationOutbox.findMany({
      where: { id: { in: ids }, contaId: input.contaId, environment, status: 'PENDING' },
      select: { id: true, eventId: true, eventType: true },
    });
    await db.platformBillingAuditLog.createMany({
      data: records.map((record) => ({
        contaId: input.contaId,
        actorUserId: input.actorUserId,
        action: 'PLATFORM_BILLING_NOTIFICATION_REPLAY_REQUESTED',
        entityType: 'PlatformBillingNotificationOutbox',
        entityId: record.id,
        correlationId: record.eventId,
        metadata: { reason: input.reason, eventType: record.eventType },
      })),
      skipDuplicates: true,
    });
  }
  return { replayed: updated.count };
}

function orderStripeWebhookEventsForProcessing(
  events: ClaimedStripeWebhookEvent[],
): ClaimedStripeWebhookEvent[] {
  return [...events].sort((left, right) => {
    const priorityDiff =
      getStripeWebhookEventPriority(left.eventType) -
      getStripeWebhookEventPriority(right.eventType);
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
  prisma?: PrismaClient;
  ids: string[];
  contaId?: string;
  actorUserId: string;
  reason: string;
  environment?: PlatformBillingEnvironment;
}): Promise<{ replayed: number }> {
  const db = input.prisma ?? defaultPrisma;
  const environment = input.environment ?? resolvePlatformBillingEnvironment();
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return { replayed: 0 };

  const updated = await db.platformBillingWebhookEvent.updateMany({
    where: {
      id: { in: ids },
      ...(input.contaId ? { contaId: input.contaId } : {}),
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
      nextAttemptAt: new Date(),
    },
  });

  const events = await db.platformBillingWebhookEvent.findMany({
    where: { id: { in: ids }, ...(input.contaId ? { contaId: input.contaId } : {}), environment },
    select: { id: true, contaId: true, eventId: true, eventType: true },
  });

  for (const event of events) {
    if (!event.contaId) continue;
    await db.platformBillingAuditLog.create({
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

  logStripeWebhookWorker('webhook_replay_requested', { count: updated.count });

  return { replayed: updated.count };
}

async function recoverTimedOutStripeWebhookEvents(
  prisma: PrismaClient,
  input: { environment: PlatformBillingEnvironment; eventIds?: string[] },
): Promise<void> {
  const eventIds = input.eventIds === undefined ? null : input.eventIds;
  await prisma.$executeRaw`
    UPDATE "PlatformBillingWebhookEvent"
    SET
      "status" = 'FAILED',
      "lockedAt" = NULL,
      "workerId" = NULL,
      "nextAttemptAt" = LOCALTIMESTAMP - INTERVAL '1 millisecond',
      "lastError" = 'Processing timeout expired before worker completion.',
      "lastErrorCode" = 'PROCESSING_TIMEOUT',
      "updatedAt" = LOCALTIMESTAMP
    WHERE "environment" = ${input.environment}::"PlatformBillingEnvironment"
      AND (${eventIds}::text[] IS NULL OR "eventId" = ANY(${eventIds}::text[]))
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
    eventIds?: string[];
  },
): Promise<ClaimedStripeWebhookEvent[]> {
  const eventIds = input.eventIds === undefined ? null : input.eventIds;
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
          AND (${eventIds}::text[] IS NULL OR "eventId" = ANY(${eventIds}::text[]))
          AND "status" IN ('PENDING', 'RECEIVED', 'FAILED')
          AND "nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
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
    const causeCode = safeWebhookFailureCauseCode(error.details?.cause);
    return {
      code: error.code,
      message: `${error.message}${causeCode ? ` [cause=${causeCode}]` : ''}`.slice(0, 1000),
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

function safeWebhookFailureCauseCode(cause: unknown): string | null {
  if (typeof cause !== 'string') return null;
  if (cause.includes('Stripe account snapshot changed before subscription state could be applied')) {
    return 'ACCOUNT_SNAPSHOT_CAS_CONFLICT';
  }
  if (cause.includes('Stripe webhook lease was lost')) return 'WEBHOOK_LEASE_LOST';
  if (cause.includes('Foreign key constraint')) return 'FOREIGN_KEY_CONSTRAINT';
  if (cause.includes('Unique constraint')) return 'UNIQUE_CONSTRAINT';
  return 'UNCLASSIFIED';
}

type StripeWebhookWorkerLogEvent =
  | 'webhook_notification_failed'
  | 'webhook_exhausted'
  | 'webhook_retry_scheduled'
  | 'webhook_replay_requested'
  | 'notification_exhausted'
  | 'notification_retry_scheduled';

const STRIPE_WEBHOOK_WORKER_EVENT_NAMES: Record<
  StripeWebhookWorkerLogEvent,
  ApiOperationalEventName
> = {
  webhook_notification_failed: 'api.platform_billing.stripe_webhook.worker.notification_failed',
  webhook_exhausted: 'api.platform_billing.stripe_webhook.worker.exhausted',
  webhook_retry_scheduled: 'api.platform_billing.stripe_webhook.worker.retry_scheduled',
  webhook_replay_requested: 'api.platform_billing.stripe_webhook.worker.replay_requested',
  notification_exhausted: 'api.platform_billing.stripe_webhook.worker.exhausted',
  notification_retry_scheduled: 'api.platform_billing.stripe_webhook.worker.retry_scheduled',
};

function logStripeWebhookWorker(
  event: StripeWebhookWorkerLogEvent,
  fields: { error?: unknown; count?: number },
): void {
  const eventName = STRIPE_WEBHOOK_WORKER_EVENT_NAMES[event];

  logApiOperationalEvent({
    severity: event === 'webhook_replay_requested' ? 'info' : 'warn',
    eventName,
    route: '/api/webhooks/stripe',
    method: 'WORKER',
    requestId: randomUUID(),
    error: fields.error,
    replayedCount: event === 'webhook_replay_requested' ? fields.count : undefined,
  });
}
