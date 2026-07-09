import { prisma } from '@/prisma/client';
import {
  createStandaloneCharge,
  updateSubscription,
  type CreateStandaloneChargeInput,
} from '@alusa/finance';
import { FamilyBillingOutboxStatus, FamilyBillingStatus, type Prisma } from '@prisma/client';

export type SupportedNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type SupportedBillingType = 'BOLETO' | 'PIX' | 'CREDIT_CARD';
export type SupportedCycle =
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'YEARLY';

export type DiscountPayload = {
  value: number;
  type: 'FIXED' | 'PERCENTAGE';
  dueDateLimitDays?: number;
};
export type InterestPayload = { value: number };
export type FinePayload = { value: number; type: 'FIXED' | 'PERCENTAGE' };

export type FamilyBillingPayload = {
  aggregateType: 'MATRICULA_FAMILIAR' | 'REMATRICULA_FAMILIAR';
  aggregateId: string;
  contaId: string;
  responsavelId: string;
  responsavelNome: string;
  totalAlunos: number;
  monthlyValue: number;
  enrollmentFeeValue: number;
  billingType: SupportedBillingType;
  enrollmentFeeBillingType?: SupportedBillingType | null;
  cycle: SupportedCycle;
  nextDueDate: string;
  endDate: string;
  enrollmentFeeDueDate: string;
  description: string;
  actorId: string;
  uiRequestId?: string | null;
  notificationChannels?: SupportedNotificationChannel[];
  notificationChannelsConfigured?: boolean;
  discount?: DiscountPayload | null;
  interest?: InterestPayload | null;
  fine?: FinePayload | null;
};

export type FamilyBillingExecutionResult = {
  standaloneSubscriptionId: string | null;
  standaloneEnrollmentChargeId: string | null;
};

function parseSupportedBillingType(value: unknown, fallback?: SupportedBillingType | null) {
  if (value === 'BOLETO' || value === 'PIX' || value === 'CREDIT_CARD') return value;
  if (value === undefined || value === null) return fallback ?? null;
  throw new Error('Forma de pagamento familiar inválida.');
}

function parsePositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseDiscount(raw: unknown): DiscountPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  const value = parsePositiveNumber(payload.value);
  if (!value) return null;

  return {
    value,
    type: payload.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
    dueDateLimitDays: Math.max(0, Number(payload.dueDateLimitDays ?? 0) || 0),
  };
}

function parseInterest(raw: unknown): InterestPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = parsePositiveNumber((raw as Record<string, unknown>).value);
  return value ? { value } : null;
}

function parseFine(raw: unknown): FinePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  const value = parsePositiveNumber(payload.value);
  if (!value) return null;

  return {
    value,
    type: payload.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
  };
}

function isUncertainFinancialResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|econnreset|etimedout|eai_again|socket hang up|network|fetch failed|und_err_connect_timeout|resultado_incerto/i.test(
    message,
  );
}

export function parseFamilyBillingPayload(raw: unknown): FamilyBillingPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Payload do outbox familiar inválido.');
  }

  const payload = raw as Record<string, unknown>;
  const aggregateType =
    payload.aggregateType === 'REMATRICULA_FAMILIAR'
      ? 'REMATRICULA_FAMILIAR'
      : 'MATRICULA_FAMILIAR';
  const billingType = parseSupportedBillingType(payload.billingType);
  if (!billingType) {
    throw new Error('Forma de pagamento familiar inválida.');
  }
  const enrollmentFeeBillingType = parseSupportedBillingType(
    payload.enrollmentFeeBillingType,
    billingType,
  );

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
    enrollmentFeeBillingType,
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
    discount: parseDiscount(payload.discount),
    interest: parseInterest(payload.interest),
    fine: parseFine(payload.fine),
  };
}

function ensurePositiveMoney(value: number) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

function isFutureDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) > todayUtc;
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
  if (params.payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.update({
      where: { id: params.payload.aggregateId },
      data: {
        status: FamilyBillingStatus.ATIVO,
        standaloneSubscriptionId: params.subscriptionId ?? null,
        standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null,
        ultimoErro: null,
      },
    });
    return;
  }

  await prisma.rematriculaFamiliar.update({
    where: { id: params.payload.aggregateId },
    data: {
      status: FamilyBillingStatus.PROCESSANDO,
      step: 'AGUARDANDO_CONFIRMACAO_DESTINO',
      targetBillingStatus: 'AWAITING_WEBHOOK',
      standaloneSubscriptionId: params.subscriptionId ?? null,
      standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null,
      ultimoErro: null,
    },
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

async function persistAggregateUncertain(payload: FamilyBillingPayload, message: string) {
  await persistAggregateFailure(
    payload,
    `RESULTADO_INCERTO: ${message.slice(0, 1900)}`,
  );
}

function buildStandaloneBaseInput(
  payload: FamilyBillingPayload,
  overrides?: {
    billingType?: SupportedBillingType | null;
    description?: string;
  },
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
    billingType: overrides?.billingType ?? payload.billingType,
    description: overrides?.description ?? payload.description,
    actor: { type: 'USER', id: payload.actorId },
    notificationChannels: payload.notificationChannels,
    notificationChannelsConfigured: payload.notificationChannelsConfigured,
  };
}

function buildBillingAdjustments(
  payload: FamilyBillingPayload,
): Pick<CreateStandaloneChargeInput, 'discount' | 'interest' | 'fine'> {
  return {
    discount: payload.discount ?? undefined,
    interest: payload.interest ?? undefined,
    fine: payload.fine ?? undefined,
  };
}

/**
 * Executa a cobrança consolidada da família (taxa avulsa + assinatura recorrente)
 * de forma idempotente. Pode ser chamado inline (rota /api/matriculas/familiar)
 * ou via outbox (cron de retry/recovery).
 *
 * Ordem importa: a taxa avulsa é criada PRIMEIRO. Se ela falhar, a assinatura
 * NÃO é criada, evitando assinaturas órfãs no Asaas. Em caso de retry, ambas
 * as chamadas são idempotentes pelo `uiRequestId` derivado.
 */
export async function executeFamilyBilling(
  payload: FamilyBillingPayload,
): Promise<FamilyBillingExecutionResult> {
  const monthlyValue = ensurePositiveMoney(payload.monthlyValue);
  const enrollmentFeeValue = ensurePositiveMoney(payload.enrollmentFeeValue);
  let standaloneSubscriptionId: string | null = null;
  let standaloneEnrollmentChargeId: string | null = null;

  if (enrollmentFeeValue > 0) {
    const enrollmentResult = await createStandaloneCharge({
      ...buildStandaloneBaseInput(payload, {
        billingType: payload.enrollmentFeeBillingType,
        description: `Taxa de matrícula familiar · ${payload.responsavelNome} · ${payload.totalAlunos} alunos`,
      }),
      ...buildBillingAdjustments(payload),
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

  if (monthlyValue > 0) {
    const subscriptionResult = await createStandaloneCharge({
      ...buildStandaloneBaseInput(payload),
      ...buildBillingAdjustments(payload),
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

  await updateGroupMetadata({
    contaId: payload.contaId,
    familyGroupId: payload.aggregateId,
    standaloneSubscriptionId,
    standaloneChargeId: standaloneEnrollmentChargeId,
  });

  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.familyFinancialAllocation.updateMany({
      where: {
        contaId: payload.contaId,
        familyGroupId: payload.aggregateId,
        status: 'PENDING',
      },
      data: {
        standaloneSubscriptionId,
        sourceAgreementId: standaloneEnrollmentChargeId ?? standaloneSubscriptionId,
        status: 'AWAITING_WEBHOOK',
      },
    });
  }

  if (standaloneSubscriptionId && payload.aggregateType === 'REMATRICULA_FAMILIAR') {
    await prisma.familyFinancialAllocation.updateMany({
      where: {
        contaId: payload.contaId,
        rematriculaFamiliarId: payload.aggregateId,
        status: 'PENDING',
      },
      data: {
        standaloneSubscriptionId,
        status: 'AWAITING_WEBHOOK',
      },
    });

    await prisma.rematriculaFamiliarItem.updateMany({
      where: {
        rematriculaFamiliarId: payload.aggregateId,
        decision: 'REMATRICULAR_AGORA',
      },
      data: {
        targetFinancialAgreementId: standaloneSubscriptionId,
      },
    });
  }

  await persistAggregateSuccess({
    payload,
    subscriptionId: standaloneSubscriptionId,
    enrollmentChargeId: standaloneEnrollmentChargeId,
  });

  return { standaloneSubscriptionId, standaloneEnrollmentChargeId };
}

/**
 * Marca o aggregate familiar como FALHO sem lançar erro adicional.
 * Útil para o caminho inline da rota: a cobrança falhou, mas as matrículas
 * já estão criadas; o cliente recebe uma resposta com status FALHO ao invés
 * de um 500.
 */
export async function markFamilyBillingFailed(
  payload: FamilyBillingPayload,
  message: string,
) {
  await persistAggregateFailure(payload, message);
}

export function buildFamilyBillingDedupeKey(
  aggregateType: FamilyBillingPayload['aggregateType'],
  aggregateId: string,
  eventType = 'SYNC_FAMILY_BILLING',
) {
  return `${aggregateType}:${aggregateId}:${eventType}`;
}

export async function enqueueFamilyBillingOutbox(input: {
  contaId: string;
  aggregateType: FamilyBillingPayload['aggregateType'];
  aggregateId: string;
  payload: FamilyBillingPayload;
  matriculaFamiliarId?: string;
  rematriculaFamiliarId?: string;
  eventType?: string;
}) {
  const eventType = input.eventType ?? 'SYNC_FAMILY_BILLING';
  const dedupeKey = buildFamilyBillingDedupeKey(input.aggregateType, input.aggregateId, eventType);

  const existing = await prisma.familyBillingOutbox.findFirst({
    where: { contaId: input.contaId, dedupeKey },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.familyBillingOutbox.create({
      data: {
        contaId: input.contaId,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType,
        dedupeKey,
        matriculaFamiliarId: input.matriculaFamiliarId ?? null,
        rematriculaFamiliarId: input.rematriculaFamiliarId ?? null,
        payload: input.payload as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      const raced = await prisma.familyBillingOutbox.findFirst({
        where: { contaId: input.contaId, dedupeKey },
      });
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}

export async function processFamilyBillingOutboxEvent(eventId: string) {
  const event = await prisma.familyBillingOutbox.findUnique({
    where: { id: eventId },
  });

  if (
    !event ||
    event.status === FamilyBillingOutboxStatus.PROCESSED ||
    event.status === FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION
  ) {
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

  let parsedFamilyPayload: FamilyBillingPayload | null = null;

  try {
    if (event.eventType === 'REQUEST_SOURCE_SUBSCRIPTION_CLOSURE') {
      const raw = event.payload;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Payload de encerramento familiar inválido.');
      }
      const payload = raw as Record<string, unknown>;
      const contaId = String(payload.contaId ?? '');
      const aggregateId = String(payload.aggregateId ?? '');
      const sourceFinancialAgreementId = String(payload.sourceFinancialAgreementId ?? '');
      const sourceAsaasSubscriptionId =
        typeof payload.sourceAsaasSubscriptionId === 'string'
          ? payload.sourceAsaasSubscriptionId
          : null;
      const effectiveDate = String(payload.effectiveDate ?? '');

      if (!contaId || !aggregateId || !sourceFinancialAgreementId) {
        throw new Error('Payload de encerramento familiar sem identificadores obrigatórios.');
      }

      await prisma.rematriculaFamiliar.updateMany({
        where: { id: aggregateId, contaId },
        data: {
          step: 'ENCERRAMENTO_ORIGEM_SOLICITADO',
          sourceBillingStatus: sourceAsaasSubscriptionId ? 'CLOSURE_REQUESTED' : 'REVIEW_MANUAL',
        },
      });

      if (sourceAsaasSubscriptionId) {
        const subscriptionUpdate: Parameters<typeof updateSubscription>[1] = {
          endDate: effectiveDate,
        };
        if (!isFutureDateOnly(effectiveDate)) {
          subscriptionUpdate.status = 'INACTIVE';
        }

        await updateSubscription(
          sourceAsaasSubscriptionId,
          subscriptionUpdate,
          { contaId },
        );
      }

      await prisma.standaloneSubscription.updateMany({
        where: { id: sourceFinancialAgreementId, contaId },
        data: {
          closureScheduledAt: new Date(),
          validUntil: effectiveDate ? new Date(`${effectiveDate}T12:00:00.000Z`) : undefined,
          familyTransitionId: aggregateId,
        },
      });

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
    }

    parsedFamilyPayload = parseFamilyBillingPayload(event.payload);
    await executeFamilyBilling(parsedFamilyPayload);

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
    const uncertain = isUncertainFinancialResult(error);
    if (parsedFamilyPayload) {
      if (uncertain) {
        await persistAggregateUncertain(parsedFamilyPayload, message);
      } else {
        await persistAggregateFailure(parsedFamilyPayload, message);
      }
    } else if (event.aggregateType === 'REMATRICULA_FAMILIAR') {
      await prisma.rematriculaFamiliar.updateMany({
        where: { id: event.aggregateId, contaId: event.contaId },
        data: {
          status: FamilyBillingStatus.FALHO,
          ultimoErro: uncertain
            ? `RESULTADO_INCERTO: ${message.slice(0, 1900)}`
            : message.slice(0, 2000),
          failureMessage: message.slice(0, 2000),
        },
      });
    }
    await prisma.familyBillingOutbox.update({
      where: { id: eventId },
      data: {
        status: uncertain
          ? FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION
          : FamilyBillingOutboxStatus.FAILED,
        lockedAt: null,
        lastError: message.slice(0, 2000),
      },
    });
    if (uncertain) {
      return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
    }
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
  let requiresReconciliation = 0;

  for (const event of events) {
    try {
      const result = await processFamilyBillingOutboxEvent(event.id);
      if (result.processed) processed += 1;
      if (result.reason === 'REQUIRES_RECONCILIATION') requiresReconciliation += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: events.length,
    processed,
    failed,
    requiresReconciliation,
  };
}
