import { prisma } from '@/lib/prisma';
import { cancelInstallmentPayments, getInstallment } from '@alusa/finance';

function paymentReferencePrefix(externalReference: string) {
  return `${externalReference}:payment:`;
}

async function convergeAcademic(input: {
  contaId: string;
  planId: string;
  externalReference: string;
  now: Date;
}) {
  const linkedCharges = await prisma.charge.findMany({
    where: {
      contaId: input.contaId,
      OR: [
        { externalReference: input.externalReference },
        { externalReference: { startsWith: paymentReferencePrefix(input.externalReference) } },
      ],
    },
    select: { id: true, cobrancaId: true },
  });
  const chargeIds = linkedCharges.map((charge) => charge.id);
  const cobrancaIds = linkedCharges
    .map((charge) => charge.cobrancaId)
    .filter((value): value is string => Boolean(value));

  const installmentPlanUpdate = typeof prisma.installmentPlan.updateMany === 'function'
    ? prisma.installmentPlan.updateMany({
        where: { id: input.planId, contaId: input.contaId },
        data: { status: 'CANCELED', statusUpdatedAt: input.now },
      })
    : prisma.installmentPlan.update({
        where: { id: input.planId },
        data: { status: 'CANCELED', statusUpdatedAt: input.now },
      });

  await prisma.$transaction([
    installmentPlanUpdate,
    prisma.charge.updateMany({
      where: {
        contaId: input.contaId,
        id: { in: chargeIds },
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: input.now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    }),
    prisma.cobranca.updateMany({
      where: {
        contaId: input.contaId,
        id: { in: cobrancaIds },
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: {
        status: 'CANCELADO',
        asaasStatus: 'DELETED',
        canceladoEm: input.now,
        canceladoMotivo: 'Parcelamento cancelado no Asaas',
        canceladoPor: 'system',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    }),
  ]);
}

async function convergeStandalone(input: { contaId: string; planId: string; now: Date }) {
  const standalonePlanUpdate = typeof prisma.standaloneInstallmentPlan.updateMany === 'function'
    ? prisma.standaloneInstallmentPlan.updateMany({
        where: { id: input.planId, contaId: input.contaId },
        data: { status: 'CANCELED', statusUpdatedAt: input.now },
      })
    : prisma.standaloneInstallmentPlan.update({
        where: { id: input.planId },
        data: { status: 'CANCELED', statusUpdatedAt: input.now },
      });

  await prisma.$transaction([
    standalonePlanUpdate,
    prisma.charge.updateMany({
      where: {
        contaId: input.contaId,
        standaloneInstallmentPlanId: input.planId,
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: input.now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    }),
  ]);
}

export async function cancelInstallmentForTenant(input: { contaId: string; planId: string }) {
  const academicPlan = await prisma.installmentPlan.findFirst({
    where: { id: input.planId, contaId: input.contaId },
    select: { id: true, asaasInstallmentId: true, status: true, externalReference: true },
  });
  const standalonePlan = !academicPlan
    ? await prisma.standaloneInstallmentPlan.findFirst({
        where: { id: input.planId, contaId: input.contaId },
        select: { id: true, asaasInstallmentId: true, status: true, externalReference: true },
      })
    : null;
  const plan = academicPlan ?? standalonePlan;

  if (!plan) return { status: 'NOT_FOUND' as const };
  if (!plan.asaasInstallmentId) return { status: 'WITHOUT_ASAAS_LINK' as const };

  const remote = await getInstallment(plan.asaasInstallmentId, { contaId: input.contaId });
  const now = new Date();
  if (remote.deleted === true || plan.status === 'CANCELED') {
    if (academicPlan) {
      await convergeAcademic({
        contaId: input.contaId,
        planId: academicPlan.id,
        externalReference: academicPlan.externalReference,
        now,
      });
    } else {
      await convergeStandalone({ contaId: input.contaId, planId: standalonePlan!.id, now });
    }
    return {
      status: 'CANCELED' as const,
      message: 'Parcelamento já estava cancelado na plataforma financeira.',
    };
  }

  const result = await cancelInstallmentPayments(plan.asaasInstallmentId, {
    contaId: input.contaId,
  });
  if (academicPlan) {
    await convergeAcademic({
      contaId: input.contaId,
      planId: academicPlan.id,
      externalReference: academicPlan.externalReference,
      now,
    });
  } else {
    await convergeStandalone({ contaId: input.contaId, planId: standalonePlan!.id, now });
  }

  return {
    status: 'CANCELED' as const,
    message: 'Cobranças pendentes e vencidas do parcelamento canceladas com sucesso.',
    data: { id: result.id, deletedPayments: result.deletedPayments ?? [] },
  };
}
