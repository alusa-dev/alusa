import { prisma } from '@alusa/database';
import type { AsaasIntegrationJobType, Prisma } from '@prisma/client';

import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';

export type OutboundFinancialOperationState =
  | 'INTENT_CREATED'
  | 'REMOTE_REQUESTED'
  | 'REMOTE_CONFIRMED'
  | 'AWAITING_WEBHOOK'
  | 'SYNCHRONIZED'
  | 'RESULT_UNKNOWN'
  | 'REQUIRES_RECONCILIATION'
  | 'FAILED';

export type OutboundFinancialResource = 'PAYMENT' | 'SUBSCRIPTION' | 'INSTALLMENT_PLAN';

export type OutboundFinancialOperationPayload = {
  version: 1;
  state: OutboundFinancialOperationState;
  resource: OutboundFinancialResource;
  entityId: string;
  externalReference: string;
  correlationId: string;
  requestFingerprint: string;
  requestedAt?: string;
  remoteConfirmedAt?: string;
  webhookConfirmedAt?: string;
  remoteId?: string;
  lastError?: string;
  metadata?: Record<string, unknown>;
};

type EntityLinks = {
  chargeId?: string | null;
  cobrancaId?: string | null;
  subscriptionId?: string | null;
  installmentPlanId?: string | null;
};

function asJson(payload: OutboundFinancialOperationPayload): Prisma.InputJsonObject {
  return payload as unknown as Prisma.InputJsonObject;
}

export function parseOutboundFinancialOperation(
  payload: Prisma.JsonValue,
): OutboundFinancialOperationPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.version !== 1 || typeof value.state !== 'string') return null;
  if (typeof value.resource !== 'string' || typeof value.entityId !== 'string') return null;
  if (typeof value.externalReference !== 'string' || typeof value.correlationId !== 'string') return null;
  if (typeof value.requestFingerprint !== 'string') return null;
  return value as OutboundFinancialOperationPayload;
}

/**
 * Reserva a intenção antes de qualquer I/O externo. A chave composta torna retry
 * concorrente idempotente dentro do tenant e o fingerprint impede reutilizar a
 * mesma chave para um comando diferente.
 */
