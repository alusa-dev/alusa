import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';

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
    const claimed = await prisma.billingChangeOperation.updateMany({
      where: {
        id: operation.id,
        contaId: operation.contaId,
        status: 'COMPLETED',
        scheduledAppliedAt: null,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        lockedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastAttemptAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1 || !operation.sourceAgreementId) continue;

    try {
      const agreementIds = [operation.sourceAgreementId, operation.targetAgreementId].filter(
        (id): id is string => Boolean(id),
      );
      const agreements = await prisma.billingAgreement.findMany({
        where: { id: { in: agreementIds }, contaId: operation.contaId },
        include: { allocations: true },
      });
      if (agreements.length !== agreementIds.length) throw new Error('ACORDO_AGENDADO_NAO_ENCONTRADO');
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
            await asaas.deleteSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
            });
            resultingSubscriptionId = null;
            remoteStatus = 'DELETED';
          } else {
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
            await asaas.updateSubscription({
              contaId: operation.contaId,
              subscriptionId: agreement.asaasSubscriptionId,
              valueCents: targetCents === 0 ? current.valueCents : targetCents,
              updatePendingPayments: false,
              status,
              ...(resumeNextDueDate ? { nextDueDate: resumeNextDueDate } : {}),
              ...(targetEndDate ? { endDate: targetEndDate } : {}),
            });
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

      await prisma.$transaction(async (tx) => {
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
            where: { id: result.agreement.id, contaId: operation.contaId, version: result.agreement.version },
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
        await tx.billingChangeOperation.updateMany({
          where: { id: operation.id, contaId: operation.contaId, scheduledAppliedAt: null },
          data: { scheduledAppliedAt: now, lockedAt: null, leaseExpiresAt: null, lastError: null },
        });
      });
      applied += 1;
    } catch (error) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: operation.id, contaId: operation.contaId, scheduledAppliedAt: null },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: `SCHEDULED_APPLY: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000),
        },
      });
      await prisma.billingAgreement.updateMany({
        where: {
          id: { in: [operation.sourceAgreementId, operation.targetAgreementId].filter((id): id is string => Boolean(id)) },
          contaId: operation.contaId,
        },
        data: { status: 'REQUIRES_RECONCILIATION', reconciliationError: 'Falha ao aplicar alteração agendada.' },
      });
      uncertain += 1;
    }
  }
  return { found: rows.length, applied, uncertain };
}
