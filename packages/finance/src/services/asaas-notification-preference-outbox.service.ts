import { prisma } from '@alusa/database';

import {
  applyAsaasNotificationPreferencesToCustomer,
  listCustomerIdsWithAsaas,
} from './asaas-notification-preferences.service';

export type EnqueueAsaasNotificationPreferenceSyncInput = {
  contaId: string;
  asaasCustomerId: string;
  reason?: string;
};

export type ProcessAsaasNotificationPreferenceOutboxInput = {
  contaId?: string;
  limit?: number;
  processingTimeoutMinutes?: number;
};

export type ProcessAsaasNotificationPreferenceOutboxResult = {
  scanned: number;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  errors: Array<{ id: string; contaId: string; asaasCustomerId: string; message: string }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function dedupeKey(asaasCustomerId: string): string {
  return `tenant-preferences:${asaasCustomerId}`;
}

function nextAttemptDate(attempts: number): Date {
  const minutes = Math.min(120, Math.max(1, 2 ** Math.min(6, attempts)));
  return new Date(Date.now() + minutes * 60_000);
}

export async function enqueueAsaasNotificationPreferenceSync(
  input: EnqueueAsaasNotificationPreferenceSyncInput,
) {
  const key = dedupeKey(input.asaasCustomerId);

  return prisma.asaasNotificationPreferenceOutbox.upsert({
    where: {
      uq_asaas_notif_outbox_conta_dedupe: {
        contaId: input.contaId,
        dedupeKey: key,
      },
    },
    update: {
      asaasCustomerId: input.asaasCustomerId,
      status: 'PENDING',
      reason: input.reason ?? null,
      attempts: 0,
      nextAttemptAt: new Date(),
      processingAt: null,
      processedAt: null,
      lastError: null,
      lastErrorAt: null,
    },
    create: {
      contaId: input.contaId,
      asaasCustomerId: input.asaasCustomerId,
      dedupeKey: key,
      reason: input.reason ?? null,
    },
  });
}

export async function enqueueAsaasNotificationPreferenceSyncForTenant(input: {
  contaId: string;
  reason?: string;
  limit?: number;
}) {
  const limit = clampInt(input.limit, 500, 1, 5_000);
  const customerIds = (await listCustomerIdsWithAsaas(input.contaId)).slice(0, limit);
  let enqueued = 0;

  for (const asaasCustomerId of customerIds) {
    await enqueueAsaasNotificationPreferenceSync({
      contaId: input.contaId,
      asaasCustomerId,
      reason: input.reason,
    });
    enqueued += 1;
  }

  return { enqueued, customerIds };
}

export async function processAsaasNotificationPreferenceOutbox(
  input: ProcessAsaasNotificationPreferenceOutboxInput = {},
): Promise<ProcessAsaasNotificationPreferenceOutboxResult> {
  const limit = clampInt(input.limit, 50, 1, 200);
  const processingTimeoutMinutes = clampInt(input.processingTimeoutMinutes, 15, 1, 120);
  const now = new Date();
  const staleProcessingBefore = new Date(now.getTime() - processingTimeoutMinutes * 60_000);

  const rows = await prisma.asaasNotificationPreferenceOutbox.findMany({
    where: {
      contaId: input.contaId,
      OR: [
        {
          status: { in: ['PENDING', 'FAILED'] },
          nextAttemptAt: { lte: now },
        },
        {
          status: 'PROCESSING',
          processingAt: { lt: staleProcessingBefore },
        },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });

  const result: ProcessAsaasNotificationPreferenceOutboxResult = {
    scanned: rows.length,
    processed: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows) {
    const claimed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
      where: { id: row.id, status: row.status },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) continue;

    const attempts = row.attempts + 1;
    try {
      const sync = await applyAsaasNotificationPreferencesToCustomer(
        row.contaId,
        row.asaasCustomerId,
      );
      await prisma.asaasNotificationPreferenceOutbox.update({
        where: { id: row.id },
        data: {
          status: 'DONE',
          processingAt: null,
          processedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
      });
      result.processed += 1;
      if (sync.updated) result.updated += 1;
      else result.unchanged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.asaasNotificationPreferenceOutbox.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          processingAt: null,
          nextAttemptAt: nextAttemptDate(attempts),
          lastError: message,
          lastErrorAt: new Date(),
        },
      });
      result.failed += 1;
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
