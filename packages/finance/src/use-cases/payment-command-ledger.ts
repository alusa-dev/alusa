import { prisma } from '@alusa/database';
import type { AsaasIntegrationJobType, Prisma } from '@prisma/client';

import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { withIdempotencyGuard } from '../core/idempotency.service';

export type PaymentCommandJobType =
  | 'PAYMENT_UPDATE_COMMAND'
  | 'PAYMENT_CANCEL_COMMAND'
  | 'PAYMENT_REFUND_COMMAND'
  | 'PAYMENT_UNDO_CASH_COMMAND'
  | 'PAYMENT_MARK_CASH_COMMAND';

export type PaymentCommandOperationalStatus =
  | 'REQUESTED'
  | 'SENT_TO_ASAAS'
  | 'CONFIRMED_BY_WEBHOOK'
  | 'FAILED'
  | 'NEEDS_RECONCILIATION';

export type PaymentCommandEntityType = 'COBRANCA' | 'CHARGE';

type PaymentCommandPayload = {
  commandStatus: PaymentCommandOperationalStatus;
  commandType: PaymentCommandJobType;
  entityType: PaymentCommandEntityType;
  entityId: string;
  asaasPaymentId: string;
  expectedEvents: string[];
  correlationId: string;
  actorId?: string | null;
  requestedAt: string;
  sentAt?: string;
  confirmedAt?: string;
  failedAt?: string;
  needsReconciliationAt?: string;
  lastObservedEvent?: string | null;
  providerStatus?: string | null;
  metadata?: Record<string, unknown>;
  requestFingerprint?: string;
};

export type RegisterPaymentCommandInput = {
  contaId: string;
  type: PaymentCommandJobType;
  entityType: PaymentCommandEntityType;
  entityId: string;
  asaasPaymentId: string;
  expectedEvents: string[];
  correlationId: string;
  actorId?: string | null;
  chargeId?: string | null;
  cobrancaId?: string | null;
  metadata?: Record<string, unknown>;
  requestFingerprint?: string;
};

export function expectedEventsForPaymentCommand(type: PaymentCommandJobType): string[] {
  switch (type) {
    case 'PAYMENT_CANCEL_COMMAND':
      return ['PAYMENT_DELETED'];
    case 'PAYMENT_REFUND_COMMAND':
      return [
        'PAYMENT_REFUNDED',
        'PAYMENT_PARTIALLY_REFUNDED',
        'PAYMENT_REFUND_REQUESTED',
        'PAYMENT_REFUND_IN_PROGRESS',
      ];
    case 'PAYMENT_UNDO_CASH_COMMAND':
      return ['PAYMENT_RECEIVED_IN_CASH_UNDONE', 'PAYMENT_UPDATED', 'PAYMENT_OVERDUE'];
    case 'PAYMENT_MARK_CASH_COMMAND':
      // Asaas emite PAYMENT_RECEIVED (billingType RECEIVED_IN_CASH), não PAYMENT_RECEIVED_IN_CASH.
      return ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
    case 'PAYMENT_UPDATE_COMMAND':
      return ['PAYMENT_UPDATED'];
  }
}

function toJsonPayload(payload: PaymentCommandPayload): Prisma.InputJsonObject {
  return payload as unknown as Prisma.InputJsonObject;
}

function parsePayload(payload: Prisma.JsonValue): PaymentCommandPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.asaasPaymentId !== 'string') return null;
  if (typeof record.commandType !== 'string') return null;
  if (typeof record.commandStatus !== 'string') return null;
  return record as PaymentCommandPayload;
}

