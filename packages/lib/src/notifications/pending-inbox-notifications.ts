import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../prisma';
import { logInboxMetric } from './inbox-metrics';
import {
  createBillingWebhookNotification,
  isBillingNotificationEvent,
  type BillingNotificationEventInput,
} from '../services/notifications.service';

export const PENDING_INBOX_KIND_BILLING_WEBHOOK = 'BILLING_WEBHOOK';

export type PendingBillingWebhookPayload = {
  contaId: string;
  eventId?: string | null;
  eventName: BillingNotificationEventInput;
  asaasPaymentId: string;
  occurredAt?: string | null;
  sourceType?: 'ASAAS_WEBHOOK' | 'ASAAS_SYNC';
};

function buildPendingDedupeKey(contaId: string, asaasPaymentId: string, eventName: string): string {
  return `pending:billing:${contaId}:${eventName}:${asaasPaymentId}`;
}

const pendingBillingWebhookPayloadSchema = z.object({
  contaId: z.string().min(1),
  eventId: z.string().nullable().optional(),
  eventName: z.string().min(1).refine(isBillingNotificationEvent),
  asaasPaymentId: z.string().min(1),
  occurredAt: z.string().nullable().optional(),
  sourceType: z.enum(['ASAAS_WEBHOOK', 'ASAAS_SYNC']).optional(),
});

const PROCESSING_LEASE_MS = 4 * 60_000;

type ClaimedPendingInboxNotification = {
  id: string;
  contaId: string | null;
  kind: string;
  payload: Prisma.JsonValue;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  processingToken: string;
};

class PendingInboxPayloadIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingInboxPayloadIntegrityError';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

