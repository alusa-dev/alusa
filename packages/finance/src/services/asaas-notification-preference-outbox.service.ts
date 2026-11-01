import { randomUUID } from 'node:crypto';
import { prisma } from '@alusa/database';
import type { NotificationPreferenceInput } from './asaas-notification-preferences.service';

import {
  applyAsaasNotificationPreferencesToCustomer,
  listCustomerIdsWithAsaas,
  saveAsaasNotificationPreferences,
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
  exhausted: number;
  errors: Array<{ id: string; contaId: string; asaasCustomerId: string; message: string }>;
};

const MAX_ATTEMPTS = 8;

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
  const policy = await prisma.conta.findUnique({ where: { id: input.contaId }, select: { notificationPolicyVersion: true } });

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
      policyVersion: policy?.notificationPolicyVersion ?? 1,
      attempts: 0,
      nextAttemptAt: new Date(),
      processingAt: null,
      claimToken: null,
      processedAt: null,
      lastError: null,
      lastErrorAt: null,
    },
    create: {
      contaId: input.contaId,
      asaasCustomerId: input.asaasCustomerId,
      dedupeKey: key,
      policyVersion: policy?.notificationPolicyVersion ?? 1,
      reason: input.reason ?? null,
    },
  });
}

export async function enqueueAsaasNotificationPreferenceSyncForTenant(input: {
  contaId: string;
  reason?: string;
}) {
  const customerIds = await listCustomerIdsWithAsaas(input.contaId);
  if (customerIds.length === 0) return { enqueued: 0, customerIds };
  const policy = await prisma.conta.findUnique({ where: { id: input.contaId }, select: { notificationPolicyVersion: true } });
  const policyVersion = policy?.notificationPolicyVersion ?? 1;
  await prisma.$transaction(async (tx) => {
    for (let offset = 0; offset < customerIds.length; offset += 500) {
      const page = customerIds.slice(offset, offset + 500);
      await tx.asaasNotificationPreferenceOutbox.updateMany({
        where: { contaId: input.contaId, asaasCustomerId: { in: page } },
        data: {
          status: 'PENDING', reason: input.reason ?? null, policyVersion, attempts: 0,
          nextAttemptAt: new Date(), processingAt: null, claimToken: null,
          processedAt: null, lastError: null, lastErrorAt: null,
        },
      });
      await tx.asaasNotificationPreferenceOutbox.createMany({
        data: page.map((asaasCustomerId) => ({
          contaId: input.contaId,
          asaasCustomerId,
          dedupeKey: dedupeKey(asaasCustomerId),
          reason: input.reason ?? null,
          policyVersion,
        })),
        skipDuplicates: true,
      });
    }
  });
  return { enqueued: customerIds.length, customerIds };
}

