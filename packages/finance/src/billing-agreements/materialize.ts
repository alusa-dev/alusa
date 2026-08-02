import { prisma } from '@alusa/database';
import type { BillingAgreementStatus, Prisma } from '@prisma/client';

type BillingTerms = {
  interestValue?: number | null;
  interestType?: string | null;
  fineValue?: number | null;
  fineType?: string | null;
  discountValue?: number | null;
  discountType?: string | null;
  discountDueDateLimitDays?: number | null;
};

type MaterializeInput =
  | {
      kind: 'INDIVIDUAL';
      contaId: string;
      subscriptionId: string;
      actorId?: string | null;
      value: number;
      billingType: string;
      cycle: string;
      nextDueDate: string;
      validUntil?: string | null;
      terms?: BillingTerms;
    }
  | {
      kind: 'FAMILY';
      contaId: string;
      standaloneSubscriptionId: string;
      familyGroupId: string;
      actorId?: string | null;
      terms?: BillingTerms;
    };

type MaterializeDeps = {
  tx?: Prisma.TransactionClient;
};

function atUtcStart(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function exclusiveEndOfDay(value: Date): Date {
  const end = new Date(value);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function agreementStatus(status: string, hasRemoteId: boolean): BillingAgreementStatus {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'INACTIVE') return 'INACTIVE';
  if (status === 'FAILED') return 'FAILED';
  return hasRemoteId ? 'ACTIVE' : 'PENDING_PROVISION';
}

type PersistedTerms = {
  interestValue?: number | null;
  interestType?: string | null;
  fineValue?: number | null;
  fineType?: string | null;
  discountValue?: number | null;
  discountType?: string | null;
  discountDueDateLimitDays?: number | null;
  confirmedTerms?: Prisma.InputJsonValue;
};

function termsData(terms?: BillingTerms): PersistedTerms {
  if (!terms) return {};
  return {
    interestValue: terms.interestValue ?? null,
    interestType: terms.interestType ?? null,
    fineValue: terms.fineValue ?? null,
    fineType: terms.fineType ?? null,
    discountValue: terms.discountValue ?? null,
    discountType: terms.discountType ?? null,
    discountDueDateLimitDays: terms.discountDueDateLimitDays ?? null,
    confirmedTerms: terms as Prisma.InputJsonValue,
  };
}

/**
 * Materializa a projeção canônica a partir do registro legado que acabou de
 * ser provisionado. É idempotente: retries reutilizam o acordo e as alocações
 * já vinculadas, sem criar outra assinatura ou outra obrigação financeira.
 */
export async function materializeBillingAgreement(
  input: MaterializeInput,
  deps: MaterializeDeps = {},
) {
  const db = deps.tx ?? prisma;

  if (input.kind === 'INDIVIDUAL') {
    const legacy = await db.subscription.findFirst({
      where: { id: input.subscriptionId, contaId: input.contaId },
      include: {
        matricula: {
          include: {
            cobrancas: { include: { charge: true } },
          },
        },
      },
    });
    if (!legacy) throw new Error('ASSINATURA_LOCAL_NAO_ENCONTRADA');

    const payerType = legacy.matricula.responsavelFinanceiroId ? 'RESPONSAVEL' : 'ALUNO';
    const payerId = legacy.matricula.responsavelFinanceiroId ?? legacy.matricula.alunoId;
    const customer = await db.customer.findUnique({
      where: {
        contaId_payerType_payerId: { contaId: input.contaId, payerType, payerId },
      },
    });
    if (!customer) throw new Error('CUSTOMER_LOCAL_NAO_ENCONTRADO');

    const persistIndividual = async (tx: Prisma.TransactionClient) => {
      const externalReference = `billing-agreement:${legacy.externalReference}`;
      const enrollmentValidUntil = exclusiveEndOfDay(
        atUtcStart(input.validUntil) ?? legacy.matricula.dataFimContrato,
      );
      const agreement = await tx.billingAgreement.upsert({
        where: {
          uq_billing_agreement_conta_external_ref: {
            contaId: input.contaId,
            externalReference,
          },
        },
        create: {
          contaId: input.contaId,
          customerId: customer.id,
          payerType,
          payerId,
          source: 'LEGACY_SUBSCRIPTION',
          status: agreementStatus(legacy.status, Boolean(legacy.asaasSubscriptionId)),
          externalReference,
          idempotencyKey: `agreement:${legacy.id}`,
          billingType: input.billingType,
          cycle: input.cycle,
          dueDay: legacy.matricula.vencimentoDia,
          nextDueDate: atUtcStart(input.nextDueDate),
          validFrom: legacy.matricula.dataInicio,
          validUntil: enrollmentValidUntil,
          desiredValue: input.value,
          confirmedValue: input.value,
          asaasSubscriptionId: legacy.asaasSubscriptionId,
          remoteStatus: legacy.asaasSubscriptionId ? 'ACTIVE' : null,
          remoteStatusUpdatedAt: new Date(),
          createdById: input.actorId ?? null,
          ...termsData(input.terms),
        },
        update: {
          customerId: customer.id,
          payerType,
          payerId,
          billingType: input.billingType,
          cycle: input.cycle,
          dueDay: legacy.matricula.vencimentoDia,
          nextDueDate: atUtcStart(input.nextDueDate),
          validUntil: enrollmentValidUntil,
          desiredValue: input.value,
          confirmedValue: input.value,
          asaasSubscriptionId: legacy.asaasSubscriptionId,
          status: agreementStatus(legacy.status, Boolean(legacy.asaasSubscriptionId)),
          remoteStatus: legacy.asaasSubscriptionId ? 'ACTIVE' : null,
          remoteStatusUpdatedAt: new Date(),
          reconciliationError: null,
          ...termsData(input.terms),
        },
      });

      await tx.subscription.updateMany({
        where: { id: legacy.id, contaId: input.contaId },
        data: { billingAgreementId: agreement.id },
      });

      const legacyAllocations = await tx.familyFinancialAllocation.findMany({
        where: {
          contaId: input.contaId,
          OR: [
            { matriculaId: legacy.matriculaId },
            { sourceAgreementId: legacy.id },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      const drafts = legacyAllocations.length > 0
        ? legacyAllocations
        : [{
            id: `tuition:${legacy.matriculaId}`,
            alunoId: legacy.matricula.alunoId,
            matriculaId: legacy.matriculaId,
            chargeKind: 'MENSALIDADE',
            amount: input.value,
            baseAmount: input.value,
            discountAmount: 0,
            competenceStart: legacy.matricula.dataInicio,
            competenceEnd: legacy.matricula.dataFimContrato,
            sourceChargeId: null,
            billingAllocationId: null,
          }];

      for (const allocation of drafts) {
        if (!allocation.matriculaId || allocation.billingAllocationId) continue;
        const isTuition = allocation.chargeKind === 'MENSALIDADE';
        const existingAllocation = await tx.billingAllocation.findFirst({
          where: {
            contaId: input.contaId,
            agreementId: agreement.id,
            matriculaId: allocation.matriculaId,
            kind: isTuition ? 'TUITION' : 'ENROLLMENT_FEE',
            status: { in: ['ACTIVE', 'SCHEDULED'] },
          },
          select: { id: true },
        });
        if (existingAllocation) {
          if (!allocation.id.startsWith('tuition:')) {
            await tx.familyFinancialAllocation.updateMany({
              where: { id: allocation.id, contaId: input.contaId, billingAllocationId: null },
              data: {
                billingAllocationId: existingAllocation.id,
                sourceAgreementId: agreement.id,
                status: 'ACTIVE',
              },
            });
          }
          continue;
        }
        const localCharge = !isTuition
          ? legacy.matricula.cobrancas.find((charge) => charge.tipo === 'TAXA_MATRICULA')?.charge
          : null;
        const created = await tx.billingAllocation.create({
          data: {
            contaId: input.contaId,
            agreementId: agreement.id,
            matriculaId: allocation.matriculaId,
            alunoId: allocation.alunoId,
            sourceChargeId: allocation.sourceChargeId ?? localCharge?.id ?? null,
            kind: isTuition ? 'TUITION' : 'ENROLLMENT_FEE',
            status: 'ACTIVE',
            recurring: isTuition,
            baseAmount: allocation.baseAmount ?? allocation.amount,
            discountAmount: allocation.discountAmount ?? 0,
            netAmount: allocation.amount,
            validFrom: allocation.competenceStart,
            validUntil: isTuition
              ? exclusiveEndOfDay(allocation.competenceEnd ?? allocation.competenceStart)
              : exclusiveEndOfDay(allocation.competenceEnd ?? allocation.competenceStart),
            prorationPolicy: isTuition ? 'FULL_CURRENT_CYCLE' : 'MANUAL',
            metadata: { legacyFamilyFinancialAllocationId: allocation.id },
          },
        });
        if (!allocation.id.startsWith('tuition:')) {
          await tx.familyFinancialAllocation.updateMany({
            where: { id: allocation.id, contaId: input.contaId, billingAllocationId: null },
            data: {
              billingAllocationId: created.id,
              sourceAgreementId: agreement.id,
              status: created.status,
            },
          });
        }
      }
      return agreement;
    };

    return deps.tx
      ? persistIndividual(deps.tx)
      : prisma.$transaction(persistIndividual);
  }

  const legacy = await db.standaloneSubscription.findFirst({
    where: {
      id: input.standaloneSubscriptionId,
      contaId: input.contaId,
      familyGroupId: input.familyGroupId,
    },
    include: { customer: true },
  });
  if (!legacy) throw new Error('ASSINATURA_FAMILIAR_LOCAL_NAO_ENCONTRADA');
  const legacyAgreementValidUntil =
    legacy.validUntil ?? (legacy.endDate ? exclusiveEndOfDay(legacy.endDate) : null);

  const persistFamily = async (tx: Prisma.TransactionClient) => {
    const externalReference = `billing-agreement:${legacy.externalReference}`;
    const agreement = await tx.billingAgreement.upsert({
      where: {
        uq_billing_agreement_conta_external_ref: {
          contaId: input.contaId,
          externalReference,
        },
      },
      create: {
        contaId: input.contaId,
        customerId: legacy.customerId,
        payerType: legacy.customer.payerType,
        payerId: legacy.customer.payerId,
        source: 'LEGACY_STANDALONE_SUBSCRIPTION',
        status: agreementStatus(legacy.status, Boolean(legacy.asaasSubscriptionId)),
        externalReference,
        idempotencyKey: `agreement:${legacy.id}`,
        billingGroupKey: input.familyGroupId,
        billingType: legacy.billingType,
        cycle: legacy.cycle,
        nextDueDate: legacy.nextDueDate,
        validFrom: legacy.validFrom ?? legacy.createdAt,
        validUntil: legacyAgreementValidUntil,
        desiredValue: legacy.value,
        confirmedValue: legacy.value,
        asaasSubscriptionId: legacy.asaasSubscriptionId,
        remoteStatus: legacy.remoteStatus ?? (legacy.asaasSubscriptionId ? 'ACTIVE' : null),
        remoteStatusUpdatedAt: new Date(),
        createdById: input.actorId ?? null,
        ...termsData(input.terms),
      },
      update: {
        customerId: legacy.customerId,
        payerType: legacy.customer.payerType,
        payerId: legacy.customer.payerId,
        billingGroupKey: input.familyGroupId,
        billingType: legacy.billingType,
        cycle: legacy.cycle,
        nextDueDate: legacy.nextDueDate,
        validUntil: legacyAgreementValidUntil,
        desiredValue: legacy.value,
        confirmedValue: legacy.value,
        asaasSubscriptionId: legacy.asaasSubscriptionId,
        status: agreementStatus(legacy.status, Boolean(legacy.asaasSubscriptionId)),
        remoteStatus: legacy.remoteStatus ?? (legacy.asaasSubscriptionId ? 'ACTIVE' : null),
        remoteStatusUpdatedAt: new Date(),
        reconciliationError: null,
        ...termsData(input.terms),
      },
    });
    await tx.standaloneSubscription.updateMany({
      where: { id: legacy.id, contaId: input.contaId },
      data: { billingAgreementId: agreement.id },
    });

    const allocations = await tx.familyFinancialAllocation.findMany({
      where: {
        contaId: input.contaId,
        familyGroupId: input.familyGroupId,
        matriculaId: { not: null },
        OR: [
          { standaloneSubscriptionId: legacy.id },
          { chargeKind: { not: 'MENSALIDADE' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const allocation of allocations) {
      if (!allocation.matriculaId || allocation.billingAllocationId) continue;
      const isTuition = allocation.chargeKind === 'MENSALIDADE';
      const existingAllocation = await tx.billingAllocation.findFirst({
        where: {
          contaId: input.contaId,
          agreementId: agreement.id,
          matriculaId: allocation.matriculaId,
          kind: isTuition ? 'TUITION' : 'ENROLLMENT_FEE',
          status: { in: ['ACTIVE', 'SCHEDULED'] },
        },
        select: { id: true },
      });
      if (existingAllocation) {
        await tx.familyFinancialAllocation.updateMany({
          where: { id: allocation.id, contaId: input.contaId, billingAllocationId: null },
          data: {
            billingAllocationId: existingAllocation.id,
            sourceAgreementId: agreement.id,
            status: 'ACTIVE',
          },
        });
        continue;
      }
      const created = await tx.billingAllocation.create({
        data: {
          contaId: input.contaId,
          agreementId: agreement.id,
          matriculaId: allocation.matriculaId,
          alunoId: allocation.alunoId,
          sourceChargeId: allocation.sourceChargeId,
          kind: isTuition ? 'TUITION' : 'ENROLLMENT_FEE',
          status: 'ACTIVE',
          recurring: isTuition,
          baseAmount: allocation.baseAmount ?? allocation.amount,
          discountAmount: allocation.discountAmount ?? 0,
          netAmount: allocation.amount,
          validFrom: allocation.competenceStart,
          // competenceEnd é inclusivo no legado familiar; BillingAllocation
          // usa limite exclusivo para não encurtar o contrato em um dia.
          validUntil:
            isTuition && !allocation.competenceEnd
              ? null
              : exclusiveEndOfDay(allocation.competenceEnd ?? allocation.competenceStart),
          prorationPolicy: isTuition ? 'FULL_CURRENT_CYCLE' : 'MANUAL',
          metadata: { legacyFamilyFinancialAllocationId: allocation.id },
        },
      });
      await tx.familyFinancialAllocation.updateMany({
        where: { id: allocation.id, contaId: input.contaId, billingAllocationId: null },
        data: {
          billingAllocationId: created.id,
          sourceAgreementId: agreement.id,
          status: created.status,
        },
      });
    }
    return agreement;
  };

  return deps.tx
    ? persistFamily(deps.tx)
    : prisma.$transaction(persistFamily);
}
