import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';
import { acquireBillingAgreementMutationLease, releaseBillingAgreementMutationLease, startBillingAgreementMutationLeaseHeartbeat } from './mutation-lease';
import { randomUUID } from 'node:crypto';

const LEASE_MS = 5 * 60 * 1000;

type AgreementWithAllocations = Prisma.BillingAgreementGetPayload<{
  include: { allocations: true };
}>;

type ScheduledRemoteResult = {
  agreement: AgreementWithAllocations;
  targetCents: number;
  cancelling: boolean;
  resultingSubscriptionId: string | null;
  remoteStatus: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
};

function money(value: number) {
  return Number((value / 100).toFixed(2));
}

function providerEndDate(exclusiveEnd: Date | null) {
  if (!exclusiveEnd) return undefined;
  const date = new Date(exclusiveEnd);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Aplica alterações NEXT_CYCLE vencidas sem tocar cobranças já geradas. */
export async function processDueBillingAgreementChanges(input?: {
  contaId?: string;
  limit?: number;
  now?: Date;
}) {
  const now = input?.now ?? new Date();
  const rows = await prisma.billingChangeOperation.findMany({
    where: {
      ...(input?.contaId ? { contaId: input.contaId } : {}),
      status: 'COMPLETED',
      effectivePolicy: 'NEXT_CYCLE',
      effectiveAt: { lte: now },
      scheduledAppliedAt: null,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ effectiveAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(input?.limit ?? 25, 1), 100),
  });
  const asaas = createAsaasBillingAgreementPort();
  let applied = 0;
  let uncertain = 0;

  for (const operation of rows) {
    const operationClaimToken = randomUUID();
    const initialOperationLeaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const claimed = await prisma.billingChangeOperation.updateMany({
      where: {
        id: operation.id,
        contaId: operation.contaId,
        status: 'COMPLETED',
        scheduledAppliedAt: null,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        claimToken: operationClaimToken,
        lockedAt: now,
        leaseExpiresAt: initialOperationLeaseExpiresAt,
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) continue;
    if (!operation.sourceAgreementId) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: operation.id, contaId: operation.contaId, status: 'COMPLETED', scheduledAppliedAt: null, claimToken: operationClaimToken },
        data: { claimToken: null, lockedAt: null, leaseExpiresAt: null },
      });
      continue;
    }
    let operationLeaseExpiresAt = initialOperationLeaseExpiresAt;
    let operationLeaseLost = false;
    let operationRenewal = Promise.resolve();
    const operationLeaseHeartbeat = setInterval(() => {
      if (operationLeaseLost) return;
      operationRenewal = operationRenewal.then(async () => {
        const previousExpiresAt = operationLeaseExpiresAt;
        const nextExpiresAt = new Date(Date.now() + LEASE_MS);
        const result = await prisma.billingChangeOperation.updateMany({
          where: {
            id: operation.id,
            contaId: operation.contaId,
            status: 'COMPLETED',
            scheduledAppliedAt: null,
            claimToken: operationClaimToken,
            AND: [{ leaseExpiresAt: previousExpiresAt }, { leaseExpiresAt: { gt: new Date() } }],
          },
          data: { leaseExpiresAt: nextExpiresAt },
        });
        if (result.count !== 1) operationLeaseLost = true;
        else operationLeaseExpiresAt = nextExpiresAt;
      }).catch(() => { operationLeaseLost = true; });
    }, Math.max(1_000, Math.floor(LEASE_MS / 3)));
    operationLeaseHeartbeat.unref?.();
    const assertOperationLeaseOwned = async () => {
      await operationRenewal;
      if (operationLeaseLost) throw new Error('BILLING_CHANGE_OPERATION_LEASE_LOST');
      const result = await prisma.billingChangeOperation.count({
        where: {
          id: operation.id,
          contaId: operation.contaId,
          status: 'COMPLETED',
          scheduledAppliedAt: null,
          claimToken: operationClaimToken,
          leaseExpiresAt: { gt: new Date() },
        },
      });
      if (result !== 1) throw new Error('BILLING_CHANGE_OPERATION_LEASE_LOST');
    };

    const agreementIds = [operation.sourceAgreementId, operation.targetAgreementId].filter(
        (id): id is string => Boolean(id),
      );
    const leaseToken = `billing-scheduled:${operation.id}:${randomUUID()}`;
    const leaseAcquired = await acquireBillingAgreementMutationLease({
      contaId: operation.contaId,
      agreementIds,
      leaseToken,
      now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    });
    if (!leaseAcquired) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: operation.id, contaId: operation.contaId, scheduledAppliedAt: null, claimToken: operationClaimToken, leaseExpiresAt: { gt: new Date() } },
        data: { claimToken: null, lockedAt: null, leaseExpiresAt: null },
      });
      clearInterval(operationLeaseHeartbeat);
      continue;
    }
    const heartbeat = startBillingAgreementMutationLeaseHeartbeat({ contaId: operation.contaId, agreementIds, leaseToken, leaseMs: LEASE_MS, ...(input?.now ? { clock: () => now } : {}) });
    const expectedAgreementVersions = new Map<string, number>();
    try {
      const agreements = await prisma.billingAgreement.findMany({
        where: { id: { in: agreementIds }, contaId: operation.contaId },
        include: { allocations: true },
      });
      if (agreements.length !== agreementIds.length) throw new Error('ACORDO_AGENDADO_NAO_ENCONTRADO');
      for (const agreement of agreements) expectedAgreementVersions.set(agreement.id, agreement.version);
      const effectiveAt = operation.effectiveAt;
      const remoteResults: ScheduledRemoteResult[] = [];
      for (const agreement of agreements) {
        const relevantAllocations = agreement.allocations.filter((allocation) =>
          allocation.recurring &&
          allocation.status !== 'CANCELLED' &&
          (allocation.validUntil === null || allocation.validUntil > effectiveAt),
        );
        const effectiveAllocations = relevantAllocations.filter((allocation) =>
            allocation.recurring &&
            allocation.validFrom <= effectiveAt &&
            (allocation.validUntil === null || allocation.validUntil > effectiveAt),
        );
        const targetCents = effectiveAllocations
          .reduce((sum, allocation) => sum + Math.round(Number(allocation.netAmount) * 100), 0);
        const validFrom = relevantAllocations.length > 0
          ? new Date(Math.min(...relevantAllocations.map((allocation) => allocation.validFrom.getTime())))
          : null;
        const validUntil = relevantAllocations.length === 0 || relevantAllocations.some((allocation) => allocation.validUntil === null)
          ? null
          : new Date(Math.max(...relevantAllocations.map((allocation) => allocation.validUntil!.getTime())));
        const cancelling = operation.type === 'CANCEL' && agreement.id === operation.sourceAgreementId;
        let resultingSubscriptionId = agreement.asaasSubscriptionId;
        let remoteStatus = agreement.remoteStatus;
        if (agreement.asaasSubscriptionId) {
          if (cancelling) {
            await heartbeat.assertOwned();
            await assertOperationLeaseOwned();
            await asaas.deleteSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
            });
            resultingSubscriptionId = null;
            remoteStatus = 'DELETED';
          } else {
            await heartbeat.assertOwned();
            await assertOperationLeaseOwned();
            const current = await asaas.getSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
            });
            const targetEndDate = providerEndDate(validUntil);
            if (!targetEndDate && current.endDate) {
              throw new Error('ASSINATURA_COM_TERMINO_NAO_PODE_SER_REABERTA_SEM_SUBSTITUICAO');
            }
            const status = operation.type === 'PAUSE_AGREEMENT' || targetCents === 0 ? 'INACTIVE' : 'ACTIVE';
            const resumeNextDueDate =
              (operation.type === 'RESUME_AGREEMENT' || operation.type === 'RESUME_ALLOCATION') &&
              agreement.nextDueDate &&
              agreement.nextDueDate >= effectiveAt
                ? agreement.nextDueDate.toISOString().slice(0, 10)
                : undefined;
            await heartbeat.assertOwned();
            await assertOperationLeaseOwned();
            await asaas.updateSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
              valueCents: targetCents === 0 ? current.valueCents : targetCents,
              updatePendingPayments: false,
              status,
              ...(resumeNextDueDate ? { nextDueDate: resumeNextDueDate } : {}),
              ...(targetEndDate ? { endDate: targetEndDate } : {}),
            });
            await heartbeat.assertOwned();
            await assertOperationLeaseOwned();
            const confirmed = await asaas.getSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
            });
            if (
              confirmed.deleted ||
              confirmed.status !== status ||
              (targetCents > 0 && confirmed.valueCents !== targetCents) ||
              (targetEndDate && confirmed.endDate !== targetEndDate)
            ) {
              throw new Error('RESULTADO_REMOTO_AGENDADO_NAO_CONFIRMADO');
            }
            remoteStatus = confirmed.status;
          }
        } else if (targetCents > 0) {
          throw new Error('ASSINATURA_REMOTA_AUSENTE_PARA_ALTERACAO_AGENDADA');
        }
        remoteResults.push({
          agreement,
          targetCents,
          cancelling,
          resultingSubscriptionId,
          remoteStatus,
          validFrom,
          validUntil,
        });
      }

      await heartbeat.assertOwned();
      await assertOperationLeaseOwned();
      await prisma.$transaction(async (tx) => {
        await heartbeat.assertOwned();
        await assertOperationLeaseOwned();
        for (const result of remoteResults) {
          await tx.billingAllocation.updateMany({
            where: { contaId: operation.contaId, agreementId: result.agreement.id, status: 'SCHEDULED', validFrom: { lte: effectiveAt } },
            data: { status: 'ACTIVE' },
          });
          await tx.billingAllocation.updateMany({
            where: { contaId: operation.contaId, agreementId: result.agreement.id, status: { in: ['ACTIVE', 'SCHEDULED'] }, validUntil: { lte: effectiveAt } },
            data: {
              status: result.cancelling
                ? 'CANCELLED'
                : operation.type === 'PAUSE_ALLOCATION'
                  ? 'PAUSED'
                  : 'ENDED',
            },
          });
          const updated = await tx.billingAgreement.updateMany({
            where: { id: result.agreement.id, contaId: operation.contaId, version: result.agreement.version, mutationLeaseToken: leaseToken },
            data: {
              desiredValue: money(result.targetCents),
              validFrom: result.validFrom ?? undefined,
              validUntil: result.validUntil,
              confirmedValue: result.cancelling ? 0 : result.targetCents === 0 ? undefined : money(result.targetCents),
              asaasSubscriptionId: result.resultingSubscriptionId,
              remoteStatus: result.remoteStatus,
              remoteStatusUpdatedAt: now,
              lastReconciledAt: now,
              reconciliationError: null,
              status:
                result.cancelling
                  ? 'CANCELLED'
                  : operation.type === 'PAUSE_AGREEMENT' || result.targetCents === 0
                    ? 'INACTIVE'
                    : 'ACTIVE',
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new Error('VERSAO_DO_ACORDO_AGENDADO_DIVERGIU');
        }
        const operationApplied = await tx.billingChangeOperation.updateMany({
          where: { id: operation.id, contaId: operation.contaId, scheduledAppliedAt: null, status: 'COMPLETED', claimToken: operationClaimToken, leaseExpiresAt: { gt: new Date() } },
          data: { scheduledAppliedAt: now, claimToken: null, lockedAt: null, leaseExpiresAt: null, lastError: null },
        });
        if (operationApplied.count !== 1) throw new Error('BILLING_CHANGE_OPERATION_LEASE_LOST');
      });
      applied += 1;
    } catch (error) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: operation.id, contaId: operation.contaId, scheduledAppliedAt: null, status: 'COMPLETED', claimToken: operationClaimToken, leaseExpiresAt: { gt: new Date() } },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          claimToken: null,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: `SCHEDULED_APPLY: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000),
        },
      });
      if (expectedAgreementVersions.has(operation.sourceAgreementId)) {
        await prisma.billingAgreement.updateMany({
          where: { id: operation.sourceAgreementId, contaId: operation.contaId, version: expectedAgreementVersions.get(operation.sourceAgreementId), mutationLeaseToken: leaseToken },
          data: { status: 'REQUIRES_RECONCILIATION', reconciliationError: 'Falha ao aplicar alteração agendada.' },
        });
      }
      if (operation.targetAgreementId && expectedAgreementVersions.has(operation.targetAgreementId)) {
        await prisma.billingAgreement.updateMany({
          where: { id: operation.targetAgreementId, contaId: operation.contaId, version: expectedAgreementVersions.get(operation.targetAgreementId), mutationLeaseToken: leaseToken },
          data: { status: 'REQUIRES_RECONCILIATION', reconciliationError: 'Falha ao aplicar alteração agendada.' },
        });
      }
      uncertain += 1;
    } finally {
      clearInterval(operationLeaseHeartbeat);
      await heartbeat.stop();
      await releaseBillingAgreementMutationLease({ contaId: operation.contaId, agreementIds, leaseToken });
    }
  }
  return { found: rows.length, applied, uncertain };
}

/**
 * Encerra alocações cuja vigência terminou e reduz a assinatura consolidada.
 * `validUntil` é exclusivo: uma matrícula com fim em 31/10 deixa de compor a
 * cobrança a partir de 01/11. A alteração remota é confirmada antes da projeção
 * local, para que uma falha nunca reduza somente o banco da Alusa.
 */
export async function processExpiredBillingAllocations(input?: {
  contaId?: string;
  limit?: number;
  now?: Date;
}) {
  const now = input?.now ?? new Date();
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 100);
  const agreements = await prisma.billingAgreement.findMany({
    where: {
      ...(input?.contaId ? { contaId: input.contaId } : {}),
      status: { in: ['ACTIVE', 'REQUIRES_RECONCILIATION'] },
      allocations: {
        some: {
          recurring: true,
          kind: 'TUITION',
          status: { in: ['ACTIVE', 'SCHEDULED'] },
          validUntil: { lte: now },
        },
      },
    },
    select: { id: true, contaId: true },
    take: limit,
    orderBy: { updatedAt: 'asc' },
  });
  const asaas = createAsaasBillingAgreementPort();
  let applied = 0;
  let uncertain = 0;

  for (const candidate of agreements) {
    const leaseToken = `billing-expiry:${candidate.id}:${randomUUID()}`;
    const leaseAcquired = await acquireBillingAgreementMutationLease({ contaId: candidate.contaId, agreementIds: [candidate.id], leaseToken, now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) });
    if (!leaseAcquired) continue;
    const heartbeat = startBillingAgreementMutationLeaseHeartbeat({ contaId: candidate.contaId, agreementIds: [candidate.id], leaseToken, leaseMs: LEASE_MS, ...(input?.now ? { clock: () => now } : {}) });
    let agreement: AgreementWithAllocations | null = null;
    try {
      // The initial scan only selects candidates. Load the authoritative state
      // after taking the lease so a just-completed mutation cannot be overwritten
      // using a stale allocation snapshot.
      agreement = await prisma.billingAgreement.findFirst({
        where: {
          id: candidate.id,
          contaId: candidate.contaId,
          status: { in: ['ACTIVE', 'REQUIRES_RECONCILIATION'] },
          allocations: {
            some: {
              recurring: true,
              kind: 'TUITION',
              status: { in: ['ACTIVE', 'SCHEDULED'] },
              validUntil: { lte: now },
            },
          },
        },
        include: { allocations: true },
      });
      if (!agreement) continue;
      const currentAgreement = agreement;
      const expired = currentAgreement.allocations.filter(
        (allocation) =>
          allocation.recurring &&
          allocation.kind === 'TUITION' &&
          ['ACTIVE', 'SCHEDULED'].includes(allocation.status) &&
          allocation.validUntil !== null &&
          allocation.validUntil <= now,
      );
      if (expired.length === 0) continue;
      const remaining = currentAgreement.allocations.filter(
        (allocation) =>
          allocation.recurring &&
          allocation.kind === 'TUITION' &&
          ['ACTIVE', 'SCHEDULED'].includes(allocation.status) &&
          allocation.validFrom <= now &&
          (allocation.validUntil === null || allocation.validUntil > now),
      );
      const targetCents = remaining.reduce(
        (sum, allocation) => sum + Math.round(Number(allocation.netAmount) * 100),
        0,
      );
      const targetValidUntil =
        remaining.length === 0 || remaining.some((allocation) => allocation.validUntil === null)
          ? null
          : new Date(Math.max(...remaining.map((allocation) => allocation.validUntil!.getTime())));

      if (!currentAgreement.asaasSubscriptionId) {
        throw new Error('ASSINATURA_REMOTA_AUSENTE_PARA_ENCERRAMENTO_DE_ALOCACAO');
      }
      await heartbeat.assertOwned();
      const remote = await asaas.getSubscription({
        contaId: currentAgreement.contaId,
        subscriptionId: currentAgreement.asaasSubscriptionId,
      });
      if (remote.deleted) throw new Error('ASSINATURA_REMOTA_REMOVIDA');
      const nextStatus = targetCents === 0 ? 'INACTIVE' : 'ACTIVE';
      const endDate = providerEndDate(targetValidUntil);
      if (!endDate && remote.endDate) {
        // A assinatura com término no Asaas não pode ser reaberta implicitamente.
        // Mantemos o fim remoto e apenas reduzimos/inativamos o total.
      }
      await heartbeat.assertOwned();
      await asaas.updateSubscription({
        contaId: currentAgreement.contaId,
        subscriptionId: currentAgreement.asaasSubscriptionId,
        valueCents: targetCents === 0 ? remote.valueCents : targetCents,
        status: nextStatus,
        updatePendingPayments: true,
        ...(endDate ? { endDate } : {}),
      });
      await heartbeat.assertOwned();
      const confirmed = await asaas.getSubscription({
        contaId: currentAgreement.contaId,
        subscriptionId: currentAgreement.asaasSubscriptionId,
      });
      if (
        confirmed.deleted ||
        confirmed.status !== nextStatus ||
        (targetCents > 0 && confirmed.valueCents !== targetCents) ||
        (endDate && confirmed.endDate !== endDate)
      ) {
        throw new Error('RESULTADO_REMOTO_DE_ENCERRAMENTO_NAO_CONFIRMADO');
      }

      await heartbeat.assertOwned();
      await prisma.$transaction(async (tx) => {
        await tx.billingAllocation.updateMany({
          where: { contaId: currentAgreement.contaId, id: { in: expired.map((item) => item.id) } },
          data: { status: 'ENDED' },
        });
        const agreementUpdated = await tx.billingAgreement.updateMany({
          where: { id: currentAgreement.id, contaId: currentAgreement.contaId, version: currentAgreement.version, mutationLeaseToken: leaseToken },
          data: {
            desiredValue: money(targetCents),
            confirmedValue: money(targetCents),
            validUntil: targetValidUntil,
            remoteStatus: confirmed.status,
            remoteStatusUpdatedAt: now,
            lastReconciledAt: now,
            reconciliationError: null,
            status: nextStatus,
            version: { increment: 1 },
          },
        });
        if (agreementUpdated.count !== 1) throw new Error('VERSAO_DO_ACORDO_EXPIRADO_DIVERGIU');
      });
      applied += 1;
    } catch (error) {
      if (agreement) {
        await prisma.billingAgreement.updateMany({
          where: { id: agreement.id, contaId: agreement.contaId, version: agreement.version, mutationLeaseToken: leaseToken },
          data: {
            status: 'REQUIRES_RECONCILIATION',
            reconciliationError: `Falha ao encerrar alocação vencida: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000),
          },
        });
      }
      uncertain += 1;
    } finally {
      await heartbeat.stop();
      await releaseBillingAgreementMutationLease({ contaId: candidate.contaId, agreementIds: [candidate.id], leaseToken });
    }
  }
  return { found: agreements.length, applied, uncertain };
}
