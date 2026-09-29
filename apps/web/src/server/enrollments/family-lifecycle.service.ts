import type { PrismaClient } from '@prisma/client';
import { FamilyAcademicStatus, FamilyBillingStatus, StatusMatricula } from '@prisma/client';

const MEMBER_STATUSES = [
  StatusMatricula.PENDENTE_TAXA,
  StatusMatricula.AGUARDANDO_CONFIRMACAO,
  StatusMatricula.ATIVA,
  StatusMatricula.PAUSADA,
] as const;

export type FamilyLifecycleImpact = {
  familyId: string;
  previousStatus: FamilyBillingStatus;
  newStatus: FamilyBillingStatus;
  remainingStudents: number;
  previousMonthlyValue: number;
  newMonthlyValue: number;
  valueChanged: boolean;
};

/**
 * Rebuilds the family aggregate from its members and canonical allocations.
 * BillingAllocation is the financial source of truth; legacy aggregate fields
 * are maintained as a read model for screens and compatibility.
 */
export async function syncFamilyLifecycleAggregate(input: {
  prisma: PrismaClient;
  contaId: string;
  familyId: string;
}): Promise<FamilyLifecycleImpact | null> {
  const family = await input.prisma.matriculaFamiliar.findFirst({
    where: { id: input.familyId, contaId: input.contaId },
    select: {
      id: true,
      status: true,
      valorMensalidadeTotal: true,
      standaloneSubscriptionId: true,
      matriculas: { select: { status: true } },
    },
  });
  if (!family) return null;

  const activeMembers = family.matriculas.filter((item) =>
    MEMBER_STATUSES.includes(item.status as (typeof MEMBER_STATUSES)[number]),
  ).length;
  const terminalMembers = family.matriculas.filter(
    (item) => !MEMBER_STATUSES.includes(item.status as (typeof MEMBER_STATUSES)[number]),
  ).length;

  const [allocationTotal, allocationCount] = await Promise.all([
    input.prisma.billingAllocation.aggregate({
      where: {
        contaId: input.contaId,
        matricula: { matriculaFamiliarId: family.id },
        kind: 'TUITION',
        recurring: true,
        status: { in: ['ACTIVE', 'SCHEDULED'] },
      },
      _sum: { netAmount: true },
    }),
    input.prisma.billingAllocation.count({
      where: {
        contaId: input.contaId,
        matricula: { matriculaFamiliarId: family.id },
        kind: 'TUITION',
        recurring: true,
        status: { in: ['ACTIVE', 'SCHEDULED'] },
      },
    }),
  ]);

  // Registros legados podem não possuir alocações canônicas. Preserve o
  // agregado até a reconciliação, em vez de gravar zero silenciosamente.
  const newMonthlyValue = allocationCount > 0
    ? Number(allocationTotal._sum.netAmount ?? 0)
    : activeMembers === 0
      ? 0
      : Number(family.valorMensalidadeTotal);
  const newStatus = activeMembers === 0
    ? FamilyBillingStatus.CANCELADO
    : terminalMembers > 0
      ? FamilyBillingStatus.PARCIAL
      : FamilyBillingStatus.ATIVO;
  const newAcademicStatus = activeMembers === 0
    ? FamilyAcademicStatus.CANCELADO
    : terminalMembers > 0
      ? FamilyAcademicStatus.PARCIAL
      : FamilyAcademicStatus.COMPLETO;

  await input.prisma.matriculaFamiliar.update({
    where: { id: family.id },
    data: {
      status: newStatus,
      academicStatus: newAcademicStatus,
      totalAlunos: activeMembers,
      valorMensalidadeTotal: newMonthlyValue,
    },
  });

  // `StandaloneSubscription` permanece como read model legado usado pelas
  // telas de assinatura e pela compatibilidade com cobranças antigas. O
  // acordo canônico é a fonte de verdade financeira, mas esse espelho precisa
  // ser atualizado no mesmo ciclo para não exibir o valor anterior (ex.: R$
  // 300 após uma matrícula familiar de R$ 150 ser pausada).
  if (family.standaloneSubscriptionId && allocationCount > 0) {
    const subscription = await input.prisma.standaloneSubscription.findFirst({
      where: {
        contaId: input.contaId,
        id: family.standaloneSubscriptionId,
      },
      select: {
        billingAgreement: { select: { nextDueDate: true } },
      },
    });

    const recurringCharge = await input.prisma.charge.findFirst({
      where: {
        contaId: input.contaId,
        standaloneSubscriptionId: family.standaloneSubscriptionId,
        status: { in: ['OPEN', 'PENDING_SYNC', 'OVERDUE'] },
        value: newMonthlyValue,
      },
      orderBy: { dueDate: 'asc' },
      select: { dueDate: true },
    });

    const nextDueDate = recurringCharge?.dueDate ?? subscription?.billingAgreement?.nextDueDate;
    await input.prisma.standaloneSubscription.updateMany({
      where: {
        contaId: input.contaId,
        id: family.standaloneSubscriptionId,
      },
      data: {
        value: newMonthlyValue,
        ...(nextDueDate ? { nextDueDate } : {}),
      },
    });
  }

  const previousMonthlyValue = Number(family.valorMensalidadeTotal);
  return {
    familyId: family.id,
    previousStatus: family.status,
    newStatus,
    remainingStudents: activeMembers,
    previousMonthlyValue,
    newMonthlyValue,
    valueChanged: Math.abs(previousMonthlyValue - newMonthlyValue) >= 0.005,
  };
}
