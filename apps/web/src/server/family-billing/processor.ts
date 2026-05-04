import { prisma } from '@/prisma/client';
import {
  createStandaloneCharge,
  type CreateStandaloneChargeInput,
} from '@alusa/finance';
import { FamilyBillingOutboxStatus, FamilyBillingStatus } from '@prisma/client';

type SupportedNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
type SupportedBillingType = 'BOLETO' | 'PIX' | 'CREDIT_CARD';
type SupportedCycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

type FamilyBillingPayload = {
  aggregateType: 'MATRICULA_FAMILIAR' | 'REMATRICULA_FAMILIAR';
  aggregateId: string;
  contaId: string;
  responsavelId: string;
  responsavelNome: string;
  totalAlunos: number;
  monthlyValue: number;
  enrollmentFeeValue: number;
  billingType: SupportedBillingType;
  cycle: SupportedCycle;
  nextDueDate: string;
  endDate: string;
  enrollmentFeeDueDate: string;
  description: string;
  actorId: string;
  uiRequestId?: string | null;
  notificationChannels?: SupportedNotificationChannel[];
  notificationChannelsConfigured?: boolean;
};

function parsePayload(raw: unknown): FamilyBillingPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Payload do outbox familiar inválido.');
  }

  const payload = raw as Record<string, unknown>;
  const aggregateType =
    payload.aggregateType === 'REMATRICULA_FAMILIAR'
      ? 'REMATRICULA_FAMILIAR'
      : 'MATRICULA_FAMILIAR';
  const billingType = payload.billingType;
  if (billingType !== 'BOLETO' && billingType !== 'PIX' && billingType !== 'CREDIT_CARD') {
    throw new Error('Forma de pagamento familiar inválida.');
  }

  const cycle = payload.cycle;
  if (
    cycle !== 'WEEKLY' &&
    cycle !== 'BIWEEKLY' &&
    cycle !== 'MONTHLY' &&
    cycle !== 'QUARTERLY' &&
    cycle !== 'YEARLY'
  ) {
    throw new Error('Ciclo financeiro familiar inválido.');
  }

  return {
    aggregateType,
    aggregateId: String(payload.aggregateId ?? ''),
    contaId: String(payload.contaId ?? ''),
    responsavelId: String(payload.responsavelId ?? ''),
    responsavelNome: String(payload.responsavelNome ?? 'Responsável'),
    totalAlunos: Number(payload.totalAlunos ?? 0),
    monthlyValue: Number(payload.monthlyValue ?? 0),
    enrollmentFeeValue: Number(payload.enrollmentFeeValue ?? 0),
    billingType,
    cycle,
    nextDueDate: String(payload.nextDueDate ?? ''),
    endDate: String(payload.endDate ?? ''),
    enrollmentFeeDueDate: String(payload.enrollmentFeeDueDate ?? ''),
    description: String(payload.description ?? 'Cobrança familiar'),
    actorId: String(payload.actorId ?? ''),
    uiRequestId: typeof payload.uiRequestId === 'string' ? payload.uiRequestId : null,
    notificationChannels: Array.isArray(payload.notificationChannels)
      ? payload.notificationChannels.filter(
          (channel): channel is SupportedNotificationChannel =>
            channel === 'EMAIL' || channel === 'SMS' || channel === 'WHATSAPP',
        )
      : [],
    notificationChannelsConfigured: payload.notificationChannelsConfigured === true,
  };
}

function ensurePositiveMoney(value: number) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

async function updateGroupMetadata(params: {
  contaId: string;
  familyGroupId: string;
  standaloneSubscriptionId?: string | null;
  standaloneChargeId?: string | null;
}) {
  if (params.standaloneSubscriptionId) {
    await prisma.standaloneSubscription.updateMany({
      where: { id: params.standaloneSubscriptionId, contaId: params.contaId },
      data: { familyGroupId: params.familyGroupId },
    });

    const relatedCharges = await prisma.charge.findMany({
      where: {
        contaId: params.contaId,
        standaloneSubscriptionId: params.standaloneSubscriptionId,
      },
      select: { id: true },
    });

    if (relatedCharges.length > 0) {
      const chargeIds = relatedCharges.map((charge) => charge.id);
      await prisma.charge.updateMany({
        where: { id: { in: chargeIds } },
        data: { familyGroupId: params.familyGroupId },
      });
      await prisma.chargeReadModel.updateMany({
        where: {
          contaId: params.contaId,
          sourceKind: 'CHARGE',
          sourceId: { in: chargeIds },
        },
        data: {
          groupId: params.familyGroupId,
          isGroup: true,
        },
      });
    }
  }

  if (params.standaloneChargeId) {
    await prisma.charge.updateMany({
      where: { id: params.standaloneChargeId, contaId: params.contaId },
      data: { familyGroupId: params.familyGroupId },
    });
    await prisma.chargeReadModel.updateMany({
      where: {
        contaId: params.contaId,
        sourceKind: 'CHARGE',
        sourceId: params.standaloneChargeId,
      },
      data: {
        groupId: params.familyGroupId,
        isGroup: true,
      },
    });
  }
}