export async function saveAsaasNotificationPolicyAndEnqueue(input: {
  contaId: string;
  preferences: NotificationPreferenceInput[];
  policy: {
    customerNotificationsEnabled: boolean;
    customerEmailNotificationsEnabled: boolean;
    customerWhatsAppNotificationsEnabled: boolean;
    customerSmsNotificationsEnabled: boolean;
    contractWhatsAppNotificationsEnabled: boolean;
    contractNotificationsEnabled: boolean;
    contractEmailNotificationsEnabled: boolean;
  };
}) {
  return prisma.$transaction(async (tx) => {
    const [existingPreferences, existingPolicy] = await Promise.all([
      tx.asaasNotificationPreference.findMany({ where: { contaId: input.contaId } }),
      tx.conta.findUnique({
        where: { id: input.contaId },
        select: {
          customerNotificationsEnabled: true,
          customerEmailNotificationsEnabled: true,
          customerWhatsAppNotificationsEnabled: true,
          customerSmsNotificationsEnabled: true,
          contractWhatsAppNotificationsEnabled: true,
          contractNotificationsEnabled: true,
          contractEmailNotificationsEnabled: true,
        },
      }),
    ]);
    const incoming = new Map(input.preferences.map((preference) => [`${preference.event}:${preference.scheduleOffset ?? 0}`, preference]));
    const preferenceChanged = existingPreferences.length !== incoming.size || existingPreferences.some((current) => {
      const next = incoming.get(`${current.event}:${current.scheduleOffset}`);
      return !next || [
        'enabled', 'customerEnabled', 'emailEnabledForProvider', 'smsEnabledForProvider',
        'emailEnabledForCustomer', 'smsEnabledForCustomer', 'whatsappEnabledForCustomer',
        'phoneCallEnabledForCustomer',
      ].some((key) => current[key as keyof typeof current] !== next[key as keyof typeof next]);
    });
    const customerPolicyChanged = preferenceChanged ||
      existingPolicy?.customerNotificationsEnabled !== input.policy.customerNotificationsEnabled ||
      existingPolicy?.customerEmailNotificationsEnabled !== input.policy.customerEmailNotificationsEnabled ||
      existingPolicy?.customerWhatsAppNotificationsEnabled !== input.policy.customerWhatsAppNotificationsEnabled ||
      existingPolicy?.customerSmsNotificationsEnabled !== input.policy.customerSmsNotificationsEnabled;
    const preferences = await saveAsaasNotificationPreferences(input.contaId, input.preferences, tx);
    const conta = await tx.conta.update({
      where: { id: input.contaId },
      data: {
        customerNotificationsEnabled: input.policy.customerNotificationsEnabled,
        customerEmailNotificationsEnabled: input.policy.customerEmailNotificationsEnabled,
        customerWhatsAppNotificationsEnabled: input.policy.customerWhatsAppNotificationsEnabled,
        customerSmsNotificationsEnabled: input.policy.customerSmsNotificationsEnabled,
        contractWhatsAppNotificationsEnabled: input.policy.contractWhatsAppNotificationsEnabled,
        contractNotificationsEnabled: input.policy.contractNotificationsEnabled,
        contractEmailNotificationsEnabled: input.policy.contractEmailNotificationsEnabled,
        ...(customerPolicyChanged ? { notificationPolicyVersion: { increment: 1 } } : {}),
      },
      select: { notificationPolicyVersion: true },
    });
    const customerIds = customerPolicyChanged ? await listCustomerIdsWithAsaas(input.contaId, tx) : [];
    if (customerIds.length > 0) {
      for (let offset = 0; offset < customerIds.length; offset += 500) {
        const page = customerIds.slice(offset, offset + 500);
        await tx.asaasNotificationPreferenceOutbox.updateMany({
          where: { contaId: input.contaId, asaasCustomerId: { in: page } },
          data: {
            status: 'PENDING', reason: 'POLITICA_NOTIFICACOES_ATUALIZADA',
            policyVersion: conta.notificationPolicyVersion, attempts: 0,
            nextAttemptAt: new Date(), processingAt: null, claimToken: null,
            processedAt: null, lastError: null, lastErrorAt: null,
          },
        });
        await tx.asaasNotificationPreferenceOutbox.createMany({
          data: page.map((asaasCustomerId) => ({
            contaId: input.contaId,
            asaasCustomerId,
            dedupeKey: dedupeKey(asaasCustomerId),
            reason: 'POLITICA_NOTIFICACOES_ATUALIZADA',
            policyVersion: conta.notificationPolicyVersion,
          })),
          skipDuplicates: true,
        });
      }
    }
    return { preferences, policy: { ...input.policy, version: conta.notificationPolicyVersion }, enqueued: customerIds.length };
  });
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
    exhausted: 0,
    errors: [],
  };

  for (const row of rows) {
    if (row.attempts >= MAX_ATTEMPTS) {
      const exhausted = await prisma.asaasNotificationPreferenceOutbox.updateMany({
        where: {
          id: row.id,
          contaId: row.contaId,
          status: row.status,
          processingAt: row.processingAt,
          claimToken: row.claimToken,
          policyVersion: row.policyVersion,
        },
        data: { status: 'EXHAUSTED', processingAt: null, claimToken: null },
      });
      if (exhausted.count > 0) result.exhausted += 1;
      continue;
    }

    const claimToken = randomUUID();
    const claimed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
      where: {
        id: row.id,
        contaId: row.contaId,
        status: row.status,
        processingAt: row.processingAt,
        claimToken: row.claimToken,
        policyVersion: row.policyVersion,
      },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        claimToken,
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
      const completed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
        where: { id: row.id, contaId: row.contaId, status: 'PROCESSING', claimToken, policyVersion: row.policyVersion },
        data: {
          status: 'DONE',
          processingAt: null,
          claimToken: null,
          lastAppliedPolicyVersion: row.policyVersion,
          processedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
      });
      if (completed.count === 0) {
        // A newer intent may have been persisted while this PUT was in flight.
        // Release our claim without overwriting its version so the latest local
        // state is picked up on the next pass.
        if (row.policyVersion == null && sync.updated) {
          await enqueueAsaasNotificationPreferenceSync({
            contaId: row.contaId,
            asaasCustomerId: row.asaasCustomerId,
            reason: 'PREFERENCE_PUT_COMPLETED_AFTER_CLAIM_LOST',
          });
          continue;
        }
        const rearmed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
          where: { id: row.id, contaId: row.contaId, status: 'PROCESSING', claimToken, policyVersion: { not: row.policyVersion } },
          data: { status: 'PENDING', processingAt: null, claimToken: null, nextAttemptAt: new Date() },
        });
        if (rearmed.count === 0 && sync.updated) {
          await enqueueAsaasNotificationPreferenceSync({
            contaId: row.contaId,
            asaasCustomerId: row.asaasCustomerId,
            reason: 'PREFERENCE_PUT_COMPLETED_AFTER_CLAIM_LOST',
          });
        }
        continue;
      }
      result.processed += 1;
      if (sync.updated) result.updated += 1;
      else result.unchanged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempts >= MAX_ATTEMPTS;
      const failed = await prisma.asaasNotificationPreferenceOutbox.updateMany({
        where: { id: row.id, contaId: row.contaId, status: 'PROCESSING', claimToken, policyVersion: row.policyVersion },
        data: {
          status: exhausted ? 'EXHAUSTED' : 'FAILED',
          processingAt: null,
          claimToken: null,
          ...(exhausted ? {} : { nextAttemptAt: nextAttemptDate(attempts) }),
          lastError: message,
          lastErrorAt: new Date(),
        },
      });
      if (failed.count === 0) {
        await prisma.asaasNotificationPreferenceOutbox.updateMany({
          where: { id: row.id, contaId: row.contaId, status: 'PROCESSING', claimToken, policyVersion: { not: row.policyVersion } },
          data: { status: 'PENDING', processingAt: null, claimToken: null, nextAttemptAt: new Date() },
        });
        continue;
      }
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
