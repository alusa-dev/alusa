import { EnrollmentCreationOperationStatus, Prisma } from '@prisma/client';
import { compensateStagedEnrollmentFinancialResources } from '@alusa/finance';

import { runWithTenant } from '@/lib/prisma-tenant';
import { prisma } from '@/src/prisma';

const RECOVERY_LEASE_MS = 5 * 60 * 1000;

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

async function enrollmentFeeCreationWasDefinitivelyRejected(contaId: string, operationId: string) {
  const job = await runWithTenant(contaId, (tx) =>
    tx.asaasIntegrationJob.findFirst({
      where: {
        contaId,
        type: 'CREATE_PAYMENT',
        status: 'FAILED',
        payload: { path: ['entityId'], equals: operationId },
      },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    }),
  );
  if (!job?.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) return false;
  const payload = job.payload as Prisma.JsonObject;
  return payload.state === 'FAILED' && !payload.remoteId;
}

export async function reconcileEnrollmentCreationOperations(input: {
  contaId?: string | null;
  limit?: number;
  olderThanSeconds?: number;
}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(30, input.olderThanSeconds ?? 300) * 1000);
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
      updatedAt: { lte: cutoff },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(input.limit ?? 50, 200)),
  });

  const summary = { inspected: operations.length, committed: 0, compensated: 0, attention: 0 };
  for (const operation of operations) {
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
          where: { id: operation.id, contaId: operation.contaId, version: recoveryVersion },
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

    const compensation = await compensateStagedEnrollmentFinancialResources({
      contaId: operation.contaId,
      operationId: operation.id,
      asaasSubscriptionId: operation.asaasSubscriptionId,
      firstSubscriptionPaymentId: operation.asaasFirstPaymentId,
      enrollmentFeePaymentId: operation.asaasEnrollmentFeePaymentId,
    });
    const expectedEnrollmentFee = snapshotExpectsEnrollmentFee(operation.requestSnapshot);
    const feeCreationProvenAbsent =
      expectedEnrollmentFee && !compensation.deletedEnrollmentFeePaymentId
        ? await enrollmentFeeCreationWasDefinitivelyRejected(operation.contaId, operation.id)
        : false;
    const remoteAbsenceStillUncertain =
      !compensation.deletedSubscriptionId ||
      !compensation.deletedFirstSubscriptionPaymentId ||
      (expectedEnrollmentFee &&
        !compensation.deletedEnrollmentFeePaymentId &&
        !feeCreationProvenAbsent);
    const safelyCompensated = compensation.complete && !remoteAbsenceStillUncertain;
    await runWithTenant(operation.contaId, (tx) =>
      tx.enrollmentCreationOperation.updateMany({
        where: { id: operation.id, contaId: operation.contaId, version: recoveryVersion },
        data: {
          status: safelyCompensated
            ? EnrollmentCreationOperationStatus.COMPENSATED
            : EnrollmentCreationOperationStatus.REQUIRES_RECONCILIATION,
          compensatedAt: safelyCompensated ? new Date() : null,
          lastError: safelyCompensated
            ? null
            : remoteAbsenceStillUncertain
              ? 'REMOTE_CREATION_RESULT_STILL_UNCERTAIN'
              : 'AUTOMATIC_COMPENSATION_INCOMPLETE',
          result: { compensation } as Prisma.InputJsonValue,
          lockedAt: null,
          leaseExpiresAt: null,
        },
      }),
    );
    if (safelyCompensated) summary.compensated += 1;
    else summary.attention += 1;
  }

  return summary;
}
