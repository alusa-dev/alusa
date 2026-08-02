import { prisma } from '@alusa/database';
import {
  decideEnrollmentActivationAfterFee,
  validateTransition,
} from '@alusa/domain';
import {
  canUsePlatformCapability,
  derivePlatformAccessStatus,
  evaluateStudentCapacity,
  type PlatformPlanCode,
} from '@alusa/platform-billing';
import type {
  ChargeStatus,
  Prisma,
  StatusCobranca,
  StatusFinanceiro,
  StatusTaxaMatricula,
} from '@prisma/client';

type FeeProjection = {
  taxaStatus: StatusTaxaMatricula;
  financeStatus: StatusFinanceiro;
  allocationStatus: string;
};

async function canActivateWithinCommercialCapacity(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    matriculaId: string;
    alunoId: string;
    alunoAtivo: boolean;
    sourceId: string;
  },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-billing:capacity:${input.contaId}`}, 0))`;
  const environment =
    String(process.env.STRIPE_ENVIRONMENT ?? 'TEST').toUpperCase() === 'LIVE' ? 'LIVE' : 'TEST';
  const account = await tx.platformBillingAccount.findUnique({
    where: {
      uq_platform_billing_account_conta_env: { contaId: input.contaId, environment },
    },
  });
  if (!account) return true;

  const accessStatus = derivePlatformAccessStatus({ account });
  const accessAllowed = canUsePlatformCapability({
    accessStatus,
    capability: 'STUDENT_WRITE',
  });
  const existingActiveEnrollment = await tx.matricula.findFirst({
    where: {
      contaId: input.contaId,
      alunoId: input.alunoId,
      status: 'ATIVA',
      id: { not: input.matriculaId },
    },
    select: { id: true },
  });
  const activeRows = await tx.matricula.findMany({
    where: { contaId: input.contaId, status: 'ATIVA', aluno: { status: 'ATIVO' } },
    distinct: ['alunoId'],
    select: { alunoId: true },
  });
  const capacity = evaluateStudentCapacity({
    contaId: input.contaId,
    planCode: account.planCode as PlatformPlanCode | null,
    activeStudents: activeRows.length,
    additionalActiveStudents: !input.alunoAtivo || existingActiveEnrollment ? 0 : 1,
  });
  if (accessAllowed && capacity.allowed) return true;

  const correlationId = `fee-activation-capacity:${input.contaId}:${input.matriculaId}`;
  await tx.matriculaOperacao.upsert({
    where: { correlationId },
    create: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      tipo: 'RECONCILIACAO',
      origem: 'WEBHOOK',
      status: 'DIVERGENTE',
      correlationId,
      erro: accessAllowed
        ? 'PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED'
        : 'PLATFORM_BILLING_ACCESS_RESTRICTED',
      metadata: {
        sourceId: input.sourceId,
        accessStatus,
        activeStudents: capacity.activeStudents,
        projectedActiveStudents: capacity.projectedActiveStudents,
        maxActiveStudents: capacity.maxActiveStudents,
      },
    },
    update: {
      status: 'DIVERGENTE',
      erro: accessAllowed
        ? 'PLATFORM_BILLING_STUDENT_CAPACITY_EXCEEDED'
        : 'PLATFORM_BILLING_ACCESS_RESTRICTED',
      processedAt: null,
    },
  });
  return false;
}

export function projectionFromAcademicCharge(status: StatusCobranca): FeeProjection {
  switch (status) {
    case 'PAGO':
      return { taxaStatus: 'PAGO', financeStatus: 'ADIMPLENTE', allocationStatus: 'PAID' };
    case 'ATRASADO':
      return { taxaStatus: 'PENDENTE', financeStatus: 'INADIMPLENTE', allocationStatus: 'OVERDUE' };
    case 'CANCELADO':
    case 'ESTORNADO':
    case 'ESTORNADO_PARCIAL':
      return { taxaStatus: 'EXPIRADO', financeStatus: 'PENDENTE_TAXA', allocationStatus: 'CANCELED' };
    default:
      return { taxaStatus: 'PENDENTE', financeStatus: 'PENDENTE_TAXA', allocationStatus: 'AWAITING_PAYMENT' };
  }
}

export function projectionFromStandaloneCharge(status: ChargeStatus): FeeProjection {
  switch (status) {
    case 'PAID':
      return { taxaStatus: 'PAGO', financeStatus: 'ADIMPLENTE', allocationStatus: 'PAID' };
    case 'OVERDUE':
      return { taxaStatus: 'PENDENTE', financeStatus: 'INADIMPLENTE', allocationStatus: 'OVERDUE' };
    case 'CANCELED':
    case 'REFUNDED':
      return { taxaStatus: 'EXPIRADO', financeStatus: 'PENDENTE_TAXA', allocationStatus: status };
    default:
      return { taxaStatus: 'PENDENTE', financeStatus: 'PENDENTE_TAXA', allocationStatus: 'AWAITING_PAYMENT' };
  }
}