async function persistAggregateSuccess(params: {
  payload: FamilyBillingPayload;
  subscriptionId?: string | null;
  enrollmentChargeId?: string | null;
}) {
  const data = {
    status: FamilyBillingStatus.ATIVO,
    standaloneSubscriptionId: params.subscriptionId ?? null,
    standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null,
    ultimoErro: null,
  };

  if (params.payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.update({
      where: { id: params.payload.aggregateId },
      data,
    });
    return;
  }

  await prisma.rematriculaFamiliar.update({
    where: { id: params.payload.aggregateId },
    data,
  });
}

async function persistAggregateFailure(payload: FamilyBillingPayload, message: string) {
  const data = {
    status: FamilyBillingStatus.FALHO,
    ultimoErro: message.slice(0, 2000),
  };

  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.update({
      where: { id: payload.aggregateId },
      data,
    });
    return;
  }

  await prisma.rematriculaFamiliar.update({
    where: { id: payload.aggregateId },
    data,
  });
}

function buildStandaloneBaseInput(
  payload: FamilyBillingPayload,
): Pick<
  CreateStandaloneChargeInput,
  | 'contaId'
  | 'payer'
  | 'billingType'
  | 'description'
  | 'actor'
  | 'notificationChannels'
  | 'notificationChannelsConfigured'
> {
  return {
    contaId: payload.contaId,
    payer: {
      type: 'responsavel',
      responsavelId: payload.responsavelId,
    },
    billingType: payload.billingType,
    description: payload.description,
    actor: { type: 'USER', id: payload.actorId },
    notificationChannels: payload.notificationChannels,
    notificationChannelsConfigured: payload.notificationChannelsConfigured,
  };
}

async function processSyncFamilyBilling(payload: FamilyBillingPayload) {
  const monthlyValue = ensurePositiveMoney(payload.monthlyValue);
  const enrollmentFeeValue = ensurePositiveMoney(payload.enrollmentFeeValue);
  let standaloneSubscriptionId: string | null = null;
  let standaloneEnrollmentChargeId: string | null = null;

  if (monthlyValue > 0) {
    const subscriptionResult = await createStandaloneCharge({
      ...buildStandaloneBaseInput(payload),
      chargeType: 'SUBSCRIPTION',
      value: monthlyValue,
      nextDueDate: payload.nextDueDate,
      endDate: payload.endDate,
      cycle: payload.cycle,
      uiRequestId: `${payload.aggregateId}:subscription:${payload.uiRequestId ?? 'shared'}`,
    });

    if (!subscriptionResult.success) {
      throw new Error(`Falha ao criar assinatura familiar: ${subscriptionResult.error}`);
    }

    standaloneSubscriptionId = subscriptionResult.data.chargeId;
  }

  if (enrollmentFeeValue > 0) {
    const enrollmentResult = await createStandaloneCharge({
      ...buildStandaloneBaseInput(payload),
      chargeType: 'ONE_TIME',
      value: enrollmentFeeValue,
      dueDate: payload.enrollmentFeeDueDate,
      uiRequestId: `${payload.aggregateId}:enrollment-fee:${payload.uiRequestId ?? 'shared'}`,
    });

    if (!enrollmentResult.success) {
      throw new Error(`Falha ao criar taxa familiar: ${enrollmentResult.error}`);
    }

    standaloneEnrollmentChargeId = enrollmentResult.data.chargeId;
  }

  await updateGroupMetadata({
    contaId: payload.contaId,
    familyGroupId: payload.aggregateId,
    standaloneSubscriptionId,
    standaloneChargeId: standaloneEnrollmentChargeId,
  });

  await persistAggregateSuccess({
    payload,
    subscriptionId: standaloneSubscriptionId,
    enrollmentChargeId: standaloneEnrollmentChargeId,
  });
}

export async function processFamilyBillingOutboxEvent(eventId: string) {
  const event = await prisma.familyBillingOutbox.findUnique({
    where: { id: eventId },
  });

  if (!event || event.status === FamilyBillingOutboxStatus.PROCESSED) {
    return { processed: false, reason: 'NOT_FOUND_OR_ALREADY_PROCESSED' as const };
  }

  const claimed = await prisma.familyBillingOutbox.updateMany({
    where: {
      id: eventId,
      status: { in: [FamilyBillingOutboxStatus.PENDING, FamilyBillingOutboxStatus.FAILED] },
    },
    data: {
      status: FamilyBillingOutboxStatus.PROCESSING,
      lockedAt: new Date(),
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return { processed: false, reason: 'CLAIMED_BY_OTHER_WORKER' as const };
  }

  const payload = parsePayload(event.payload);

  try {
    await processSyncFamilyBilling(payload);

    await prisma.familyBillingOutbox.update({
      where: { id: eventId },
      data: {
        status: FamilyBillingOutboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });

    return { processed: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistAggregateFailure(payload, message);
    await prisma.familyBillingOutbox.update({
      where: { id: eventId },
      data: {
        status: FamilyBillingOutboxStatus.FAILED,
        lockedAt: null,
        lastError: message.slice(0, 2000),
      },
    });
    throw error;
  }
}

export async function processFamilyBillingOutboxBatch(params?: {
  contaId?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(params?.limit ?? 10, 100));
  const events = await prisma.familyBillingOutbox.findMany({
    where: {
      status: { in: [FamilyBillingOutboxStatus.PENDING, FamilyBillingOutboxStatus.FAILED] },
      availableAt: { lte: new Date() },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const result = await processFamilyBillingOutboxEvent(event.id);
      if (result.processed) processed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: events.length,
    processed,
    failed,
  };
}
