import { prisma } from '@alusa/database';
import {
  createStandaloneCharge,
  type CreateStandaloneChargeInput,
} from '../use-cases/create-standalone-charge.js';
import { getSubscription } from '../use-cases/asaas-ops.js';
import { projectFamilyEnrollmentFeeState } from '../projections/enrollment-fee-projection.service.js';
import {
  FamilyBillingOutboxStatus,
  FamilyBillingStatus,
  MatriculaBillingProvisionStatus,
  type Prisma,
} from '@prisma/client';
import { decideFamilySubscriptionUpdate } from './subscription-update-decision.js';
import { materializeBillingAgreement } from '../billing-agreements/materialize.js';
import {
  commitBillingAgreementChange,
  previewBillingAgreementChange,
} from '../billing-agreements/runtime.js';
import { processPendingBillingAdjustments } from '../billing-agreements/adjustment-processor.js';

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
  strategy?: 'SEPARATE' | 'JOIN_EXISTING_CURRENT_CYCLE' | 'SCHEDULE_NEXT_CYCLE_UNIFICATION';
  operationId?: string | null;
  targetStandaloneSubscriptionId?: string | null;
  scheduledEffectiveAt?: string | null;
  expectedBillingVersion?: number | null;
  previousMonthlyValue?: number | null;
  resultingMonthlyValue?: number | null;
  notificationChannels?: SupportedNotificationChannel[];
  notificationChannelsConfigured?: boolean;
  discount?: DiscountPayload | null;
  interest?: InterestPayload | null;
  fine?: FinePayload | null;
};