async function applyEnrollmentFeeProjection(input: {
  contaId: string;
  matriculaId: string;
  projection: FeeProjection;
  eventName: string;
  sourceId: string;
  familyGroupId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enrollment-fee:${input.contaId}:${input.matriculaId}`}, 0))`;
    const matricula = await tx.matricula.findFirst({
      where: { id: input.matriculaId, contaId: input.contaId },
      select: {
        id: true,
        alunoId: true,
        aluno: { select: { status: true } },
        status: true,
        taxaStatus: true,
        statusFinanceiro: true,
        version: true,
      },
    });
    if (!matricula) return { projected: false as const, reason: 'MATRICULA_NOT_FOUND' as const };

    // A fonte local já passou pela regra monotônica do webhook. Portanto, uma
    // reversão persistida (estorno/cancelamento/undo) é legítima e deve ser projetada.
    const projection = input.projection;
    const [overdueAcademicCharge, overdueFamilyCharge] = await Promise.all([
      tx.cobranca.findFirst({
        where: {
          contaId: input.contaId,
          matriculaId: input.matriculaId,
          status: 'ATRASADO',
        },
        select: { id: true },
      }),
      input.familyGroupId
        ? tx.charge.findFirst({
            where: {
              contaId: input.contaId,
              familyGroupId: input.familyGroupId,
              status: 'OVERDUE',
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const hasOverdueCharge = Boolean(overdueAcademicCharge || overdueFamilyCharge);
    const derivedFinanceStatus = hasOverdueCharge
      ? ('INADIMPLENTE' as const)
      : projection.financeStatus;

    await tx.matricula.updateMany({
      where: { id: matricula.id, contaId: input.contaId },
      data: {
        taxaStatus: projection.taxaStatus,
        statusFinanceiro: derivedFinanceStatus,
      },
    });

    const conta = await tx.conta.findUnique({
      where: { id: input.contaId },
      select: { matriculaActivationPolicy: true },
    });
    const decision = decideEnrollmentActivationAfterFee({
      activationPolicy: conta?.matriculaActivationPolicy ?? 'IMMEDIATE',
      enrollmentStatus: matricula.status,
      feeStatus: projection.taxaStatus,
    });

    if (decision.action === 'ACTIVATE' && validateTransition(matricula.status, 'ATIVA').success) {
      const capacityAllowed = await canActivateWithinCommercialCapacity(tx, {
        contaId: input.contaId,
        matriculaId: matricula.id,
        alunoId: matricula.alunoId,
        alunoAtivo: matricula.aluno.status === 'ATIVO',
        sourceId: input.sourceId,
      });
      if (!capacityAllowed) {
        return { projected: true as const, activation: 'BLOCKED_BY_COMMERCIAL_CAPACITY' as const };
      }
      const activated = await tx.matricula.updateMany({
        where: {
          id: matricula.id,
          contaId: input.contaId,
          status: 'PENDENTE_TAXA',
          version: matricula.version,
        },
        data: { status: 'ATIVA', version: { increment: 1 } },
      });
      if (activated.count > 0) {
        await tx.matriculaOperacao.updateMany({
          where: {
            contaId: input.contaId,
            matriculaId: matricula.id,
            correlationId: `fee-activation-capacity:${input.contaId}:${matricula.id}`,
            status: 'DIVERGENTE',
          },
          data: { status: 'SINCRONIZADO', erro: null, processedAt: new Date() },
        });
        await tx.matriculaLog.create({
          data: {
            matriculaId: matricula.id,
            action: 'MATRICULA_ATIVADA_APOS_PAGAMENTO_TAXA',
            metadata: {
              eventName: input.eventName,
              sourceId: input.sourceId,
              policy: conta?.matriculaActivationPolicy ?? 'IMMEDIATE',
            },
          },
        });
      }
    }

    return { projected: true as const };
  });
}

export async function projectAcademicEnrollmentFeeState(input: {
  contaId: string;
  cobrancaId: string;
  eventName: string;
}) {
  const cobranca = await prisma.cobranca.findFirst({
    where: { id: input.cobrancaId, contaId: input.contaId, tipo: 'TAXA_MATRICULA' },
    select: { id: true, matriculaId: true, status: true },
  });
  if (!cobranca) return { projected: false as const, reason: 'FEE_NOT_FOUND' as const };
  return applyEnrollmentFeeProjection({
    contaId: input.contaId,
    matriculaId: cobranca.matriculaId,
    projection: projectionFromAcademicCharge(cobranca.status),
    eventName: input.eventName,
    sourceId: cobranca.id,
  });
}

export async function projectFamilyEnrollmentFeeState(input: {
  contaId: string;
  chargeId: string;
  eventName: string;
}) {
  const charge = await prisma.charge.findFirst({
    where: { id: input.chargeId, contaId: input.contaId },
    select: {
      id: true,
      status: true,
      familyGroupId: true,
      customer: { select: { payerType: true, payerId: true } },
    },
  });
  if (!charge?.familyGroupId) {
    return { projected: false as const, reason: 'FAMILY_FEE_NOT_FOUND' as const };
  }

  const allocations = await prisma.familyFinancialAllocation.findMany({
    where: {
      contaId: input.contaId,
      familyGroupId: charge.familyGroupId,
      sourceChargeId: charge.id,
      chargeKind: 'TAXA_MATRICULA',
    },
    select: { id: true, matriculaId: true },
  });
  if (allocations.length === 0) {
    return { projected: false as const, reason: 'FAMILY_FEE_ALLOCATION_NOT_FOUND' as const };
  }
  const family = await prisma.matriculaFamiliar.findFirst({
    where: { id: charge.familyGroupId, contaId: input.contaId },
    select: { id: true, responsavelId: true },
  });
  if (
    !family ||
    charge.customer?.payerType !== 'RESPONSAVEL' ||
    charge.customer.payerId !== family.responsavelId
  ) {
    throw new Error('FAMILY_FEE_PAYER_MISMATCH');
  }
  const projection = projectionFromStandaloneCharge(charge.status);
  for (const allocation of allocations) {
    if (!allocation.matriculaId) continue;
    await applyEnrollmentFeeProjection({
      contaId: input.contaId,
      matriculaId: allocation.matriculaId,
      projection,
      eventName: input.eventName,
      sourceId: charge.id,
      familyGroupId: family.id,
    });
  }
  await prisma.familyFinancialAllocation.updateMany({
    where: {
      contaId: input.contaId,
      familyGroupId: family.id,
      sourceChargeId: charge.id,
      chargeKind: 'TAXA_MATRICULA',
    },
    data: { status: projection.allocationStatus },
  });
  return { projected: true as const, enrollmentCount: allocations.length };
}

export async function reconcileEnrollmentFeeProjections(input: {
  contaId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const blockedActivationOperations = await prisma.matriculaOperacao.findMany({
    where: {
      contaId: input.contaId,
      tipo: 'RECONCILIACAO',
      status: 'DIVERGENTE',
      correlationId: { startsWith: `fee-activation-capacity:${input.contaId}:` },
    },
    take: limit,
    orderBy: { updatedAt: 'asc' },
    select: { matriculaId: true },
  });
  const blockedMatriculaIds = blockedActivationOperations.map((item) => item.matriculaId);
  const [academicFees, familyFees] = await Promise.all([
    prisma.cobranca.findMany({
      where: {
        contaId: input.contaId,
        tipo: 'TAXA_MATRICULA',
        OR: [
          { status: 'PAGO', matricula: { OR: [{ taxaStatus: { not: 'PAGO' } }, { status: 'PENDENTE_TAXA' }] } },
          { status: 'ATRASADO', matricula: { statusFinanceiro: { not: 'INADIMPLENTE' } } },
          {
            status: { in: ['CANCELADO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
            matricula: { taxaStatus: { not: 'EXPIRADO' } },
          },
          {
            status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
            matricula: { taxaStatus: { not: 'PENDENTE' } },
          },
        ],
      },
      take: limit,
      orderBy: { matricula: { updatedAt: 'asc' } },
      select: { id: true },
    }),
    prisma.familyFinancialAllocation.findMany({
      where: {
        contaId: input.contaId,
        chargeKind: 'TAXA_MATRICULA',
        sourceChargeId: { not: null },
        OR: [
          { sourceCharge: { status: 'PAID' }, status: { not: 'PAID' } },
          { sourceCharge: { status: 'OVERDUE' }, status: { not: 'OVERDUE' } },
          { sourceCharge: { status: 'REFUNDED' }, status: { not: 'REFUNDED' } },
          { sourceCharge: { status: 'CANCELED' }, status: { not: 'CANCELED' } },
          {
            sourceCharge: { status: { in: ['CREATED', 'PENDING_SYNC', 'OPEN'] } },
            status: { not: 'AWAITING_PAYMENT' },
          },
          ...(blockedMatriculaIds.length > 0
            ? [
                {
                  sourceCharge: { status: 'PAID' as const },
                  status: 'PAID',
                  matriculaId: { in: blockedMatriculaIds },
                },
              ]
            : []),
        ],
      },
      distinct: ['sourceChargeId'],
      take: limit,
      orderBy: { updatedAt: 'asc' },
      select: { sourceChargeId: true },
    }),
  ]);

  let failures = 0;
  const failedSources: string[] = [];
  for (const fee of academicFees) {
    try {
      await projectAcademicEnrollmentFeeState({
        contaId: input.contaId,
        cobrancaId: fee.id,
        eventName: 'LOCAL_RECONCILIATION',
      });
    } catch {
      failures += 1;
      failedSources.push(`cobranca:${fee.id}`);
    }
  }
  for (const fee of familyFees) {
    if (!fee.sourceChargeId) continue;
    try {
      await projectFamilyEnrollmentFeeState({
        contaId: input.contaId,
        chargeId: fee.sourceChargeId,
        eventName: 'LOCAL_RECONCILIATION',
      });
    } catch {
      failures += 1;
      failedSources.push(`charge:${fee.sourceChargeId}`);
    }
  }
  return { academic: academicFees.length, family: familyFees.length, failures, failedSources };
}
