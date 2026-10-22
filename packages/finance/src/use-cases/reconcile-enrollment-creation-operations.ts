import { EnrollmentCreationOperationStatus, Prisma } from '@prisma/client';
import { prisma, runWithTenant } from '@alusa/database';

import { upsertFinanceReconciliationIssue } from '../reconciliation/finance-reconciliation-issue.service';
import { findTerminalEnrollmentPaymentEvidence } from '../webhooks/enrollment-payment-evidence';
import { compensateStagedEnrollmentFinancialResources } from './stage-enrollment-financial-resources';

const RECOVERY_LEASE_MS = 5 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 8;
const RETRY_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

function snapshotExpectsEnrollmentFee(snapshot: Prisma.JsonValue) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const value = snapshot as Prisma.JsonObject;
  return (
    value.gerarCobrancaTaxa === true &&
    value.taxaIsenta !== true &&
    typeof value.taxaMatricula === 'number' &&
    value.taxaMatricula > 0
  );
}

async function confirmedOutboundResourceIds(contaId: string, operationId: string) {
  const jobs = await runWithTenant(contaId, (tx) => tx.asaasIntegrationJob.findMany({
    where: {
      contaId,
      type: { in: ['CREATE_PAYMENT', 'CREATE_SUBSCRIPTION'] },
      payload: { path: ['entityId'], equals: operationId },
    },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  }));
  const ids = {
    subscriptionId: null as string | null,
    firstSubscriptionPaymentId: null as string | null,
    enrollmentFeePaymentId: null as string | null,
    feeAttemptObserved: false,
  };
  for (const job of jobs) {
    if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) continue;
    const payload = job.payload as Prisma.JsonObject;
    const state = payload.state;
    const confirmed = state === 'REMOTE_CONFIRMED' || state === 'AWAITING_WEBHOOK' || state === 'SYNCHRONIZED';
    const remoteId = typeof payload.remoteId === 'string' ? payload.remoteId : null;
    if (payload.resource === 'SUBSCRIPTION' &&
      payload.externalReference === `enrollment-op:${operationId}:subscription` && confirmed && remoteId) {
      ids.subscriptionId ??= remoteId;
    }
    if (payload.resource === 'PAYMENT' &&
      payload.externalReference === `enrollment-op:${operationId}:subscription` && confirmed && remoteId) {
      ids.firstSubscriptionPaymentId ??= remoteId;
    }
    if (payload.resource === 'PAYMENT' &&
      payload.externalReference === `enrollment-op:${operationId}:fee`) {
      ids.feeAttemptObserved = true;
      if (confirmed && remoteId) ids.enrollmentFeePaymentId ??= remoteId;
    }
  }
  return ids;
}