function legacyRefundFingerprint(payload: PaymentCommandPayload): string | null {
  const metadata = payload.metadata;
  if (!metadata || typeof metadata.refundValue !== 'number') return null;
  const rawSplits = metadata.splitRefunds;
  const splits = rawSplits == null ? [] : Array.isArray(rawSplits) ? rawSplits : null;
  if (!splits) return null;
  const canonicalSplits: Array<[string, number]> = [];
  for (const entry of splits) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const split = entry as Record<string, unknown>;
    if (typeof split.id !== 'string' || typeof split.value !== 'number') return null;
    canonicalSplits.push([split.id, split.value]);
  }
  canonicalSplits.sort(([leftId, leftValue], [rightId, rightValue]) => leftId.localeCompare(rightId) || leftValue - rightValue);
  return JSON.stringify({ value: metadata.refundValue, splitRefunds: canonicalSplits });
}

function matchesRequestFingerprint(payload: PaymentCommandPayload, fingerprint: string | undefined): boolean {
  if (fingerprint === undefined) return true;
  if (typeof payload.requestFingerprint === 'string') return payload.requestFingerprint === fingerprint;
  // Legacy refund jobs recorded the canonical ingredients in metadata. If a
  // legacy row lacks enough data, fail closed instead of replaying an unknown payload.
  return legacyRefundFingerprint(payload) === fingerprint;
}

