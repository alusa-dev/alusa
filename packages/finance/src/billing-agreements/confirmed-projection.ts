import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

type ConfirmedSnapshot = {
  contaId: string;
  asaasSubscriptionId: string;
  value?: number;
  billingType?: string;
  cycle?: string;
  dueDay?: number | null;
  nextDueDate?: string | null;
  validUntil?: string | null;
  remoteStatus?: string;
  terms?: {
    interestValue?: number | null;
    interestType?: string | null;
    fineValue?: number | null;
    fineType?: string | null;
    discountValue?: number | null;
    discountType?: string | null;
    discountDueDateLimitDays?: number | null;
  };
};

/**
 * Projeta no acordo canônico uma mutação remota já confirmada. Serve de ponte
 * para endpoints legados enquanto as telas migram para o motor de operações.
 */
export async function projectConfirmedBillingAgreementSnapshot(input: ConfirmedSnapshot) {
  const terms = input.terms;
  const data: Prisma.BillingAgreementUpdateManyMutationInput = {
    ...(input.value !== undefined ? { desiredValue: input.value, confirmedValue: input.value } : {}),
    ...(input.billingType !== undefined ? { billingType: input.billingType } : {}),
    ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
    ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
    ...(input.nextDueDate !== undefined
      ? { nextDueDate: input.nextDueDate ? new Date(`${input.nextDueDate}T00:00:00.000Z`) : null }
      : {}),
    ...(input.validUntil !== undefined
      ? { validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null }
      : {}),
    ...(input.remoteStatus !== undefined ? { remoteStatus: input.remoteStatus } : {}),
    ...(terms ? {
      interestValue: terms.interestValue ?? null,
      interestType: terms.interestType ?? null,
      fineValue: terms.fineValue ?? null,
      fineType: terms.fineType ?? null,
      discountValue: terms.discountValue ?? null,
      discountType: terms.discountType ?? null,
      discountDueDateLimitDays: terms.discountDueDateLimitDays ?? null,
      confirmedTerms: terms as Prisma.InputJsonValue,
    } : {}),
    remoteStatusUpdatedAt: new Date(),
    lastReconciledAt: new Date(),
    reconciliationError: null,
    version: { increment: 1 },
  };
  return prisma.billingAgreement.updateMany({
    where: { contaId: input.contaId, asaasSubscriptionId: input.asaasSubscriptionId },
    data,
  });
}

export async function projectConfirmedBillingAllocationValues(input: {
  contaId: string;
  asaasSubscriptionId: string;
  totalValue: number;
  cycle?: string | null;
  allocations: Array<{ matriculaId: string; value: number }>;
}) {
  const agreement = await prisma.billingAgreement.findFirst({
    where: { contaId: input.contaId, asaasSubscriptionId: input.asaasSubscriptionId },
    include: {
      allocations: {
        where: {
          matriculaId: { in: input.allocations.map((item) => item.matriculaId) },
          kind: 'TUITION',
          status: { in: ['ACTIVE', 'SCHEDULED'] },
        },
      },
    },
  });
  if (!agreement) throw new Error('ACORDO_CANONICO_NAO_ENCONTRADO');
  const byEnrollment = new Map(input.allocations.map((item) => [item.matriculaId, item.value]));
  if (agreement.allocations.length !== byEnrollment.size) {
    throw new Error('ALOCACOES_CANONICAS_INCOMPLETAS');
  }
  const alreadyProjected = agreement.allocations.every(
    (allocation) => Number(allocation.netAmount) === byEnrollment.get(allocation.matriculaId),
  );
  if (alreadyProjected && Number(agreement.confirmedValue) === input.totalValue) return agreement;

  const effectiveAt = new Date();
  effectiveAt.setUTCHours(0, 0, 0, 0);
  return prisma.$transaction(async (tx) => {
    for (const allocation of agreement.allocations) {
      const value = byEnrollment.get(allocation.matriculaId);
      if (value === undefined) continue;
      await tx.billingAllocation.updateMany({
        where: { id: allocation.id, contaId: input.contaId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
        data: { status: 'ENDED', validUntil: effectiveAt },
      });
      await tx.billingAllocation.create({
        data: {
          contaId: input.contaId,
          agreementId: agreement.id,
          matriculaId: allocation.matriculaId,
          alunoId: allocation.alunoId,
          sourceChargeId: allocation.sourceChargeId,
          kind: allocation.kind,
          status: 'ACTIVE',
          recurring: allocation.recurring,
          baseAmount: value,
          discountAmount: 0,
          netAmount: value,
          validFrom: effectiveAt,
          validUntil: null,
          prorationPolicy: allocation.prorationPolicy,
          metadata: allocation.metadata ?? undefined,
        },
      });
    }
    return tx.billingAgreement.update({
      where: { uq_billing_agreement_conta_id: { contaId: input.contaId, id: agreement.id } },
      data: {
        desiredValue: input.totalValue,
        confirmedValue: input.totalValue,
        ...(input.cycle ? { cycle: input.cycle } : {}),
        remoteStatusUpdatedAt: new Date(),
        lastReconciledAt: new Date(),
        reconciliationError: null,
        version: { increment: 1 },
      },
    });
  });
}