export async function reconcileEnrollmentCreationOperations(input: {
  contaId?: string | null;
  limit?: number;
  olderThanSeconds?: number;
}) {
  const now = new Date();
  const minimumAgeMs = Math.max(30, input.olderThanSeconds ?? 300) * 1000;
  const eligibility = RETRY_BACKOFF_MS.map((backoffMs, index) => ({
    attempts: index === 0 ? 0 : { gte: index, lt: index + 1 },
    updatedAt: { lte: new Date(now.getTime() - Math.max(minimumAgeMs, backoffMs)) },
  }));
  // O cron é um scheduler privilegiado cross-tenant: a seleção global só encontra
  // candidatos. Cada item é reivindicado em seguida com CAS dentro de runWithTenant,
  // e evidências/recursos financeiros são consultados novamente no tenant da operação.
  const operations = await prisma.enrollmentCreationOperation.findMany({
    where: {
      ...(input.contaId ? { contaId: input.contaId } : {}),
      status: {
        in: [
          EnrollmentCreationOperationStatus.PROCESSING,
          EnrollmentCreationOperationStatus.REMOTE_PROVISIONED,
          EnrollmentCreationOperationStatus.COMPENSATING,
          EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
        ],
      },
      AND: [
        {
          OR: [
            {
              status: { not: EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION },
              attempts: { lt: MAX_AUTOMATIC_ATTEMPTS },
              OR: eligibility,
            },
            {
              status: EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
              attempts: { lt: MAX_AUTOMATIC_ATTEMPTS },
              lastError: { in: ['REMOTE_CREATION_RESULT_STILL_UNCERTAIN', 'REMOTE_VERIFICATION_TRANSIENT'] },
              OR: eligibility,
            },
            { lastError: 'WEBHOOK_EVIDENCE' },
            { status: EnrollmentCreationOperationStatus.COMPENSATING, attempts: { gte: MAX_AUTOMATIC_ATTEMPTS } },
          ],
        },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(input.limit ?? 50, 200)),
    select: {
      id: true,
      contaId: true,
      uiRequestId: true,
      status: true,
      version: true,
      attempts: true,
      leaseExpiresAt: true,
      requestSnapshot: true,
      asaasSubscriptionId: true,
      asaasFirstPaymentId: true,
      asaasEnrollmentFeePaymentId: true,
      result: true,
    },
  });

  const summary = { inspected: operations.length, committed: 0, compensated: 0, attention: 0, suspended: 0, waiting: 0 };
  for (const operation of operations) {
    if (
      operation.status === EnrollmentCreationOperationStatus.COMPENSATING &&
      operation.attempts >= MAX_AUTOMATIC_ATTEMPTS
    ) {
      const suspended = await runWithTenant(operation.contaId, (tx) =>
        tx.enrollmentCreationOperation.updateMany({
          where: {
            id: operation.id,
            contaId: operation.contaId,
            version: operation.version,
            status: EnrollmentCreationOperationStatus.COMPENSATING,
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
          data: {
            status: EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
            lastError: 'AUTOMATIC_RECONCILIATION_ATTEMPTS_EXHAUSTED',
            lockedAt: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
          },
        }),
      );
      if (suspended.count === 1) {
        summary.attention += 1;
        summary.suspended += 1;
      }
      continue;
    }
    const leaseExpiresAt = new Date(Date.now() + RECOVERY_LEASE_MS);
    const claimed = await runWithTenant(operation.contaId, (tx) =>
      tx.enrollmentCreationOperation.updateMany({
        where: {
          id: operation.id,
          contaId: operation.contaId,
          version: operation.version,
          status: operation.status,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          status: EnrollmentCreationOperationStatus.COMPENSATING,
          version: { increment: 1 },
          attempts: { increment: 1 },
          lockedAt: new Date(),
          leaseExpiresAt,
          lastAttemptAt: new Date(),
          lastError: null,
        },
      }),
    );
    if (claimed.count !== 1) continue;
    const recoveryVersion = operation.version + 1;

    const matricula = await runWithTenant(operation.contaId, (tx) =>
      tx.matricula.findFirst({
        where: { contaId: operation.contaId, uiRequestId: operation.uiRequestId },
        select: { id: true, asaasSubscriptionId: true },
      }),
    );
    if (matricula) {
      const remoteMatches =
        Boolean(operation.asaasSubscriptionId) &&
        matricula.asaasSubscriptionId === operation.asaasSubscriptionId;
      await runWithTenant(operation.contaId, (tx) =>
        tx.enrollmentCreationOperation.updateMany({
          where: {
            id: operation.id,
            contaId: operation.contaId,
            version: recoveryVersion,
            status: EnrollmentCreationOperationStatus.COMPENSATING,
          },
          data: remoteMatches
            ? {
                status: EnrollmentCreationOperationStatus.COMMITTED,
                matriculaId: matricula.id,
                completedAt: new Date(),
                lockedAt: null,
                leaseExpiresAt: null,
              }
            : {
                status: EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
                lastError: 'LOCAL_ENROLLMENT_REMOTE_RESOURCES_MISMATCH',
                lockedAt: null,
                leaseExpiresAt: null,
              },
        }),
      );
      if (remoteMatches) summary.committed += 1;
      else summary.attention += 1;
      continue;
    }

    const terminalPaymentEvidence = findTerminalEnrollmentPaymentEvidence(operation.result, [
      operation.asaasFirstPaymentId,
      operation.asaasEnrollmentFeePaymentId,
    ]);
    if (terminalPaymentEvidence) {
      await upsertFinanceReconciliationIssue({
        contaId: operation.contaId,
        entityType: 'PAYMENT',
        entityId: operation.id,
        asaasId: typeof terminalPaymentEvidence.paymentId === 'string' ? terminalPaymentEvidence.paymentId : null,
        issueType: 'BILLING_OPERATION_UNCERTAIN',
        severity: 'CRITICAL',
        localStatus: null,
        remoteStatus: typeof terminalPaymentEvidence.status === 'string'
          ? terminalPaymentEvidence.status
          : typeof terminalPaymentEvidence.event === 'string' ? terminalPaymentEvidence.event : null,
        causeId: typeof terminalPaymentEvidence.eventId === 'string' ? terminalPaymentEvidence.eventId : null,
        metadata: {
          source: 'enrollment-creation-reconciler',
          reason: 'TERMINAL_PAYMENT_WEBHOOK_EVIDENCE',
          operationId: operation.id,
        },
      });
      await runWithTenant(operation.contaId, (tx) =>
        tx.enrollmentCreationOperation.updateMany({
          where: {
            id: operation.id,
            contaId: operation.contaId,
            version: recoveryVersion,
            status: EnrollmentCreationOperationStatus.COMPENSATING,
          },
          data: {
            status: EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
            lastError: 'TERMINAL_PAYMENT_WEBHOOK_EVIDENCE',
            lockedAt: null,
            leaseExpiresAt: null,
          },
        }),
      );
      summary.attention += 1;
      summary.suspended += 1;
      continue;
    }

    const outboundEvidence = await confirmedOutboundResourceIds(operation.contaId, operation.id);
    const expectedEnrollmentFee = snapshotExpectsEnrollmentFee(operation.requestSnapshot);
    const compensation = await compensateStagedEnrollmentFinancialResources({
      contaId: operation.contaId,
      operationId: operation.id,
      asaasSubscriptionId: operation.asaasSubscriptionId ?? outboundEvidence.subscriptionId,
      firstSubscriptionPaymentId: operation.asaasFirstPaymentId ?? outboundEvidence.firstSubscriptionPaymentId,
      enrollmentFeePaymentId: operation.asaasEnrollmentFeePaymentId ?? outboundEvidence.enrollmentFeePaymentId,
      discoverFeeByOperationId: expectedEnrollmentFee || outboundEvidence.feeAttemptObserved,
    });
    const remoteAbsenceStillUncertain =
      !compensation.deletedSubscriptionId ||
      !compensation.deletedFirstSubscriptionPaymentId ||
      ((expectedEnrollmentFee || outboundEvidence.feeAttemptObserved) &&
        !compensation.deletedEnrollmentFeePaymentId);
    // Uma busca concluída vazia não prova que o POST original não foi aceito.
    // Compensação só pode concluir quando houve IDs confirmados e removidos.
    const safelyCompensated = compensation.complete && !remoteAbsenceStillUncertain &&
      Boolean(compensation.deletedSubscriptionId) && Boolean(compensation.deletedFirstSubscriptionPaymentId);
    const retryTransientVerification = compensation.discovery?.retryable === true &&
      operation.attempts + 1 < MAX_AUTOMATIC_ATTEMPTS;
    const transientVerificationFailed = compensation.discovery?.retryable === true;
    const suspendedForUncertainty = !safelyCompensated && !retryTransientVerification;
    await runWithTenant(operation.contaId, (tx) =>
      tx.enrollmentCreationOperation.updateMany({
        where: {
          id: operation.id,
          contaId: operation.contaId,
          version: recoveryVersion,
          status: EnrollmentCreationOperationStatus.COMPENSATING,
        },
        data: {
          status: safelyCompensated
            ? EnrollmentCreationOperationStatus.COMPENSATED
            : EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
          compensatedAt: safelyCompensated ? new Date() : null,
          lastError: safelyCompensated
            ? null
            : transientVerificationFailed
              ? 'REMOTE_VERIFICATION_TRANSIENT'
              : remoteAbsenceStillUncertain
                ? 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN'
                : 'AUTOMATIC_COMPENSATION_INCOMPLETE',
          result: {
            ...(operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result)
              ? operation.result as Prisma.JsonObject
              : {}),
            compensation,
            outboundEvidence,
          } as Prisma.InputJsonValue,
          asaasSubscriptionId:
            operation.asaasSubscriptionId ?? outboundEvidence.subscriptionId ?? compensation.deletedSubscriptionId ?? undefined,
          asaasFirstPaymentId:
            operation.asaasFirstPaymentId ?? outboundEvidence.firstSubscriptionPaymentId ?? compensation.deletedFirstSubscriptionPaymentId ?? undefined,
          asaasEnrollmentFeePaymentId:
            operation.asaasEnrollmentFeePaymentId ?? outboundEvidence.enrollmentFeePaymentId ?? compensation.deletedEnrollmentFeePaymentId ?? undefined,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }),
    );
    if (safelyCompensated) summary.compensated += 1;
    else if (retryTransientVerification) summary.waiting += 1;
    else {
      summary.attention += 1;
      if (suspendedForUncertainty) summary.suspended += 1;
    }
  }

  return summary;
}