export async function reserveOutboundFinancialOperation(input: {
  contaId: string;
  type: Extract<AsaasIntegrationJobType, 'CREATE_PAYMENT' | 'CREATE_SUBSCRIPTION' | 'CREATE_INSTALLMENT'>;
  idempotencyKey: string;
  resource: OutboundFinancialResource;
  entityId: string;
  externalReference: string;
  requestFingerprint: string;
  metadata?: Record<string, unknown>;
  links?: EntityLinks;
}) {
  const key = {
    contaId: input.contaId,
    type: input.type,
    idempotencyKey: input.idempotencyKey,
  };
  const existing = await prisma.asaasIntegrationJob.findUnique({
    where: { uq_asaas_integration_job: key },
  });
  const existingPayload = existing ? parseOutboundFinancialOperation(existing.payload) : null;

  if (existingPayload && existingPayload.requestFingerprint !== input.requestFingerprint) {
    throw new Error('OUTBOUND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  }
  if (existing && existingPayload) return { job: existing, payload: existingPayload };

  const payload: OutboundFinancialOperationPayload = {
    version: 1,
    state: 'INTENT_CREATED',
    resource: input.resource,
    entityId: input.entityId,
    externalReference: input.externalReference,
    correlationId: input.idempotencyKey,
    requestFingerprint: input.requestFingerprint,
    metadata: input.metadata,
  };

  const job = await prisma.asaasIntegrationJob.upsert({
    where: { uq_asaas_integration_job: key },
    create: {
      ...key,
      status: 'PENDING',
      payload: asJson(payload),
      chargeId: input.links?.chargeId ?? null,
      cobrancaId: input.links?.cobrancaId ?? null,
      subscriptionId: input.links?.subscriptionId ?? null,
      installmentPlanId: input.links?.installmentPlanId ?? null,
    },
    update: {},
  });
  const persisted = parseOutboundFinancialOperation(job.payload);
  if (!persisted) throw new Error('OUTBOUND_OPERATION_PAYLOAD_INVALID');
  if (persisted.requestFingerprint !== input.requestFingerprint) {
    throw new Error('OUTBOUND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
  }
  return { job, payload: persisted };
}

async function transition(input: {
  jobId: string;
  state: OutboundFinancialOperationState;
  remoteId?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const current = await prisma.asaasIntegrationJob.findUnique({
    where: { id: input.jobId },
    select: { payload: true, status: true },
  });
  const payload = current ? parseOutboundFinancialOperation(current.payload) : null;
  if (!current || !payload) throw new Error('OUTBOUND_OPERATION_NOT_FOUND');

  // Um webhook pode confirmar a operação enquanto a requisição original
  // ainda está encerrando. Nunca regrida uma operação terminal para
  // PROCESSING/FAILED por causa dessa corrida.
  if (current.status === 'DONE' && input.state !== 'SYNCHRONIZED') {
    return prisma.asaasIntegrationJob.findUniqueOrThrow({ where: { id: input.jobId } });
  }
  const now = new Date();
  const message = input.error instanceof Error ? input.error.message : input.error ? String(input.error) : undefined;
  const next: OutboundFinancialOperationPayload = {
    ...payload,
    state: input.state,
    remoteId: input.remoteId ?? payload.remoteId,
    lastError: message,
    requestedAt: input.state === 'REMOTE_REQUESTED' ? now.toISOString() : payload.requestedAt,
    remoteConfirmedAt:
      input.state === 'REMOTE_CONFIRMED' || input.state === 'AWAITING_WEBHOOK' || input.state === 'SYNCHRONIZED'
        ? payload.remoteConfirmedAt ?? now.toISOString()
        : payload.remoteConfirmedAt,
    webhookConfirmedAt:
      input.state === 'SYNCHRONIZED' ? payload.webhookConfirmedAt ?? now.toISOString() : payload.webhookConfirmedAt,
    metadata: { ...(payload.metadata ?? {}), ...(input.metadata ?? {}) },
  };
  const terminal = input.state === 'SYNCHRONIZED';
  const failed = input.state === 'FAILED' || input.state === 'REQUIRES_RECONCILIATION';
  return prisma.asaasIntegrationJob.update({
    where: { id: input.jobId },
    data: {
      status: terminal ? 'DONE' : failed ? 'FAILED' : 'PROCESSING',
      payload: asJson(next),
      processingAt: terminal ? undefined : now,
      doneAt: terminal ? now : null,
      attempts: input.state === 'REMOTE_REQUESTED' ? { increment: 1 } : undefined,
      lastError: message ?? null,
      lastErrorAt: message ? now : null,
      nextAttemptAt:
        input.state === 'RESULT_UNKNOWN' || input.state === 'REQUIRES_RECONCILIATION'
          ? new Date(now.getTime() + 60_000)
          : undefined,
    },
  });
}

/** Adquire atomicamente o direito de executar o POST; concorrentes apenas reconciliam. */
export async function markOutboundRemoteRequested(jobId: string): Promise<boolean> {
  const current = await prisma.asaasIntegrationJob.findUnique({
    where: { id: jobId },
    select: { payload: true },
  });
  const payload = current ? parseOutboundFinancialOperation(current.payload) : null;
  if (!payload) throw new Error('OUTBOUND_OPERATION_NOT_FOUND');
  const now = new Date();
  const next: OutboundFinancialOperationPayload = {
    ...payload,
    state: 'REMOTE_REQUESTED',
    requestedAt: now.toISOString(),
    lastError: undefined,
  };
  const claimed = await prisma.asaasIntegrationJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: {
      status: 'PROCESSING',
      processingAt: now,
      attempts: { increment: 1 },
      payload: asJson(next),
      lastError: null,
      lastErrorAt: null,
    },
  });
  return claimed.count === 1;
}

export const markOutboundRemoteConfirmed = (jobId: string, remoteId: string, metadata?: Record<string, unknown>) =>
  transition({ jobId, state: 'REMOTE_CONFIRMED', remoteId, metadata });

export const markOutboundAwaitingWebhook = (jobId: string, remoteId: string) =>
  transition({ jobId, state: 'AWAITING_WEBHOOK', remoteId });

export const markOutboundSynchronized = (jobId: string, remoteId?: string, metadata?: Record<string, unknown>) =>
  transition({ jobId, state: 'SYNCHRONIZED', remoteId, metadata });

export const markOutboundFailed = (jobId: string, error: unknown, metadata?: Record<string, unknown>) =>
  transition({ jobId, state: 'FAILED', error, metadata });

export async function markOutboundResultUnknown(input: {
  jobId: string;
  contaId: string;
  resource: OutboundFinancialResource;
  entityId: string;
  externalReference: string;
  error: unknown;
}) {
  const job = await transition({ jobId: input.jobId, state: 'RESULT_UNKNOWN', error: input.error });
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: input.resource,
    entityId: input.entityId,
    asaasId: null,
    issueType: 'BILLING_OPERATION_UNCERTAIN',
    severity: 'HIGH',
    localStatus: 'RESULT_UNKNOWN',
    remoteStatus: null,
    metadata: {
      jobId: input.jobId,
      externalReference: input.externalReference,
      source: 'outbound-financial-operation',
    },
  });
  return job;
}

