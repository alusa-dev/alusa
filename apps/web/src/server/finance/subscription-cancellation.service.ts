import { prisma } from '@/lib/prisma';
import { deleteSubscription } from '@alusa/finance';
import { classifyAsaasSubscriptionMutationError } from './asaas-subscription-mutation-error';

function paymentReferencePrefix(externalReference: string) {
  return `${externalReference}:payment:`;
}

async function cancelAgreementAllocations(input: {
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
  contaId: string;
  agreementId: string;
  now: Date;
}) {
  const allocations = await input.tx.billingAllocation.findMany({
    where: {
      contaId: input.contaId,
      agreementId: input.agreementId,
      status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] },
    },
    select: { id: true, validFrom: true },
  });
  for (const allocation of allocations) {
    await input.tx.billingAllocation.updateMany({
      where: { id: allocation.id, contaId: input.contaId },
      data: {
        status: 'CANCELLED',
        ...(allocation.validFrom < input.now ? { validUntil: input.now } : {}),
      },
    });
  }
  await input.tx.billingAgreement.updateMany({
    where: { id: input.agreementId, contaId: input.contaId },
    data: {
      status: 'CANCELLED',
      desiredValue: 0,
      confirmedValue: 0,
      asaasSubscriptionId: null,
      remoteStatus: 'DELETED',
      remoteStatusUpdatedAt: input.now,
      lastReconciledAt: input.now,
      reconciliationError: null,
      version: { increment: 1 },
    },
  });
}

async function convergeAcademic(input: {
  contaId: string;
  subscriptionId: string;
  billingAgreementId: string | null;
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

  await prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { id: input.subscriptionId, contaId: input.contaId },
      data: { status: 'DELETED', statusUpdatedAt: input.now },
    });
    await tx.charge.updateMany({
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
    });
    await tx.cobranca.updateMany({
      where: {
        contaId: input.contaId,
        id: { in: cobrancaIds },
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: {
        status: 'CANCELADO',
        asaasStatus: 'DELETED',
        canceladoEm: input.now,
        canceladoMotivo: 'Assinatura removida no Asaas',
        canceladoPor: 'system',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    if (input.billingAgreementId) {
      await cancelAgreementAllocations({
        tx,
        contaId: input.contaId,
        agreementId: input.billingAgreementId,
        now: input.now,
      });
    }
  });
}

async function convergeStandalone(input: {
  contaId: string;
  subscriptionId: string;
  billingAgreementId: string | null;
  externalReference: string;
  now: Date;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.standaloneSubscription.updateMany({
      where: { id: input.subscriptionId, contaId: input.contaId },
      data: { status: 'DELETED', statusUpdatedAt: input.now },
    });
    await tx.charge.updateMany({
      where: {
        contaId: input.contaId,
        OR: [
          { standaloneSubscriptionId: input.subscriptionId },
          { externalReference: input.externalReference },
          { externalReference: { startsWith: paymentReferencePrefix(input.externalReference) } },
        ],
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: input.now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    if (input.billingAgreementId) {
      await cancelAgreementAllocations({
        tx,
        contaId: input.contaId,
        agreementId: input.billingAgreementId,
        now: input.now,
      });
    }
  });
}

export async function deleteSubscriptionForTenant(input: {
  contaId: string;
  subscriptionId: string;
}) {
  const academicSubscription = await prisma.subscription.findFirst({
    where: { id: input.subscriptionId, contaId: input.contaId },
    select: { id: true, billingAgreementId: true, asaasSubscriptionId: true, status: true, externalReference: true },
  });
  const standaloneSubscription = !academicSubscription
    ? await prisma.standaloneSubscription.findFirst({
        where: { id: input.subscriptionId, contaId: input.contaId },
        select: { id: true, billingAgreementId: true, asaasSubscriptionId: true, status: true, externalReference: true },
      })
    : null;
  const subscription = academicSubscription ?? standaloneSubscription;

  if (!subscription) return { status: 'NOT_FOUND' as const };
  if (academicSubscription) return { status: 'ACADEMIC_SUBSCRIPTION' as const };
  if (!subscription.asaasSubscriptionId) return { status: 'WITHOUT_ASAAS_LINK' as const };

  if (subscription.billingAgreementId) {
    const linkedAllocations = await prisma.billingAllocation.count({
      where: {
        contaId: input.contaId,
        agreementId: subscription.billingAgreementId,
        status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] },
      },
    });
    if (linkedAllocations > 1) return { status: 'SHARED_SUBSCRIPTION' as const };
  }

  const now = new Date();
  try {
    const deleted = await deleteSubscription(subscription.asaasSubscriptionId, {
      contaId: input.contaId,
    });
    await convergeStandalone({
      contaId: input.contaId,
      subscriptionId: standaloneSubscription!.id,
      billingAgreementId: standaloneSubscription!.billingAgreementId,
      externalReference: standaloneSubscription!.externalReference,
      now,
    });
    return {
      status: 'DELETED' as const,
      data: { id: deleted?.id ?? subscription.asaasSubscriptionId, deleted: true },
    };
  } catch (error) {
    const classified = classifyAsaasSubscriptionMutationError(error);
    if (classified.kind === 'not_found') {
      await convergeStandalone({
        contaId: input.contaId,
        subscriptionId: standaloneSubscription!.id,
        billingAgreementId: standaloneSubscription!.billingAgreementId,
        externalReference: standaloneSubscription!.externalReference,
        now,
      });
      return {
        status: 'ALREADY_DELETED' as const,
        message: 'Assinatura já estava excluída na plataforma financeira.',
      };
    }
    if (classified.kind === 'unauthorized') {
      return {
        status: 'UNAUTHORIZED_PROVIDER' as const,
        message: classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
      };
    }
    throw error;
  }
}
