import { prisma } from '@alusa/database';
import type { AsaasIntegrationJobType, Prisma } from '@prisma/client';

import { publishFinanceEvent } from '../realtime/finance-realtime-publisher';
import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

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
      return ['PAYMENT_RECEIVED_IN_CASH'];
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
  };

  return prisma.asaasIntegrationJob.upsert({
    where: {
      uq_asaas_integration_job: {
        contaId: input.contaId,
        type: input.type as AsaasIntegrationJobType,
        idempotencyKey: input.correlationId,
      },
    },
    create: {
      contaId: input.contaId,
      type: input.type as AsaasIntegrationJobType,
      status: 'PENDING',
      idempotencyKey: input.correlationId,
      payload: toJsonPayload(payload),
      chargeId: input.chargeId ?? null,
      cobrancaId: input.cobrancaId ?? null,
    },
    update: {
      status: 'PENDING',
      lastError: null,
      lastErrorAt: null,
      doneAt: null,
      payload: toJsonPayload(payload),
      chargeId: input.chargeId ?? undefined,
      cobrancaId: input.cobrancaId ?? undefined,
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

export async function confirmPaymentCommandsByProviderEvent(input: {
  contaId: string;
  asaasPaymentId: string;
  eventName: string;
  providerStatus?: string | null;
}) {
  const candidates = await prisma.asaasIntegrationJob.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['PENDING', 'PROCESSING'] },
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

    const nextPayload: PaymentCommandPayload = {
      ...payload,
      commandStatus: 'CONFIRMED_BY_WEBHOOK',
      confirmedAt: now.toISOString(),
      lastObservedEvent: input.eventName,
      providerStatus: input.providerStatus ?? null,
    };

    confirmed.push(
      await prisma.asaasIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          doneAt: now,
          payload: toJsonPayload(nextPayload),
        },
      }),
    );

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