export async function registerPaymentCommand(input: RegisterPaymentCommandInput) {
  const nowIso = new Date().toISOString();
  const payload: PaymentCommandPayload = {
    commandStatus: 'REQUESTED',
    commandType: input.type,
    entityType: input.entityType,
    entityId: input.entityId,
    asaasPaymentId: input.asaasPaymentId,
    expectedEvents: input.expectedEvents,
    correlationId: input.correlationId,
    actorId: input.actorId ?? null,
    requestedAt: nowIso,
    metadata: input.metadata,
    requestFingerprint: input.requestFingerprint,
  };

  const key = {
    contaId: input.contaId,
    type: input.type as AsaasIntegrationJobType,
    idempotencyKey: input.correlationId,
  };
  const existing = await prisma.asaasIntegrationJob.findUnique({
    where: { uq_asaas_integration_job: key },
  });
  const existingPayload = existing ? parsePayload(existing.payload) : null;

  if (existing) {
    if (
      !existingPayload ||
      existingPayload.commandType !== input.type ||
      existingPayload.entityType !== input.entityType ||
      existingPayload.entityId !== input.entityId ||
      existingPayload.asaasPaymentId !== input.asaasPaymentId ||
      JSON.stringify(existingPayload.expectedEvents) !== JSON.stringify(input.expectedEvents) ||
      !matchesRequestFingerprint(existingPayload, input.requestFingerprint)
    ) {
      throw new Error('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    }

    // Uma repetição do mesmo comando reaproveita o estado atual. Nunca
    // devolvemos um comando já enviado/confirmado para PENDING.
    return existing;
  }

  const persisted = await prisma.asaasIntegrationJob.upsert({
    where: { uq_asaas_integration_job: key },
    create: {
      ...key,
      status: 'PENDING',
      payload: toJsonPayload(payload),
      chargeId: input.chargeId ?? null,
      cobrancaId: input.cobrancaId ?? null,
    },
    // A unique constraint resolve a corrida; o update vazio preserva o
    // estado do vencedor e evita reset de um comando em execução.
    update: {},
  });
  const persistedPayload = parsePayload(persisted.payload);
  if (
    !persistedPayload ||
    persistedPayload.commandType !== input.type ||
    persistedPayload.entityType !== input.entityType ||
    persistedPayload.entityId !== input.entityId ||
    persistedPayload.asaasPaymentId !== input.asaasPaymentId ||
    JSON.stringify(persistedPayload.expectedEvents) !== JSON.stringify(input.expectedEvents) ||
    !matchesRequestFingerprint(persistedPayload, input.requestFingerprint)
  ) {
    throw new Error('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  }

  return persisted;
}

/** Finds the newest refund command that is still outstanding for this payment
 * within the tenant. A webhook-confirmed or terminally failed command is not active. */
export async function findActivePaymentRefundCommand(input: { contaId: string; asaasPaymentId: string }) {
  const job = await prisma.asaasIntegrationJob.findFirst({
    where: {
      contaId: input.contaId,
      type: 'PAYMENT_REFUND_COMMAND',
      AND: [
        { payload: { path: ['asaasPaymentId'], equals: input.asaasPaymentId } },
        {
          OR: ['REQUESTED', 'SENT_TO_ASAAS', 'NEEDS_RECONCILIATION'].map((commandStatus) => ({
            payload: { path: ['commandStatus'], equals: commandStatus },
          })),
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, payload: true },
  });
  const payload = job ? parsePayload(job.payload) : null;
  if (!job || !payload || payload.commandType !== 'PAYMENT_REFUND_COMMAND' || payload.asaasPaymentId !== input.asaasPaymentId) {
    return null;
  }
  if (!['REQUESTED', 'SENT_TO_ASAAS', 'NEEDS_RECONCILIATION'].includes(payload.commandStatus)) return null;
  return { id: job.id, correlationId: payload.correlationId, commandStatus: payload.commandStatus };
}

/** Atomically claims one refund command per tenant/payment, even when callers
 * use different idempotency keys concurrently. A losing request is made
 * terminal without dispatch and receives the winning command identity. */
export async function claimPaymentRefundCommandForDispatch(input: {
  contaId: string;
  jobId: string;
  asaasPaymentId: string;
  providerStatus?: string | null;
}) {
  return withIdempotencyGuard({
    contaId: input.contaId,
    scope: 'event-payment-refund',
    key: input.asaasPaymentId,
    fn: async (tx) => {
      const jobs = await tx.asaasIntegrationJob.findMany({
        where: {
          contaId: input.contaId,
          type: 'PAYMENT_REFUND_COMMAND',
          AND: [
            { payload: { path: ['asaasPaymentId'], equals: input.asaasPaymentId } },
            {
              OR: ['REQUESTED', 'SENT_TO_ASAAS', 'NEEDS_RECONCILIATION'].map((commandStatus) => ({
                payload: { path: ['commandStatus'], equals: commandStatus },
              })),
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, payload: true },
      });
      const active = jobs.flatMap((candidate) => {
        const payload = parsePayload(candidate.payload);
        if (
          !payload ||
          payload.commandType !== 'PAYMENT_REFUND_COMMAND' ||
          payload.asaasPaymentId !== input.asaasPaymentId ||
          !['REQUESTED', 'SENT_TO_ASAAS', 'NEEDS_RECONCILIATION'].includes(payload.commandStatus)
        ) return [];
        return [{ id: candidate.id, payload }];
      });
      const current = active.find((candidate) => candidate.id === input.jobId);
      const winner = active[0];
      if (!current || !winner) {
        return { claimed: false as const, activeCommand: winner ? {
          id: winner.id, correlationId: winner.payload.correlationId, commandStatus: winner.payload.commandStatus,
        } : null };
      }

      if (winner.id !== input.jobId) {
        const now = new Date();
        await tx.asaasIntegrationJob.updateMany({
          where: {
            id: input.jobId,
            contaId: input.contaId,
            status: { in: ['PENDING', 'PROCESSING'] },
            payload: { path: ['commandStatus'], equals: 'REQUESTED' },
          },
          data: {
            status: 'FAILED',
            lastError: 'Another refund command for this payment is already active.',
            lastErrorAt: now,
            payload: toJsonPayload({
              ...current.payload,
              commandStatus: 'FAILED',
              failedAt: now.toISOString(),
              metadata: {
                ...(current.payload.metadata ?? {}),
                failureMessage: 'Another refund command for this payment is already active.',
              },
            }),
          },
        });
        return {
          claimed: false as const,
          activeCommand: { id: winner.id, correlationId: winner.payload.correlationId, commandStatus: winner.payload.commandStatus },
        };
      }

      if (current.payload.commandStatus !== 'REQUESTED') {
        return {
          claimed: false as const,
          activeCommand: { id: current.id, correlationId: current.payload.correlationId, commandStatus: current.payload.commandStatus },
        };
      }

      const now = new Date();
      const claimed = await tx.asaasIntegrationJob.updateMany({
        where: {
          id: input.jobId,
          contaId: input.contaId,
          status: { in: ['PENDING', 'PROCESSING'] },
          payload: { path: ['commandStatus'], equals: 'REQUESTED' },
        },
        data: {
          status: 'PROCESSING',
          processingAt: now,
          payload: toJsonPayload({
            ...current.payload,
            commandStatus: 'SENT_TO_ASAAS',
            sentAt: now.toISOString(),
            providerStatus: input.providerStatus ?? current.payload.providerStatus ?? null,
          }),
        },
      });
      return {
        claimed: claimed.count === 1,
        activeCommand: { id: current.id, correlationId: current.payload.correlationId, commandStatus: 'SENT_TO_ASAAS' as const },
      };
    },
  });
}

export async function markPaymentCommandSent(input: {
  jobId: string;
  providerStatus?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const job = await prisma.asaasIntegrationJob.findUnique({
    where: { id: input.jobId },
    select: { payload: true },
  });
  const payload = job ? parsePayload(job.payload) : null;
  if (!payload) return null;

  const nextPayload: PaymentCommandPayload = {
    ...payload,
    commandStatus: 'SENT_TO_ASAAS',
    sentAt: new Date().toISOString(),
    providerStatus: input.providerStatus ?? payload.providerStatus ?? null,
    metadata: {
      ...(payload.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  };

  return prisma.asaasIntegrationJob.update({
    where: { id: input.jobId },
    data: {
      status: 'PROCESSING',
      processingAt: new Date(),
      payload: toJsonPayload(nextPayload),
    },
  });
}

/** Atomically claims a still-unsubmitted command so concurrent callers cannot
 * both dispatch the same non-idempotent provider mutation. */
export async function claimPaymentCommandForDispatch(input: {
  contaId: string;
  jobId: string;
  providerStatus?: string | null;
}) {
  const job = await prisma.asaasIntegrationJob.findFirst({
    where: { id: input.jobId, contaId: input.contaId },
    select: { payload: true },
  });
  const payload = job ? parsePayload(job.payload) : null;
  if (!payload || payload.commandStatus !== 'REQUESTED') return { claimed: false };

  const now = new Date();
  const nextPayload: PaymentCommandPayload = {
    ...payload,
    commandStatus: 'SENT_TO_ASAAS',
    sentAt: now.toISOString(),
    providerStatus: input.providerStatus ?? payload.providerStatus ?? null,
  };
  const claimed = await prisma.asaasIntegrationJob.updateMany({
    where: {
      id: input.jobId,
      contaId: input.contaId,
      status: { in: ['PENDING', 'PROCESSING'] },
      payload: { path: ['commandStatus'], equals: 'REQUESTED' },
    },
    data: {
      status: 'PROCESSING',
      processingAt: now,
      payload: toJsonPayload(nextPayload),
    },
  });
  return { claimed: claimed.count === 1 };
}

export async function failPaymentCommand(input: {
  jobId: string;
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const job = await prisma.asaasIntegrationJob.findUnique({
    where: { id: input.jobId },
    select: { payload: true },
  });
  const payload = job ? parsePayload(job.payload) : null;
  const nextPayload = payload
    ? toJsonPayload({
        ...payload,
        commandStatus: 'FAILED',
        failedAt: new Date().toISOString(),
        metadata: {
          ...(payload.metadata ?? {}),
          failureMessage: message,
        },
      })
    : undefined;

  return prisma.asaasIntegrationJob.update({
    where: { id: input.jobId },
    data: {
      status: 'FAILED',
      attempts: { increment: 1 },
      lastError: message,
      lastErrorAt: new Date(),
      payload: nextPayload,
    },
  });
}

/**
 * Records an outbound payment mutation whose provider outcome is ambiguous.
 * Such commands must remain blocked from resubmission until reconciliation or
 * a provider webhook establishes the outcome.
 */
export async function markPaymentCommandNeedsReconciliation(input: {
  jobId: string;
  error: unknown;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const job = await prisma.asaasIntegrationJob.findUnique({
    where: { id: input.jobId },
    select: { id: true, contaId: true, payload: true },
  });
  const payload = job ? parsePayload(job.payload) : null;
  if (!job || !payload) return null;
  if (payload.commandStatus === 'CONFIRMED_BY_WEBHOOK') {
    return { id: job.id, status: 'CONFIRMED_BY_WEBHOOK' as const };
  }
  const now = new Date();
  const updated = await prisma.asaasIntegrationJob.updateMany({
    where: {
      id: input.jobId,
      contaId: job.contaId,
      payload: { path: ['commandStatus'], equals: payload.commandStatus },
    },
    data: {
      status: 'FAILED',
      lastError: message,
      lastErrorAt: now,
      payload: toJsonPayload({
        ...payload,
        commandStatus: 'NEEDS_RECONCILIATION',
        needsReconciliationAt: now.toISOString(),
        metadata: { ...(payload.metadata ?? {}), ambiguousOutcome: true, failureMessage: message },
      }),
    },
  });
  if (updated.count !== 1) {
    const latest = await prisma.asaasIntegrationJob.findUnique({
      where: { id: input.jobId },
      select: { payload: true },
    });
    const latestPayload = latest ? parsePayload(latest.payload) : null;
    if (latestPayload?.commandStatus === 'CONFIRMED_BY_WEBHOOK') {
      return { id: job.id, status: 'CONFIRMED_BY_WEBHOOK' as const };
    }
    return null;
  }
  await upsertFinanceReconciliationIssue({
    contaId: job.contaId,
    entityType: payload.entityType === 'COBRANCA' ? 'PAYMENT' : 'CHARGE',
    entityId: payload.entityId,
    asaasId: payload.asaasPaymentId,
    issueType: 'PAYMENT_NEEDS_REVIEW',
    severity: 'HIGH',
    localStatus: 'NEEDS_RECONCILIATION',
    remoteStatus: null,
    metadata: { commandJobId: job.id, commandType: payload.commandType, correlationId: payload.correlationId, source: 'ambiguous-payment-command' },
  });
  await publishFinanceEvent({
    contaId: job.contaId,
    type: 'finance.command.updated',
    entityId: payload.entityId,
    asaasPaymentId: payload.asaasPaymentId,
    commandType: payload.commandType,
    commandStatus: 'NEEDS_RECONCILIATION',
    revision: now.getTime(),
  });
  return { id: job.id, status: 'NEEDS_RECONCILIATION' as const };
}

export async function confirmPaymentCommandsByProviderEvent(input: {
  contaId: string;
  asaasPaymentId: string;
  eventName: string;
  providerStatus?: string | null;
}) {
  const candidates = await prisma.asaasIntegrationJob.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      OR: [
        { status: { in: ['PENDING', 'PROCESSING'] } },
        {
          status: 'FAILED',
          type: 'PAYMENT_REFUND_COMMAND',
          payload: { path: ['commandStatus'], equals: 'NEEDS_RECONCILIATION' },
        },
      ],
      type: {
        in: [
          'PAYMENT_UPDATE_COMMAND',
          'PAYMENT_CANCEL_COMMAND',
          'PAYMENT_REFUND_COMMAND',
          'PAYMENT_UNDO_CASH_COMMAND',
          'PAYMENT_MARK_CASH_COMMAND',
        ] as AsaasIntegrationJobType[],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const now = new Date();
  const confirmed = [];
  for (const job of candidates) {
    const payload = parsePayload(job.payload);
    if (!payload || payload.asaasPaymentId !== input.asaasPaymentId) continue;
    if (!payload.expectedEvents.includes(input.eventName)) continue;

    let confirmPayload = payload;
    let transitioned = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nextPayload: PaymentCommandPayload = {
        ...confirmPayload,
        commandStatus: 'CONFIRMED_BY_WEBHOOK',
        confirmedAt: now.toISOString(),
        lastObservedEvent: input.eventName,
        providerStatus: input.providerStatus ?? null,
      };
      const updated = await prisma.asaasIntegrationJob.updateMany({
        where: {
          id: job.id,
          contaId: input.contaId,
          payload: { path: ['commandStatus'], equals: confirmPayload.commandStatus },
        },
        data: {
          status: 'DONE',
          doneAt: now,
          payload: toJsonPayload(nextPayload),
        },
      });
      if (updated.count === 1) {
        transitioned = true;
        break;
      }
      const latest = await prisma.asaasIntegrationJob.findUnique({
        where: { id: job.id },
        select: { payload: true },
      });
      const latestPayload = latest ? parsePayload(latest.payload) : null;
      if (!latestPayload || latestPayload.commandStatus === 'CONFIRMED_BY_WEBHOOK') break;
      if (attempt === 0 && latestPayload.commandStatus === 'NEEDS_RECONCILIATION' && latestPayload.expectedEvents.includes(input.eventName)) {
        confirmPayload = latestPayload;
        continue;
      }
      break;
    }
    if (!transitioned) continue;

    const confirmedJob = await prisma.asaasIntegrationJob.findUnique({ where: { id: job.id } });
    if (!confirmedJob) continue;
    confirmed.push(confirmedJob);

    await publishFinanceEvent({
      contaId: input.contaId,
      type: 'finance.command.updated',
      entityId: payload.entityId,
      asaasPaymentId: input.asaasPaymentId,
      commandType: payload.commandType,
      commandStatus: 'CONFIRMED_BY_WEBHOOK',
      revision: now.getTime(),
    });
  }

  return confirmed;
}

export async function markStalePaymentCommandsForReconciliation(input: {
  contaId?: string;
  olderThanMinutes?: number;
  limit?: number;
}) {
  const olderThanMinutes = Math.max(1, input.olderThanMinutes ?? 10);
  const threshold = new Date(Date.now() - olderThanMinutes * 60_000);
  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      ...(input.contaId ? { contaId: input.contaId } : {}),
      status: { in: ['PENDING', 'PROCESSING'] },
      createdAt: { lt: threshold },
      type: {
        in: [
          'PAYMENT_UPDATE_COMMAND',
          'PAYMENT_CANCEL_COMMAND',
          'PAYMENT_REFUND_COMMAND',
          'PAYMENT_UNDO_CASH_COMMAND',
          'PAYMENT_MARK_CASH_COMMAND',
        ] as AsaasIntegrationJobType[],
      },
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });

  const now = new Date();
  const marked = [];
  for (const job of jobs) {
    const payload = parsePayload(job.payload);
    if (!payload) continue;

    const nextPayload: PaymentCommandPayload = {
      ...payload,
      commandStatus: 'NEEDS_RECONCILIATION',
      needsReconciliationAt: now.toISOString(),
    };

    marked.push(
      await prisma.asaasIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          lastError: `Comando aguardando confirmação há mais de ${olderThanMinutes} minutos.`,
          lastErrorAt: now,
          payload: toJsonPayload(nextPayload),
        },
      }),
    );

    await upsertFinanceReconciliationIssue({
      contaId: job.contaId,
      entityType: payload.entityType === 'COBRANCA' ? 'PAYMENT' : 'CHARGE',
      entityId: payload.entityId,
      asaasId: payload.asaasPaymentId,
      issueType: 'PAYMENT_NEEDS_REVIEW',
      severity: 'HIGH',
      localStatus: payload.commandStatus,
      remoteStatus: null,
      metadata: {
        commandJobId: job.id,
        commandType: payload.commandType,
        expectedEvents: payload.expectedEvents,
        source: 'payment-command-ledger',
      },
    });

    await publishFinanceEvent({
      contaId: job.contaId,
      type: 'finance.command.updated',
      entityId: payload.entityId,
      asaasPaymentId: payload.asaasPaymentId,
      commandType: payload.commandType,
      commandStatus: 'NEEDS_RECONCILIATION',
      revision: now.getTime(),
    });
  }

  return { processed: jobs.length, marked: marked.length };
}