export type FamilyBillingExecutionResult = {
  standaloneSubscriptionId: string | null;
  standaloneEnrollmentChargeId: string | null;
  standaloneTuitionChargeId?: string | null;
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
    strategy:
      payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE'
        ? 'JOIN_EXISTING_CURRENT_CYCLE'
        : payload.strategy === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
          ? 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
          : 'SEPARATE',
    operationId: typeof payload.operationId === 'string' ? payload.operationId : null,
    targetStandaloneSubscriptionId:
      typeof payload.targetStandaloneSubscriptionId === 'string'
        ? payload.targetStandaloneSubscriptionId
        : null,
    scheduledEffectiveAt:
      typeof payload.scheduledEffectiveAt === 'string' ? payload.scheduledEffectiveAt : null,
    expectedBillingVersion:
      Number.isInteger(payload.expectedBillingVersion) ? Number(payload.expectedBillingVersion) : null,
    previousMonthlyValue:
      Number.isFinite(Number(payload.previousMonthlyValue))
        ? Number(payload.previousMonthlyValue)
        : null,
    resultingMonthlyValue:
      Number.isFinite(Number(payload.resultingMonthlyValue))
        ? Number(payload.resultingMonthlyValue)
        : null,
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
        where: { id: { in: chargeIds }, contaId: params.contaId },
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

async function linkFamilyEnrollmentCharge(
  payload: FamilyBillingPayload,
  chargeId: string,
) {
  if (payload.aggregateType !== 'MATRICULA_FAMILIAR') return;

  await updateGroupMetadata({
    contaId: payload.contaId,
    familyGroupId: payload.aggregateId,
    standaloneChargeId: chargeId,
  });
  await prisma.familyFinancialAllocation.updateMany({
    where: {
      contaId: payload.contaId,
      familyGroupId: payload.aggregateId,
      ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
      chargeKind: 'TAXA_MATRICULA',
      status: 'PENDING',
    },
    data: {
      sourceChargeId: chargeId,
      sourceAgreementId: null,
      status: 'AWAITING_WEBHOOK',
    },
  });
  await projectFamilyEnrollmentFeeState({
    contaId: payload.contaId,
    chargeId,
    eventName: 'FAMILY_BILLING_LINKED',
  });
}

async function persistAggregateSuccess(params: {
  payload: FamilyBillingPayload;
  subscriptionId?: string | null;
  enrollmentChargeId?: string | null;
}) {
  if (params.payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.updateMany({
      where: { id: params.payload.aggregateId, contaId: params.payload.contaId },
      data: {
        status: FamilyBillingStatus.ATIVO,
        billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
        standaloneSubscriptionId: params.subscriptionId ?? null,
        standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null,
        ultimoErro: null,
      },
    });
    return;
  }

  await prisma.rematriculaFamiliar.updateMany({
    where: { id: params.payload.aggregateId, contaId: params.payload.contaId },
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
  const hasPersistedFinancialEffect =
    payload.aggregateType === 'MATRICULA_FAMILIAR'
      ? Boolean(
          await prisma.familyFinancialAllocation.findFirst({
            where: {
              contaId: payload.contaId,
              familyGroupId: payload.aggregateId,
              ...(payload.operationId
                ? { familyEnrollmentOperationId: payload.operationId }
                : {}),
              OR: [
                { sourceChargeId: { not: null } },
                { standaloneSubscriptionId: { not: null } },
              ],
            },
            select: { id: true },
          }),
        )
      : false;
  const data = {
    status: hasPersistedFinancialEffect ? FamilyBillingStatus.PARCIAL : FamilyBillingStatus.FALHO,
    billingProvisionStatus: hasPersistedFinancialEffect
      ? MatriculaBillingProvisionStatus.PARCIAL
      : MatriculaBillingProvisionStatus.FALHO,
    ultimoErro: message.slice(0, 2000),
  };

  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.updateMany({
      where: {
        id: payload.aggregateId,
        contaId: payload.contaId,
        billingProvisionStatus: { not: MatriculaBillingProvisionStatus.RESULTADO_INCERTO },
      },
      data:
        payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE'
          ? {
              status: FamilyBillingStatus.PARCIAL,
              billingProvisionStatus: MatriculaBillingProvisionStatus.PARCIAL,
              ultimoErro: message.slice(0, 2000),
            }
          : data,
    });
    if (payload.operationId) {
      await prisma.familyEnrollmentOperation.updateMany({
        where: {
          id: payload.operationId,
          contaId: payload.contaId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: { status: 'FAILED', lastError: message.slice(0, 2000) },
      });
    }
    return;
  }

  await prisma.rematriculaFamiliar.updateMany({
    where: { id: payload.aggregateId, contaId: payload.contaId },
    data,
  });
}

async function persistAggregateUncertain(payload: FamilyBillingPayload, message: string) {
  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await prisma.matriculaFamiliar.updateMany({
      where: { id: payload.aggregateId, contaId: payload.contaId },
      data: {
        billingProvisionStatus: MatriculaBillingProvisionStatus.RESULTADO_INCERTO,
        ultimoErro: `RESULTADO_INCERTO: ${message.slice(0, 1900)}`,
      },
    });
    if (payload.operationId) {
      await prisma.familyEnrollmentOperation.updateMany({
        where: { id: payload.operationId, contaId: payload.contaId },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          lastError: `RESULTADO_INCERTO: ${message.slice(0, 1900)}`,
        },
      });
    }
    return;
  }
  await persistAggregateFailure(payload, `RESULTADO_INCERTO: ${message.slice(0, 1900)}`);
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

async function scheduleNextCycleFamilyUnification(input: {
  payload: FamilyBillingPayload;
  sourceAgreementId: string;
}) {
  const { payload } = input;
  if (
    payload.strategy !== 'SCHEDULE_NEXT_CYCLE_UNIFICATION' ||
    !payload.targetStandaloneSubscriptionId ||
    !payload.scheduledEffectiveAt
  ) {
    return;
  }

  const effectiveDate = payload.scheduledEffectiveAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error('DATA_EFETIVA_UNIFICACAO_INVALIDA');
  }
  const targetSubscription = await prisma.standaloneSubscription.findFirst({
    where: {
      id: payload.targetStandaloneSubscriptionId,
      contaId: payload.contaId,
      familyGroupId: { not: payload.aggregateId },
    },
    select: { id: true, familyGroupId: true },
  });
  if (!targetSubscription?.familyGroupId) {
    throw new Error('ASSINATURA_DESTINO_UNIFICACAO_NAO_ENCONTRADA');
  }

  const targetAgreement = await materializeBillingAgreement({
    kind: 'FAMILY',
    contaId: payload.contaId,
    standaloneSubscriptionId: targetSubscription.id,
    familyGroupId: targetSubscription.familyGroupId,
    actorId: payload.actorId,
  });
  const sourceAllocations = await prisma.billingAllocation.findMany({
    where: {
      contaId: payload.contaId,
      agreementId: input.sourceAgreementId,
      kind: 'TUITION',
      recurring: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (sourceAllocations.length === 0) {
    throw new Error('ALOCACOES_UNIFICACAO_NAO_ENCONTRADAS');
  }

  const change = {
    contaId: payload.contaId,
    agreementId: input.sourceAgreementId,
    actorId: payload.actorId,
    reason: 'Unificação familiar programada na matrícula',
    kind: 'TRANSFER_ALLOCATION' as const,
    allocationIds: sourceAllocations.map((allocation) => allocation.id),
    targetAgreementId: targetAgreement.id,
    effectivePolicy: 'NEXT_CYCLE' as const,
    effectiveDate,
  };
  const preview = await previewBillingAgreementChange(change);
  if (preview.blockers.length > 0) {
    throw new Error(`UNIFICACAO_AGENDADA_BLOQUEADA:${preview.blockers.join('|')}`);
  }
  await commitBillingAgreementChange({
    ...change,
    uiRequestId: `family-unification:${payload.operationId ?? payload.aggregateId}`,
    previewHash: preview.previewHash,
    previewExpiresAt: preview.expiresAt,
    expectedAgreementVersion: preview.sourceVersion,
  });
}

/**
 * Executa a cobrança consolidada da família (taxa avulsa + assinatura recorrente)
 * de forma idempotente. Pode ser chamado inline (rota /api/matriculas/familiar)
 * ou via outbox (cron de retry/recovery).
 *
 * Em JOIN, todo o preflight da assinatura ocorre antes de criar a taxa. Depois
 * de cada efeito remoto, o vínculo local é persistido imediatamente. Em retry,
 * as chamadas convergem pelo `uiRequestId` e pelo valor remoto confirmado.
 */
export async function executeFamilyBilling(
  payload: FamilyBillingPayload,
): Promise<FamilyBillingExecutionResult> {
  const monthlyValue = ensurePositiveMoney(payload.monthlyValue);
  const enrollmentFeeValue = ensurePositiveMoney(payload.enrollmentFeeValue);
  let standaloneSubscriptionId: string | null = null;
  let standaloneEnrollmentChargeId: string | null = null;
  let standaloneTuitionChargeId: string | null = null;
  let joinTarget: { id: string; asaasSubscriptionId: string } | null = null;
  let joinUpdateDecision: ReturnType<typeof decideFamilySubscriptionUpdate> | null = null;
  let joinPreviousValue = 0;
  let joinDesiredValue = 0;
  let canonicalJoin: { agreementId: string; operationId: string } | null = null;

  if (payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE') {
    if (
      !payload.operationId ||
      !payload.targetStandaloneSubscriptionId ||
      payload.expectedBillingVersion == null ||
      payload.previousMonthlyValue == null ||
      payload.resultingMonthlyValue == null
    ) {
      throw new Error('PAYLOAD_JOIN_FAMILIAR_INCOMPLETO');
    }
    const [target, family] = await Promise.all([
      prisma.standaloneSubscription.findFirst({
        where: {
          id: payload.targetStandaloneSubscriptionId,
          contaId: payload.contaId,
          familyGroupId: payload.aggregateId,
        },
        select: { id: true, asaasSubscriptionId: true },
      }),
      prisma.matriculaFamiliar.findFirst({
        where: { id: payload.aggregateId, contaId: payload.contaId },
        select: { billingVersion: true },
      }),
    ]);
    if (!target?.asaasSubscriptionId || !family) {
      throw new Error('ASSINATURA_FAMILIAR_DESTINO_NAO_PROVISIONADA');
    }
    if (family.billingVersion !== payload.expectedBillingVersion) {
      throw new Error('VERSAO_FINANCEIRA_FAMILIAR_DIVERGENTE');
    }
    if (monthlyValue > 0) {
      const remoteBefore = await getSubscription(target.asaasSubscriptionId, {
        contaId: payload.contaId,
      });
      joinPreviousValue = payload.previousMonthlyValue;
      joinDesiredValue = payload.resultingMonthlyValue;
      joinUpdateDecision = decideFamilySubscriptionUpdate({
        previousValue: joinPreviousValue,
        desiredValue: joinDesiredValue,
        remoteValue: Number(remoteBefore.value),
      });
      if (joinUpdateDecision.action === 'REQUIRES_RECONCILIATION') {
        throw new Error(
          `RESULTADO_INCERTO:VALOR_ASSINATURA_FAMILIAR_DIVERGENTE:esperado=${joinUpdateDecision.previousValue}:remoto=${joinUpdateDecision.remoteValue}`,
        );
      }
    }
    joinTarget = { id: target.id, asaasSubscriptionId: target.asaasSubscriptionId };
  }

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
    // Persiste o efeito financeiro antes de iniciar outra chamada externa. Assim,
    // uma falha/timeout na assinatura não deixa a taxa real órfã no estado local.
    await linkFamilyEnrollmentCharge(payload, standaloneEnrollmentChargeId);
  }

  if (monthlyValue > 0 && payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE') {
    if (!joinTarget || !joinUpdateDecision) {
      throw new Error('PAYLOAD_JOIN_FAMILIAR_INCOMPLETO');
    }
    const targetAgreement = await materializeBillingAgreement({
      kind: 'FAMILY',
      contaId: payload.contaId,
      standaloneSubscriptionId: joinTarget.id,
      familyGroupId: payload.aggregateId,
      actorId: payload.actorId,
    });
    const canonicalUiRequestId = `family-current-cycle:${payload.operationId ?? payload.aggregateId}`;
    const completedCanonicalOperation = await prisma.billingChangeOperation.findFirst({
      where: { contaId: payload.contaId, uiRequestId: canonicalUiRequestId, status: 'COMPLETED' },
      select: { id: true },
    });
    const pendingAllocations = await prisma.familyFinancialAllocation.findMany({
      where: {
        contaId: payload.contaId,
        familyGroupId: payload.aggregateId,
        ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
        chargeKind: 'MENSALIDADE',
        status: { in: ['PENDING', 'PROCESSING', 'ACTIVE'] },
        matriculaId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (pendingAllocations.length === 0) throw new Error('ALOCACOES_FAMILIARES_PENDENTES_NAO_ENCONTRADAS');
    const dayAfter = (value: Date) => {
      const date = new Date(value);
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().slice(0, 10);
    };
    const change = {
      contaId: payload.contaId,
      agreementId: targetAgreement.id,
      actorId: payload.actorId,
      reason: `Inclusão familiar ${payload.aggregateId} em cobrança existente`,
      kind: 'ADD_ALLOCATION' as const,
      effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
      effectiveDate: pendingAllocations[0]!.competenceStart.toISOString().slice(0, 10),
      allocations: pendingAllocations.map((allocation) => ({
        clientId: allocation.id,
        enrollmentId: allocation.matriculaId!,
        studentId: allocation.alunoId,
        kind: 'TUITION' as const,
        recurring: true,
        baseAmountCents: Math.round(Number(allocation.baseAmount ?? allocation.amount) * 100),
        discountAmountCents: Math.round(Number(allocation.discountAmount ?? 0) * 100),
        netAmountCents: Math.round(Number(allocation.amount) * 100),
        validFrom: allocation.competenceStart.toISOString().slice(0, 10),
        validUntil: dayAfter(allocation.competenceEnd ?? new Date(`${payload.endDate}T00:00:00.000Z`)),
        prorationPolicy: 'FULL_CURRENT_CYCLE' as const,
      })),
    };
    let canonicalOperationId = completedCanonicalOperation?.id ?? null;
    if (!canonicalOperationId) {
      const preview = await previewBillingAgreementChange(change);
      if (preview.blockers.length > 0) {
        throw new Error(`UNIFICACAO_FAMILIAR_BLOQUEADA:${preview.blockers.join('|')}`);
      }
      if (preview.adjustments.some((adjustment) => adjustment.type === 'MANUAL_REVIEW')) {
        throw new Error('RESULTADO_INCERTO:CICLO_FAMILIAR_REQUER_REVISAO_MANUAL');
      }
      const result = await commitBillingAgreementChange({
        ...change,
        uiRequestId: canonicalUiRequestId,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedAgreementVersion: preview.sourceVersion,
      });
      if (result.status === 'REQUIRES_RECONCILIATION') {
        throw new Error(`RESULTADO_INCERTO:OPERACAO_CANONICA_FAMILIAR:${result.operationId}`);
      }
      canonicalOperationId = result.operationId;
    }
    const pendingCanonicalAdjustment = await prisma.billingAdjustment.findFirst({
      where: { contaId: payload.contaId, operationId: canonicalOperationId, status: { not: 'APPLIED' } },
      select: { id: true },
    });
    if (pendingCanonicalAdjustment) {
      await processPendingBillingAdjustments({ contaId: payload.contaId, operationId: canonicalOperationId });
      const unresolved = await prisma.billingAdjustment.findFirst({
        where: { contaId: payload.contaId, operationId: canonicalOperationId, status: { not: 'APPLIED' } },
        select: { status: true, lastError: true },
      });
      if (unresolved) {
        if (unresolved.status === 'PENDING' || unresolved.status === 'FAILED' || unresolved.status === 'PROCESSING') {
          throw new Error(`AJUSTE_FAMILIAR_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`);
        }
        throw new Error(`RESULTADO_INCERTO:AJUSTE_FAMILIAR_${unresolved.status}:${unresolved.lastError ?? ''}`);
      }
    }
    const canonicalAllocationCount = await prisma.billingAllocation.count({
      where: {
        contaId: payload.contaId,
        agreementId: targetAgreement.id,
        sourceOperationId: canonicalOperationId,
        matriculaId: { in: pendingAllocations.map((allocation) => allocation.matriculaId!) },
        kind: 'TUITION',
      },
    });
    if (canonicalAllocationCount !== pendingAllocations.length) {
      throw new Error(`RESULTADO_INCERTO:PROJECAO_CANONICA_FAMILIAR_INCOMPLETA:${canonicalOperationId}`);
    }
    canonicalJoin = { agreementId: targetAgreement.id, operationId: canonicalOperationId };
    standaloneSubscriptionId = joinTarget.id;
  } else if (monthlyValue > 0) {
    const shortContract = payload.endDate < payload.nextDueDate;
    const subscriptionResult = await createStandaloneCharge(shortContract
      ? {
          ...buildStandaloneBaseInput(payload, { description: `${payload.description} · contrato curto` }),
          ...buildBillingAdjustments(payload),
          chargeType: 'ONE_TIME',
          value: monthlyValue,
          dueDate: payload.endDate,
          uiRequestId: `${payload.aggregateId}:short-tuition:${payload.uiRequestId ?? 'shared'}`,
        }
      : {
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

    if (shortContract) standaloneTuitionChargeId = subscriptionResult.data.chargeId;
    else standaloneSubscriptionId = subscriptionResult.data.chargeId;
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
        ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
        chargeKind: 'MENSALIDADE',
        status: 'PENDING',
      },
      data: {
        standaloneSubscriptionId,
        sourceChargeId: standaloneTuitionChargeId,
        sourceAgreementId: canonicalJoin?.agreementId ?? standaloneSubscriptionId,
        status:
          payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE'
            ? 'PROCESSING'
            : 'AWAITING_WEBHOOK',
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

  if (payload.aggregateType === 'MATRICULA_FAMILIAR' && payload.operationId) {
    const isJoin = payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE';
    await prisma.$transaction(async (tx) => {
      if (isJoin) {
        const updated = await tx.matriculaFamiliar.updateMany({
          where: {
            id: payload.aggregateId,
            contaId: payload.contaId,
            billingVersion: payload.expectedBillingVersion ?? undefined,
          },
          data: {
            valorMensalidadeTotal: payload.resultingMonthlyValue ?? monthlyValue,
            totalAlunos: payload.totalAlunos,
            billingVersion: { increment: 1 },
            billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
            ultimoErro: null,
          },
        });
        if (updated.count === 0) {
          throw new Error('RESULTADO_INCERTO:VERSAO_FINANCEIRA_FAMILIAR_DIVERGENTE_APOS_PUT');
        }
        if (monthlyValue > 0) {
          const subscriptionUpdated = await tx.standaloneSubscription.updateMany({
            where: { id: standaloneSubscriptionId ?? '', contaId: payload.contaId },
            data: {
              value: payload.resultingMonthlyValue ?? monthlyValue,
              version: { increment: 1 },
            },
          });
          if (subscriptionUpdated.count === 0) {
            throw new Error('RESULTADO_INCERTO:ASSINATURA_LOCAL_AUSENTE_APOS_PUT');
          }
          await tx.familyFinancialAllocation.updateMany({
            where: {
              contaId: payload.contaId,
              familyGroupId: payload.aggregateId,
              familyEnrollmentOperationId: payload.operationId,
              chargeKind: 'MENSALIDADE',
              status: 'PROCESSING',
            },
            data: { status: 'ACTIVE', sourceAgreementId: canonicalJoin?.agreementId },
          });
        }
      } else {
        await tx.matriculaFamiliar.updateMany({
          where: { id: payload.aggregateId, contaId: payload.contaId },
          data: {
            status: FamilyBillingStatus.ATIVO,
            billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
            standaloneSubscriptionId,
            standaloneEnrollmentChargeId,
            ultimoErro: null,
          },
        });
      }
      const completedOperation = await tx.familyEnrollmentOperation.updateMany({
        where: {
          id: payload.operationId!,
          contaId: payload.contaId,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: { status: 'COMPLETED', completedAt: new Date(), lastError: null },
      });
      if (completedOperation.count === 0) {
        const alreadyCompleted = await tx.familyEnrollmentOperation.findFirst({
          where: { id: payload.operationId!, contaId: payload.contaId, status: 'COMPLETED' },
          select: { id: true },
        });
        if (!alreadyCompleted) {
          throw new Error('RESULTADO_INCERTO:OPERACAO_FAMILIAR_NAO_PODE_SER_CONCLUIDA');
        }
      }
    });
  } else {
    await persistAggregateSuccess({
      payload,
      subscriptionId: standaloneSubscriptionId,
      enrollmentChargeId: standaloneEnrollmentChargeId,
    });
  }

  if (standaloneSubscriptionId && payload.aggregateType === 'MATRICULA_FAMILIAR') {
    const sourceAgreement = await materializeBillingAgreement({
      kind: 'FAMILY',
      contaId: payload.contaId,
      standaloneSubscriptionId,
      familyGroupId: payload.aggregateId,
      actorId: payload.actorId,
      terms: {
        interestValue: payload.interest?.value ?? null,
        interestType: payload.interest ? 'PERCENTAGE' : null,
        fineValue: payload.fine?.value ?? null,
        fineType: payload.fine?.type ?? null,
        discountValue: payload.discount?.value ?? null,
        discountType: payload.discount?.type ?? null,
        discountDueDateLimitDays: payload.discount?.dueDateLimitDays ?? null,
      },
    });
    await scheduleNextCycleFamilyUnification({
      payload,
      sourceAgreementId: sourceAgreement.id,
    });
  }

  return { standaloneSubscriptionId, standaloneEnrollmentChargeId, standaloneTuitionChargeId };
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
  if (
    input.payload.contaId !== input.contaId ||
    input.payload.aggregateId !== input.aggregateId ||
    input.payload.aggregateType !== input.aggregateType
  ) {
    throw new Error('PAYLOAD_OUTBOX_FAMILIAR_DIVERGENTE');
  }
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

  const claimedAt = new Date();
  const claimed = await prisma.familyBillingOutbox.updateMany({
    where: {
      id: eventId,
      contaId: event.contaId,
      status: { in: [FamilyBillingOutboxStatus.PENDING, FamilyBillingOutboxStatus.FAILED] },
    },
    data: {
      status: FamilyBillingOutboxStatus.PROCESSING,
      lockedAt: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 5 * 60 * 1000),
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
      const payloadContaId = String(payload.contaId ?? '');
      const payloadAggregateId = String(payload.aggregateId ?? '');
      const sourceFinancialAgreementId = String(payload.sourceFinancialAgreementId ?? '');
      const payloadAsaasSubscriptionId =
        typeof payload.sourceAsaasSubscriptionId === 'string'
          ? payload.sourceAsaasSubscriptionId
          : null;
      const effectiveDate = String(payload.effectiveDate ?? '');

      if (
        payloadContaId !== event.contaId ||
        payloadAggregateId !== event.aggregateId ||
        !sourceFinancialAgreementId
      ) {
        throw new Error('PAYLOAD_OUTBOX_FAMILIAR_DIVERGENTE');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
        throw new Error('Payload de encerramento familiar sem identificadores obrigatórios.');
      }
      const sourceSubscription = await prisma.standaloneSubscription.findFirst({
        where: { id: sourceFinancialAgreementId, contaId: event.contaId },
        select: { id: true, asaasSubscriptionId: true, familyGroupId: true },
      });
      if (!sourceSubscription) throw new Error('ASSINATURA_ORIGEM_NAO_ENCONTRADA_NO_TENANT');
      if (
        payloadAsaasSubscriptionId &&
        payloadAsaasSubscriptionId !== sourceSubscription.asaasSubscriptionId
      ) {
        throw new Error('ASSINATURA_ASAAS_DO_PAYLOAD_DIVERGENTE');
      }
      const sourceAsaasSubscriptionId = sourceSubscription.asaasSubscriptionId;
      const closureUiRequestId = `family-source-closure:${event.aggregateId}:${sourceSubscription.id}`;
      const completedClosureOperation = await prisma.billingChangeOperation.findFirst({
        where: { contaId: event.contaId, uiRequestId: closureUiRequestId, status: 'COMPLETED' },
        select: { id: true },
      });

      if (completedClosureOperation) {
        const pendingRecoveredAdjustment = await prisma.billingAdjustment.findFirst({
          where: {
            contaId: event.contaId,
            operationId: completedClosureOperation.id,
            status: { not: 'APPLIED' },
          },
          select: { id: true },
        });
        if (pendingRecoveredAdjustment) {
          await processPendingBillingAdjustments({
            contaId: event.contaId,
            operationId: completedClosureOperation.id,
          });
          const unresolved = await prisma.billingAdjustment.findFirst({
            where: {
              contaId: event.contaId,
              operationId: completedClosureOperation.id,
              status: { not: 'APPLIED' },
            },
            select: { status: true, lastError: true },
          });
          if (unresolved) {
            if (unresolved.status === 'PENDING' || unresolved.status === 'FAILED' || unresolved.status === 'PROCESSING') {
              throw new Error(`AJUSTE_ENCERRAMENTO_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`);
            }
            throw new Error(`RESULTADO_INCERTO:AJUSTE_ENCERRAMENTO_${unresolved.status}:${unresolved.lastError ?? ''}`);
          }
        }
      }

      await prisma.rematriculaFamiliar.updateMany({
        where: { id: event.aggregateId, contaId: event.contaId },
        data: {
          step: 'ENCERRAMENTO_ORIGEM_SOLICITADO',
          sourceBillingStatus: sourceAsaasSubscriptionId ? 'CLOSURE_REQUESTED' : 'REVIEW_MANUAL',
        },
      });

      if (sourceAsaasSubscriptionId && !completedClosureOperation) {
        if (!sourceSubscription.familyGroupId) {
          throw new Error('ASSINATURA_ORIGEM_SEM_GRUPO_FAMILIAR');
        }
        const sourceAgreement = await materializeBillingAgreement({
          kind: 'FAMILY',
          contaId: event.contaId,
          standaloneSubscriptionId: sourceSubscription.id,
          familyGroupId: sourceSubscription.familyGroupId,
          actorId: 'family-billing-outbox',
        });
        const recurringAllocations = await prisma.billingAllocation.findMany({
          where: {
            contaId: event.contaId,
            agreementId: sourceAgreement.id,
            recurring: true,
            status: { in: ['ACTIVE', 'SCHEDULED'] },
          },
          orderBy: { id: 'asc' },
        });
        if (recurringAllocations.length === 0) {
          throw new Error('ALOCACOES_CANONICAS_DA_ORIGEM_NAO_ENCONTRADAS');
        }
        const inclusiveEnd = new Date(`${effectiveDate}T00:00:00.000Z`);
        const exclusiveEnd = new Date(inclusiveEnd);
        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
        const today = new Date().toISOString().slice(0, 10);
        const closureChange = {
          contaId: event.contaId,
          agreementId: sourceAgreement.id,
          actorId: 'family-billing-outbox',
          reason: `Encerramento da cobrança familiar de origem ${sourceSubscription.id}`,
          kind: 'UPDATE_ALLOCATION' as const,
          effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
          effectiveDate: today,
          allocations: recurringAllocations.map((allocation) => ({
            allocationId: allocation.id,
            recurring: true,
            baseAmountCents: Math.round(Number(allocation.baseAmount) * 100),
            discountAmountCents: Math.round(Number(allocation.discountAmount) * 100),
            netAmountCents: Math.round(Number(allocation.netAmount) * 100),
            validFrom: today,
            validUntil: exclusiveEnd.toISOString().slice(0, 10),
            prorationPolicy: 'FULL_CURRENT_CYCLE' as const,
          })),
        };
        const closurePreview = await previewBillingAgreementChange(closureChange);
        if (closurePreview.blockers.length > 0 || closurePreview.adjustments.some((item) => item.type === 'MANUAL_REVIEW')) {
          throw new Error(`ENCERRAMENTO_CANONICO_BLOQUEADO:${closurePreview.blockers.join('|') || 'MANUAL_REVIEW'}`);
        }
        const closureResult = await commitBillingAgreementChange({
          ...closureChange,
          uiRequestId: closureUiRequestId,
          previewHash: closurePreview.previewHash,
          previewExpiresAt: closurePreview.expiresAt,
          expectedAgreementVersion: closurePreview.sourceVersion,
        });
        if (closureResult.status === 'REQUIRES_RECONCILIATION') {
          throw new Error(`RESULTADO_INCERTO:ENCERRAMENTO_CANONICO:${closureResult.operationId}`);
        }
        const pendingClosureAdjustment = await prisma.billingAdjustment.findFirst({
          where: { contaId: event.contaId, operationId: closureResult.operationId, status: { not: 'APPLIED' } },
          select: { id: true },
        });
        if (pendingClosureAdjustment) {
          await processPendingBillingAdjustments({ contaId: event.contaId, operationId: closureResult.operationId });
          const unresolved = await prisma.billingAdjustment.findFirst({
            where: { contaId: event.contaId, operationId: closureResult.operationId, status: { not: 'APPLIED' } },
            select: { status: true, lastError: true },
          });
          if (unresolved) {
            if (unresolved.status === 'PENDING' || unresolved.status === 'FAILED' || unresolved.status === 'PROCESSING') {
              throw new Error(`AJUSTE_ENCERRAMENTO_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`);
            }
            throw new Error(`RESULTADO_INCERTO:AJUSTE_ENCERRAMENTO_${unresolved.status}:${unresolved.lastError ?? ''}`);
          }
        }
      }

      await prisma.standaloneSubscription.updateMany({
        where: { id: sourceFinancialAgreementId, contaId: event.contaId },
        data: {
          closureScheduledAt: new Date(),
          validUntil: effectiveDate ? new Date(`${effectiveDate}T12:00:00.000Z`) : undefined,
          familyTransitionId: event.aggregateId,
        },
      });

      await prisma.familyBillingOutbox.updateMany({
        where: {
          id: eventId,
          contaId: event.contaId,
          status: FamilyBillingOutboxStatus.PROCESSING,
          lockedAt: claimedAt,
        },
        data: {
          status: FamilyBillingOutboxStatus.PROCESSED,
          processedAt: new Date(),
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });

      return { processed: true as const };
    }

    parsedFamilyPayload = parseFamilyBillingPayload(event.payload);
    if (
      parsedFamilyPayload.contaId !== event.contaId ||
      parsedFamilyPayload.aggregateId !== event.aggregateId ||
      parsedFamilyPayload.aggregateType !== event.aggregateType
    ) {
      throw new Error('PAYLOAD_OUTBOX_FAMILIAR_DIVERGENTE');
    }
    await executeFamilyBilling(parsedFamilyPayload);

    const completed = await prisma.familyBillingOutbox.updateMany({
      where: {
        id: eventId,
        contaId: event.contaId,
        status: FamilyBillingOutboxStatus.PROCESSING,
        lockedAt: claimedAt,
      },
      data: {
        status: FamilyBillingOutboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });

    if (completed.count === 0) {
      return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
    }

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
    await prisma.familyBillingOutbox.updateMany({
      where: {
        id: eventId,
        contaId: event.contaId,
        status: FamilyBillingOutboxStatus.PROCESSING,
        lockedAt: claimedAt,
      },
      data: {
        status: uncertain
          ? FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION
          : FamilyBillingOutboxStatus.FAILED,
        lockedAt: null,
        leaseExpiresAt: null,
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
  const expiredLeases = await prisma.familyBillingOutbox.findMany({
    where: {
      status: FamilyBillingOutboxStatus.PROCESSING,
      leaseExpiresAt: { lte: new Date() },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    take: limit,
    select: { id: true, contaId: true, matriculaFamiliarId: true, payload: true },
  });
  for (const expired of expiredLeases) {
    let operationId: string | null = null;
    try {
      operationId = parseFamilyBillingPayload(expired.payload).operationId ?? null;
    } catch {
      // Payload inválido não pode manter o lote inteiro preso em PROCESSING.
    }
    await prisma.$transaction(async (tx) => {
      const reclaimed = await tx.familyBillingOutbox.updateMany({
        where: {
          id: expired.id,
          contaId: expired.contaId,
          status: FamilyBillingOutboxStatus.PROCESSING,
          leaseExpiresAt: { lte: new Date() },
        },
        data: {
          status: FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: 'LEASE_EXPIRADA_APOS_POSSIVEL_EFEITO_REMOTO',
        },
      });
      if (reclaimed.count === 0) return;

      let operationReclaimed = !operationId;
      if (operationId) {
        const operation = await tx.familyEnrollmentOperation.updateMany({
          where: {
            id: operationId,
            contaId: expired.contaId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'REQUIRES_RECONCILIATION',
            lastError: 'LEASE_EXPIRADA_APOS_POSSIVEL_EFEITO_REMOTO',
          },
        });
        operationReclaimed = operation.count > 0;
      }
      if (expired.matriculaFamiliarId && operationReclaimed) {
        await tx.matriculaFamiliar.updateMany({
          where: { id: expired.matriculaFamiliarId, contaId: expired.contaId },
          data: {
            billingProvisionStatus: MatriculaBillingProvisionStatus.RESULTADO_INCERTO,
            ultimoErro: 'LEASE_EXPIRADA_APOS_POSSIVEL_EFEITO_REMOTO',
          },
        });
      }
    });
  }
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
    requiresReconciliation: requiresReconciliation + expiredLeases.length,
  };
}