export async function enqueuePendingBillingWebhookNotification(
  params: PendingBillingWebhookPayload,
): Promise<void> {
  const dedupeKey = buildPendingDedupeKey(params.contaId, params.asaasPaymentId, params.eventName);
  const nextRetryAt = new Date(Date.now() + 60_000);

  try {
    const existing = await prisma.pendingInboxNotification.findUnique({
      where: { dedupeKey },
      select: { id: true, status: true },
    });

    // A duplicate delivery must never resurrect completed/failed work or take
    // the lease from a worker that is already processing the event.
    if (existing?.status === 'DONE' || existing?.status === 'PROCESSING' || existing?.status === 'FAILED') {
      return;
    }

    if (existing) {
      await prisma.pendingInboxNotification.updateMany({
        where: { id: existing.id, status: 'PENDING' },
        data: { payload: params, nextRetryAt, lastError: null },
      });
    } else {
      try {
        await prisma.pendingInboxNotification.create({
          data: {
            contaId: params.contaId,
            kind: PENDING_INBOX_KIND_BILLING_WEBHOOK,
            payload: params,
            dedupeKey,
            status: 'PENDING',
            nextRetryAt,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        // Another delivery won the insert race. Only refresh a still-pending
        // item; PROCESSING/DONE/FAILED remain owned by their current outcome.
        await prisma.pendingInboxNotification.updateMany({
          where: { dedupeKey, status: 'PENDING' },
          data: { payload: params, nextRetryAt, lastError: null },
        });
      }
    }

    logInboxMetric('inbox.pending.enqueued', {
      dedupeKey,
      contaId: params.contaId,
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

async function claimPendingInboxNotifications(params: {
  contaId?: string;
  limit: number;
}): Promise<ClaimedPendingInboxNotification[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE "PendingInboxNotification"
        SET
          "status" = 'FAILED'::"PendingInboxNotificationStatus",
          "lastError" = 'Lease expirado após atingir o máximo de tentativas',
          "processedAt" = CURRENT_TIMESTAMP,
          "processingToken" = NULL,
          "processingStartedAt" = NULL,
          "leaseUntil" = NULL
        WHERE "status" = 'PROCESSING'::"PendingInboxNotificationStatus"
          AND "leaseUntil" <= CURRENT_TIMESTAMP
          AND "attempts" >= "maxAttempts"
      `,
    );

    const tenantFilter = params.contaId
      ? Prisma.sql`AND "contaId" = ${params.contaId}`
      : Prisma.empty;
    const processingToken = randomUUID();

    return tx.$queryRaw<ClaimedPendingInboxNotification[]>(
      Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "PendingInboxNotification"
          WHERE (
            (
              "status" = 'PENDING'::"PendingInboxNotificationStatus"
              AND "nextRetryAt" <= CURRENT_TIMESTAMP
            )
            OR (
              "status" = 'PROCESSING'::"PendingInboxNotificationStatus"
              AND "leaseUntil" <= CURRENT_TIMESTAMP
            )
          )
          AND "attempts" < "maxAttempts"
          ${tenantFilter}
          ORDER BY "nextRetryAt" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${params.limit}
        )
        UPDATE "PendingInboxNotification" AS inbox
        SET
          "status" = 'PROCESSING'::"PendingInboxNotificationStatus",
          "attempts" = inbox."attempts" + 1,
          "processingToken" = ${processingToken},
          "processingStartedAt" = CURRENT_TIMESTAMP,
          "leaseUntil" = CURRENT_TIMESTAMP + (${PROCESSING_LEASE_MS} * INTERVAL '1 millisecond'),
          "lastError" = NULL,
          "processedAt" = NULL
        FROM candidates
        WHERE inbox."id" = candidates."id"
        RETURNING
          inbox."id",
          inbox."contaId",
          inbox."kind",
          inbox."payload",
          inbox."dedupeKey",
          inbox."attempts",
          inbox."maxAttempts",
          inbox."processingToken"
      `,
    );
  });
}

async function updateClaimedPendingRow(
  row: ClaimedPendingInboxNotification,
  data: Prisma.PendingInboxNotificationUpdateManyMutationInput,
): Promise<boolean> {
  const updated = await prisma.pendingInboxNotification.updateMany({
    where: {
      id: row.id,
      status: 'PROCESSING',
      processingToken: row.processingToken,
    },
    data,
  });

  if (updated.count !== 1) {
    logInboxMetric('inbox.pending.lease_lost', {
      dedupeKey: row.dedupeKey,
      contaId: row.contaId,
    });
    return false;
  }

  return true;
}

function parsePendingBillingWebhookPayload(row: ClaimedPendingInboxNotification): PendingBillingWebhookPayload {
  const result = pendingBillingWebhookPayloadSchema.safeParse(row.payload);
  if (!result.success) {
    throw new PendingInboxPayloadIntegrityError(`Payload inválido para pending inbox ${row.dedupeKey}`);
  }

  if (!row.contaId || result.data.contaId !== row.contaId) {
    throw new PendingInboxPayloadIntegrityError(`Inconsistência de tenant para pending inbox ${row.dedupeKey}`);
  }

  return result.data;
}

export async function processPendingInboxNotifications(params?: {
  contaId?: string;
  limit?: number;
}): Promise<{ attempted: number; processed: number; failed: number }> {
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
  const pending = await claimPendingInboxNotifications({ contaId: params?.contaId, limit });

  let processed = 0;
  let failed = 0;

  for (const row of pending) {
    const attempts = row.attempts;

    if (row.kind !== PENDING_INBOX_KIND_BILLING_WEBHOOK) {
      if (await updateClaimedPendingRow(row, {
        status: 'FAILED',
        lastError: `Kind não suportado: ${row.kind}`,
        processedAt: new Date(),
        processingToken: null,
        processingStartedAt: null,
        leaseUntil: null,
      })) {
        failed += 1;
      }
      continue;
    }

    try {
      const payload = parsePendingBillingWebhookPayload(row);
      const result = await createBillingWebhookNotification({
        // The tenant stored on the inbox row is authoritative.
        contaId: row.contaId!,
        eventId: payload.eventId ?? null,
        eventName: payload.eventName,
        asaasPaymentId: payload.asaasPaymentId,
        occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
        sourceType: payload.sourceType ?? 'ASAAS_WEBHOOK',
      });

      if (result.notificationId) {
        if (await updateClaimedPendingRow(row, {
          status: 'DONE',
          processedAt: new Date(),
          lastError: null,
          processingToken: null,
          processingStartedAt: null,
          leaseUntil: null,
        })) {
          processed += 1;
          logInboxMetric('inbox.pending.processed', {
            dedupeKey: row.dedupeKey,
            contaId: row.contaId,
            notificationId: result.notificationId,
          });
        }
        continue;
      }

      if (attempts >= row.maxAttempts) {
        if (await updateClaimedPendingRow(row, {
          status: 'FAILED',
          processedAt: new Date(),
          lastError: 'Entidade local não encontrada após tentativas máximas',
          processingToken: null,
          processingStartedAt: null,
          leaseUntil: null,
        })) {
          failed += 1;
          logInboxMetric('inbox.pending.failed', { dedupeKey: row.dedupeKey, attempts });
        }
      } else {
        await updateClaimedPendingRow(row, {
          status: 'PENDING',
          nextRetryAt: computeNextRetry(attempts),
          lastError: 'Entidade local ainda não disponível',
          processingToken: null,
          processingStartedAt: null,
          leaseUntil: null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PendingInboxPayloadIntegrityError || attempts >= row.maxAttempts) {
        if (await updateClaimedPendingRow(row, {
          status: 'FAILED',
          lastError: message.slice(0, 500),
          processedAt: new Date(),
          processingToken: null,
          processingStartedAt: null,
          leaseUntil: null,
        })) {
          failed += 1;
          logInboxMetric('inbox.pending.failed', { dedupeKey: row.dedupeKey, attempts });
        }
      } else {
        await updateClaimedPendingRow(row, {
          status: 'PENDING',
          nextRetryAt: computeNextRetry(attempts),
          lastError: message.slice(0, 500),
          processingToken: null,
          processingStartedAt: null,
          leaseUntil: null,
        });
      }
    }
  }

  return { attempted: pending.length, processed, failed };
}