export async function markOutboundRequiresReconciliation(input: {
  jobId: string;
  contaId: string;
  resource: OutboundFinancialResource;
  entityId: string;
  externalReference: string;
  error: unknown;
}) {
  const job = await transition({
    jobId: input.jobId,
    state: 'REQUIRES_RECONCILIATION',
    error: input.error,
  });
  await upsertFinanceReconciliationIssue({
    contaId: input.contaId,
    entityType: input.resource,
    entityId: input.entityId,
    asaasId: null,
    issueType: 'BILLING_OPERATION_UNCERTAIN',
    severity: 'CRITICAL',
    localStatus: 'REQUIRES_RECONCILIATION',
    remoteStatus: null,
    metadata: {
      jobId: input.jobId,
      externalReference: input.externalReference,
      source: 'outbound-financial-operation-dlq',
    },
  });
  return job;
}

/** Confirma o comando de criação pelo canal oficial (webhook), inclusive após timeout do POST. */
export async function confirmOutboundCreateByProviderEvent(input: {
  contaId: string;
  resource: OutboundFinancialResource;
  remoteId?: string | null;
  externalReference?: string | null;
  eventName: string;
}) {
  const typeByResource: Record<OutboundFinancialResource, AsaasIntegrationJobType> = {
    PAYMENT: 'CREATE_PAYMENT',
    SUBSCRIPTION: 'CREATE_SUBSCRIPTION',
    INSTALLMENT_PLAN: 'CREATE_INSTALLMENT',
  };
  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      contaId: input.contaId,
      type: typeByResource[input.resource],
      status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  let confirmed = 0;
  for (const job of jobs) {
    const payload = parseOutboundFinancialOperation(job.payload);
    if (!payload) continue;
    const matchesRemote = Boolean(input.remoteId && payload.remoteId === input.remoteId);
    const matchesReference = Boolean(
      input.externalReference && payload.externalReference === input.externalReference,
    );
    if (!matchesRemote && !matchesReference) continue;
    await markOutboundSynchronized(job.id, input.remoteId ?? payload.remoteId, {
      confirmedByEvent: input.eventName,
    });
    confirmed += 1;
  }
  return confirmed;
}
