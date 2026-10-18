import { prisma } from '@alusa/database';
import type { AsaasIntegrationJobType, Prisma } from '@prisma/client';

import {
  buildFinanceReconciliationIssueDedupeKey,
  resolveFinanceReconciliationIssueByDedupe,
  upsertFinanceReconciliationIssue,
} from '../reconciliation/finance-reconciliation-issue.service';

export type OutboundFinancialOperationState =
  | 'INTENT_CREATED'
  | 'REMOTE_REQUESTED'
  | 'REMOTE_CONFIRMED'
  | 'AWAITING_WEBHOOK'
  | 'SYNCHRONIZED'
  | 'RESULT_UNKNOWN'
  | 'REQUIRES_RECONCILIATION'
  | 'FAILED';

export type OutboundFinancialResource = 'PAYMENT' | 'SUBSCRIPTION' | 'INSTALLMENT_PLAN' | 'CUSTOMER';

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

const TRANSITION_PRECEDENCE: Partial<Record<OutboundFinancialOperationState, number>> = {
  INTENT_CREATED: 0,
  REMOTE_REQUESTED: 1,
  RESULT_UNKNOWN: 2,
  FAILED: 2,
  REMOTE_CONFIRMED: 3,
  AWAITING_WEBHOOK: 4,
  SYNCHRONIZED: 5,
  REQUIRES_RECONCILIATION: 6,
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
  type: Extract<AsaasIntegrationJobType, 'CREATE_PAYMENT' | 'CREATE_SUBSCRIPTION' | 'CREATE_INSTALLMENT' | 'CREATE_CUSTOMER'>;
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
  if (existingPayload && existingPayload.externalReference !== input.externalReference) {
    throw new Error('OUTBOUND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_EXTERNAL_REFERENCE');
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
  if (persisted.externalReference !== input.externalReference) {
    throw new Error('OUTBOUND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_EXTERNAL_REFERENCE');
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
  // Retry only when another nonterminal writer wins. The status predicate is
  // a compare-and-set: a webhook changing PROCESSING to DONE makes this write
  // lose, so its terminal payload cannot be replaced with a stale snapshot.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await prisma.asaasIntegrationJob.findUnique({
      where: { id: input.jobId },
      select: { payload: true, status: true },
    });
    const payload = current ? parseOutboundFinancialOperation(current.payload) : null;
    if (!current || !payload) throw new Error('OUTBOUND_OPERATION_NOT_FOUND');

    if (current.status === 'DONE') {
      return prisma.asaasIntegrationJob.findUniqueOrThrow({ where: { id: input.jobId } });
    }
    const currentPrecedence = TRANSITION_PRECEDENCE[payload.state];
    const requestedPrecedence = TRANSITION_PRECEDENCE[input.state];
    // A timeout/reconciliation worker may have read a stale snapshot while a
    // provider confirmation advanced the same PROCESSING job. Keep the newer
    // state; reconciliation mismatches remain an explicit operator override.
    if (
      input.state !== 'REQUIRES_RECONCILIATION' &&
      (payload.state === 'REQUIRES_RECONCILIATION' ||
      currentPrecedence !== undefined &&
      requestedPrecedence !== undefined &&
      currentPrecedence > requestedPrecedence)
    ) {
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
    const updated = await prisma.asaasIntegrationJob.updateMany({
      where: { id: input.jobId, status: current.status, payload: { equals: asJson(payload) } },
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
    if (updated.count === 1) {
      return prisma.asaasIntegrationJob.findUniqueOrThrow({ where: { id: input.jobId } });
    }
  }

  // Bounded CAS retries can be exhausted by repeated concurrent writers. Read
  // the winner and preserve it; never fall back to an unconditional update.
  return prisma.asaasIntegrationJob.findUniqueOrThrow({ where: { id: input.jobId } });
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
  const persistedState = parseOutboundFinancialOperation(job.payload)?.state;
  if (
    job.status === 'DONE' ||
    persistedState === 'REQUIRES_RECONCILIATION' ||
    (persistedState !== undefined && (TRANSITION_PRECEDENCE[persistedState] ?? -1) > (TRANSITION_PRECEDENCE.RESULT_UNKNOWN ?? 0))
  ) {
    return job;
  }
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
  await reconcileOperationIssueAfterWrite(input, 'HIGH');
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
  if (job.status === 'DONE' || parseOutboundFinancialOperation(job.payload)?.state === 'SYNCHRONIZED') {
    return job;
  }
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
  await reconcileOperationIssueAfterWrite(input, 'CRITICAL');
  return job;
}

async function reconcileOperationIssueAfterWrite(
  input: { jobId: string; contaId: string; resource: OutboundFinancialResource; entityId: string },
  requestedSeverity: 'HIGH' | 'CRITICAL',
) {
  // A provider event can synchronize between the caller's transition and
  // issue persistence. Re-read after upsert so either ordering converges.
  const current = await prisma.asaasIntegrationJob.findUnique({
    where: { id: input.jobId },
    select: { contaId: true, status: true, payload: true },
  });
  if (!current || current.contaId !== input.contaId) return;
  const state = parseOutboundFinancialOperation(current.payload)?.state;
  const dedupeKey = buildFinanceReconciliationIssueDedupeKey({
    entityType: input.resource,
    entityId: input.entityId,
    issueType: 'BILLING_OPERATION_UNCERTAIN',
  });
  if (current.status === 'DONE' || state === 'SYNCHRONIZED') {
    await resolveFinanceReconciliationIssueByDedupe({
      contaId: input.contaId,
      dedupeKey,
      resolution: 'Provider confirmation synchronized the outbound operation.',
    });
    return;
  }
  if (state === 'REQUIRES_RECONCILIATION' && requestedSeverity === 'HIGH') {
    await upsertFinanceReconciliationIssue({
      contaId: input.contaId,
      entityType: input.resource,
      entityId: input.entityId,
      asaasId: null,
      issueType: 'BILLING_OPERATION_UNCERTAIN',
      severity: 'CRITICAL',
      localStatus: 'REQUIRES_RECONCILIATION',
      remoteStatus: null,
      metadata: { jobId: input.jobId, source: 'outbound-financial-operation-dlq' },
    });
  }
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
    CUSTOMER: 'CREATE_CUSTOMER',
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
    // Once the job has a provider ID, the external reference cannot identify
    // a different remote resource. Use it only to recover jobs whose POST
    // timed out before an ID was persisted.
    const matchesReference = Boolean(
      !payload.remoteId && input.externalReference && payload.externalReference === input.externalReference,
    );
    if (!matchesRemote && !matchesReference) continue;
    const synchronizedJob = await markOutboundSynchronized(job.id, input.remoteId ?? payload.remoteId, {
      confirmedByEvent: input.eventName,
    });
    const synchronizedPayload = parseOutboundFinancialOperation(synchronizedJob.payload);
    if (synchronizedJob.status === 'DONE' || synchronizedPayload?.state === 'SYNCHRONIZED') {
      await resolveFinanceReconciliationIssueByDedupe({
        contaId: input.contaId,
        dedupeKey: buildFinanceReconciliationIssueDedupeKey({
          entityType: input.resource,
          entityId: payload.entityId,
          issueType: 'BILLING_OPERATION_UNCERTAIN',
        }),
        resolution: 'Provider confirmation synchronized the outbound operation.',
      });
    }
    confirmed += 1;
  }
  return confirmed;
}
