import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { assertCompleteAsaasPage } from '../use-cases/asaas-pagination';
import { prisma } from '@alusa/database';
import {
  createStandaloneCharge,
  type CreateStandaloneChargeInput,
} from '../use-cases/create-standalone-charge';
import {
  deletePayment,
  deleteSubscription,
  getPayment,
  getSubscription,
  listPayments,
} from '../use-cases/asaas-ops';
import { projectFamilyEnrollmentFeeState } from '../projections/enrollment-fee-projection.service';
import {
  FamilyBillingOutboxStatus,
  FamilyBillingStatus,
  MatriculaBillingProvisionStatus,
  StatusMatricula,
  type Prisma,
} from '@prisma/client';
import { decideFamilySubscriptionUpdate } from './subscription-update-decision';
import { materializeBillingAgreement } from '../billing-agreements/materialize';
import {
  commitBillingAgreementChange,
  previewBillingAgreementChange,
} from '../billing-agreements/runtime';
import { processPendingBillingAdjustments } from '../billing-agreements/adjustment-processor';
import { deriveDeterministicId } from '../core/index';
import { resolveFamilyOperationFutureStart, resolveFutureFamilyBillingAmounts } from './future-family-billing';
import { decideEnrollmentStatusAtContractStart } from '@alusa/domain';
import { isAcademicDateInFuture } from '@alusa/shared/date-only';

export type SupportedNotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type SupportedBillingType = 'BOLETO' | 'PIX' | 'CREDIT_CARD';
export type SupportedCycle = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

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
  billingPhase?: 'ENROLLMENT_FEE' | 'RECURRING' | null;
  deferActivationUntil?: string | null;
  billableMatriculaIds?: string[] | null;
  operationMatriculaIds?: string[] | null;
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

/**
 * Compensa efeitos remotos criados durante uma tentativa inicial familiar.
 * JOIN não entra aqui: alterar uma assinatura já existente não é reversível
 * com segurança sem uma operação canônica própria.
 */
export async function compensateFamilyCreationRemoteEffects(
  payload: FamilyBillingPayload,
  ownershipGuard?: FamilyBillingOwnershipGuard,
) {
  if (payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE') {
    return { complete: false, errors: ['JOIN_EXISTING_REQUIRES_RECONCILIATION'] };
  }

  const isFeePhase = payload.billingPhase === 'ENROLLMENT_FEE';
  const isRecurringPhase = payload.billingPhase === 'RECURRING';
  const [family, allocations] = isFeePhase || isRecurringPhase
    ? [null, []]
    : await Promise.all([
        prisma.matriculaFamiliar.findFirst({
          where: { id: payload.aggregateId, contaId: payload.contaId },
          select: { standaloneSubscriptionId: true, standaloneEnrollmentChargeId: true },
        }),
        prisma.familyFinancialAllocation.findMany({
          where: {
            contaId: payload.contaId,
            familyGroupId: payload.aggregateId,
            ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
          },
          select: { standaloneSubscriptionId: true, sourceChargeId: true },
        }),
      ]);

  const subscriptionIds = new Set<string>();
  if (!isFeePhase && family?.standaloneSubscriptionId) subscriptionIds.add(family.standaloneSubscriptionId);
  for (const allocation of allocations) {
    if (allocation.standaloneSubscriptionId)
      subscriptionIds.add(allocation.standaloneSubscriptionId);
  }
  if (!isFeePhase && payload.monthlyValue > 0 && payload.uiRequestId) {
    subscriptionIds.add(
      deriveDeterministicId('sub', `${payload.aggregateId}:subscription:${payload.uiRequestId}`),
    );
  }

  const chargeIds = new Set<string>();
  if (!isRecurringPhase && family?.standaloneEnrollmentChargeId) chargeIds.add(family.standaloneEnrollmentChargeId);
  for (const allocation of allocations) {
    if (allocation.sourceChargeId) chargeIds.add(allocation.sourceChargeId);
  }
  if (!isRecurringPhase && payload.enrollmentFeeValue > 0 && payload.uiRequestId) {
    chargeIds.add(
      deriveDeterministicId('ch', `${payload.aggregateId}:enrollment-fee:${payload.uiRequestId}`),
    );
  }
  const shortContract = payload.endDate < payload.nextDueDate;
  if (
    payload.monthlyValue > 0 &&
    payload.uiRequestId &&
    (isRecurringPhase ? shortContract : !isFeePhase)
  ) {
    chargeIds.add(
      deriveDeterministicId('ch', `${payload.aggregateId}:short-tuition:${payload.uiRequestId}`),
    );
  }

  const [subscriptions, charges] = await Promise.all([
    subscriptionIds.size > 0
      ? prisma.standaloneSubscription.findMany({
          where: { contaId: payload.contaId, id: { in: [...subscriptionIds] } },
          select: { id: true, asaasSubscriptionId: true },
        })
      : [],
    chargeIds.size > 0
      ? prisma.charge.findMany({
          where: { contaId: payload.contaId, id: { in: [...chargeIds] } },
          select: { id: true, asaasPaymentId: true },
        })
      : [],
  ]);

  const errors: string[] = [];
  const deletedPayments = new Set<string>();
  const confirmedDeletedChargePaymentIds = new Set<string>();
  const deleteRemotePayment = async (paymentId: string) => {
    if (deletedPayments.has(paymentId)) return true;
    if (ownershipGuard) await ownershipGuard();
    try {
      await deletePayment(paymentId, { contaId: payload.contaId });
      deletedPayments.add(paymentId);
    } catch (error) {
      // Um payment já removido é um resultado idempotentemente compensado.
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found|não encontrado|404/i.test(message)) {
        errors.push(`PAYMENT:${paymentId}:${message}`);
        if (ownershipGuard) await ownershipGuard();
        return false;
      }
    }
    if (ownershipGuard) await ownershipGuard();
    return true;
  };

  for (const charge of charges) {
    if (!charge.asaasPaymentId) continue;
    const paymentId = charge.asaasPaymentId;
    if (ownershipGuard) await ownershipGuard();
    let remotePayment;
    try {
      remotePayment = await getPayment(paymentId, { contaId: payload.contaId });
    } catch (error) {
      errors.push(`PAYMENT:${paymentId}:LOOKUP_FAILED:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (ownershipGuard) await ownershipGuard();
    const status = String(remotePayment?.status ?? '').trim().toUpperCase();
    if (remotePayment?.id !== paymentId) {
      errors.push(`PAYMENT:${paymentId}:NOT_CANCELLABLE_OR_UNVERIFIED:${status || 'UNKNOWN'}`);
      continue;
    }
    if (remotePayment.deleted || status === 'DELETED') {
      deletedPayments.add(paymentId);
      confirmedDeletedChargePaymentIds.add(paymentId);
      continue;
    }
    if (!['PENDING', 'OVERDUE'].includes(status)) {
      errors.push(`PAYMENT:${paymentId}:NOT_CANCELLABLE_OR_UNVERIFIED:${status || 'UNKNOWN'}`);
      continue;
    }
    if (await deleteRemotePayment(paymentId)) confirmedDeletedChargePaymentIds.add(paymentId);
  }

  for (const subscription of subscriptions) {
    if (!subscription.asaasSubscriptionId) continue;
    const remotePayments: Awaited<ReturnType<typeof listPayments>>['data'] = [];
    const seenPaymentIds = new Set<string>();
    let paymentLookupComplete = false;
    let expectedPaymentCount: number | undefined;
    try {
      const pageSize = 100;
      for (let page = 0; page < 100; page += 1) {
        if (ownershipGuard) await ownershipGuard();
        const response = await listPayments(
          { subscription: subscription.asaasSubscriptionId, limit: pageSize, offset: page * pageSize },
          { contaId: payload.contaId },
        );
        if (
          !response ||
          !Array.isArray(response.data) ||
          typeof response.hasMore !== 'boolean' ||
          response.offset !== page * pageSize ||
          response.limit !== pageSize ||
          response.data.some((payment) => !payment?.id || seenPaymentIds.has(payment.id))
        ) {
          throw new Error(`PAYMENT_LOOKUP_INCOMPLETE:INVALID_PAGE:${page}`);
        }
        try {
          expectedPaymentCount = assertCompleteAsaasPage(response, page * pageSize, pageSize, expectedPaymentCount);
        } catch (error) {
          throw new Error(`PAYMENT_LOOKUP_INCOMPLETE:${error instanceof Error ? error.message : 'INVALID_PAGE'}:${page}`);
        }
        for (const payment of response.data) {
          seenPaymentIds.add(payment.id);
          remotePayments.push(payment);
        }
        if (!response.hasMore) {
          paymentLookupComplete = true;
          break;
        }
        if (response.data.length === 0) throw new Error(`PAYMENT_LOOKUP_INCOMPLETE:EMPTY_PAGE_WITH_MORE:${page}`);
        if (page === 99) throw new Error('PAYMENT_LOOKUP_INCOMPLETE:PAGE_LIMIT_EXCEEDED');
      }
    } catch (error) {
      errors.push(
        `SUBSCRIPTION:${subscription.asaasSubscriptionId}:${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!paymentLookupComplete) {
      errors.push(`SUBSCRIPTION:${subscription.asaasSubscriptionId}:PAYMENT_LOOKUP_INCOMPLETE`);
      continue;
    }
    if (ownershipGuard) await ownershipGuard();
    let subscriptionPaymentCleanupComplete = true;
    const knownPaymentStatuses = new Set([
      'PENDING', 'OVERDUE', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'REFUNDED',
      'REFUND_IN_PROGRESS', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED',
      'AWAITING_RISK_ANALYSIS', 'DELETED',
    ]);
    for (const payment of remotePayments) {
      if (!payment.deleted) {
        const paymentStatus = String(payment.status ?? '').trim().toUpperCase();
        if (!knownPaymentStatuses.has(paymentStatus)) {
          errors.push(`SUBSCRIPTION:${subscription.asaasSubscriptionId}:PAYMENT:${payment.id}:STATUS_UNVERIFIED`);
          subscriptionPaymentCleanupComplete = false;
          continue;
        }
        if (!['PENDING', 'OVERDUE'].includes(paymentStatus)) continue;
        if (!(await deleteRemotePayment(payment.id))) subscriptionPaymentCleanupComplete = false;
      }
    }
    if (ownershipGuard) await ownershipGuard();
    if (!subscriptionPaymentCleanupComplete) continue;
    try {
      await deleteSubscription(subscription.asaasSubscriptionId, { contaId: payload.contaId });
    } catch (error) {
      errors.push(
        `SUBSCRIPTION:${subscription.asaasSubscriptionId}:${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (ownershipGuard) await ownershipGuard();
    await withOwnedTransaction(ownershipGuard, (tx) => tx.standaloneSubscription.updateMany({
        where: { id: subscription.id, contaId: payload.contaId },
        data: { status: 'DELETED', remoteStatus: 'DELETED' },
      }));
  }

  if (chargeIds.size > 0) {
    const canceledChargeIds = charges
      .filter((charge) => charge.asaasPaymentId && confirmedDeletedChargePaymentIds.has(charge.asaasPaymentId))
      .map((charge) => charge.id);
    if (canceledChargeIds.length > 0) await withOwnedTransaction(ownershipGuard, (tx) => tx.charge.updateMany({
      where: { contaId: payload.contaId, id: { in: canceledChargeIds } },
      data: { status: 'CANCELED', asaasStatus: 'DELETED' },
    }));
  }

  return { complete: errors.length === 0, errors };
}

/**
 * Reconciliador específico para uma tentativa inicial que falhou depois de
 * produzir algum efeito remoto. Ele nunca recria/ativa a matrícula: apenas
 * conclui a compensação pendente e fecha o outbox.
 */
export async function reconcileFailedFamilyEnrollmentOutbox(eventId: string) {
  const event = await prisma.familyBillingOutbox.findUnique({ where: { id: eventId } });
  if (!event) return { processed: false as const, reason: 'NOT_FOUND' as const };

  const payload = parseFamilyBillingPayload(event.payload);
  if (payload.aggregateType !== 'MATRICULA_FAMILIAR' || !payload.operationId) {
    return { processed: false as const, reason: 'NOT_INITIAL_FAMILY_ENROLLMENT' as const };
  }

  const operation = await prisma.familyEnrollmentOperation.findFirst({
    where: { id: payload.operationId, contaId: payload.contaId },
    select: { status: true },
  });
  if (operation?.status !== 'REQUIRES_RECONCILIATION') {
    return { processed: false as const, reason: 'OPERATION_NOT_RECONCILIATION' as const };
  }

  const compensation = await compensateFamilyCreationRemoteEffects(payload);
  if (!compensation.complete) {
    await prisma.familyBillingOutbox.updateMany({
      where: { id: eventId, contaId: event.contaId },
      data: {
        status: 'REQUIRES_RECONCILIATION',
        lastError: `COMPENSACAO_INCOMPLETA:${compensation.errors.join('|')}`.slice(0, 2000),
      },
    });
    return { processed: false as const, reason: 'REQUIRES_RECONCILIATION' as const };
  }

  await prisma.$transaction([
    prisma.matriculaFamiliar.updateMany({
      where: { id: payload.aggregateId, contaId: payload.contaId },
      data: {
        status: FamilyBillingStatus.FALHO,
        academicStatus: 'FALHO',
        billingProvisionStatus: MatriculaBillingProvisionStatus.FALHO,
        standaloneSubscriptionId: null,
        standaloneEnrollmentChargeId: null,
        ultimoErro: 'Tentativa financeira compensada; nenhuma matrícula foi criada.',
      },
    }),
    prisma.familyEnrollmentOperation.updateMany({
      where: { id: payload.operationId, contaId: payload.contaId },
      data: {
        status: 'FAILED',
        lastError: 'COMPENSATED: nenhuma matrícula familiar foi criada.',
        completedAt: new Date(),
        result: { compensation, rollback: 'REMOTE_AND_LOCAL' } as Prisma.InputJsonValue,
      },
    }),
    prisma.familyBillingOutbox.updateMany({
      where: { id: eventId, contaId: event.contaId },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastError: null,
      },
    }),
  ]);

  return { processed: true as const, compensated: true as const };
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
    expectedBillingVersion: Number.isInteger(payload.expectedBillingVersion)
      ? Number(payload.expectedBillingVersion)
      : null,
    previousMonthlyValue: Number.isFinite(Number(payload.previousMonthlyValue))
      ? Number(payload.previousMonthlyValue)
      : null,
    resultingMonthlyValue: Number.isFinite(Number(payload.resultingMonthlyValue))
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
    billingPhase: payload.billingPhase === 'ENROLLMENT_FEE' || payload.billingPhase === 'RECURRING' ? payload.billingPhase : null,
    deferActivationUntil: typeof payload.deferActivationUntil === 'string' ? payload.deferActivationUntil : null,
    billableMatriculaIds: Array.isArray(payload.billableMatriculaIds)
      ? payload.billableMatriculaIds.filter((id): id is string => typeof id === 'string')
      : null,
    operationMatriculaIds: Array.isArray(payload.operationMatriculaIds)
      ? payload.operationMatriculaIds.filter((id): id is string => typeof id === 'string')
      : null,
  };
}

type FamilyBillingOwnershipGuard = (tx?: Prisma.TransactionClient) => Promise<void>;

async function withOwnedTransaction<T>(
  ownershipGuard: FamilyBillingOwnershipGuard | undefined,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (ownershipGuard) await ownershipGuard(tx);
    return work(tx);
  }, { maxWait: 10_000, timeout: 30_000 });
}

function ensurePositiveMoney(value: number) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : 0;
}

async function updateGroupMetadata(params: {
  contaId: string;
  familyGroupId: string;
  standaloneSubscriptionId?: string | null;
  standaloneChargeId?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const db: Prisma.TransactionClient = params.tx ?? prisma;
  if (params.standaloneSubscriptionId) {
    await db.standaloneSubscription.updateMany({
      where: { id: params.standaloneSubscriptionId, contaId: params.contaId },
      data: { familyGroupId: params.familyGroupId },
    });

    const relatedCharges = await db.charge.findMany({
      where: {
        contaId: params.contaId,
        standaloneSubscriptionId: params.standaloneSubscriptionId,
      },
      select: { id: true },
    });

    if (relatedCharges.length > 0) {
      const chargeIds = relatedCharges.map((charge) => charge.id);
      await db.charge.updateMany({
        where: { id: { in: chargeIds }, contaId: params.contaId },
        data: { familyGroupId: params.familyGroupId },
      });
      await db.chargeReadModel.updateMany({
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
    await db.charge.updateMany({
      where: { id: params.standaloneChargeId, contaId: params.contaId },
      data: { familyGroupId: params.familyGroupId },
    });
    await db.chargeReadModel.updateMany({
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

async function linkFamilyEnrollmentCharge(payload: FamilyBillingPayload, chargeId: string, tx?: Prisma.TransactionClient) {
  const db: Prisma.TransactionClient = tx ?? prisma;
  if (payload.aggregateType !== 'MATRICULA_FAMILIAR') return;

  await updateGroupMetadata({
    contaId: payload.contaId,
    familyGroupId: payload.aggregateId,
    standaloneChargeId: chargeId,
    tx,
  });
  await db.familyFinancialAllocation.updateMany({
    where: {
      contaId: payload.contaId,
      familyGroupId: payload.aggregateId,
      ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
      ...(payload.billableMatriculaIds ? { matriculaId: { in: payload.billableMatriculaIds } } : {}),
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
  tx?: Prisma.TransactionClient;
}) {
  const db: Prisma.TransactionClient = params.tx ?? prisma;
  if (params.payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await db.matriculaFamiliar.updateMany({
      where: { id: params.payload.aggregateId, contaId: params.payload.contaId },
      data: {
        status: params.payload.deferActivationUntil ? FamilyBillingStatus.PENDENTE : FamilyBillingStatus.ATIVO,
        billingProvisionStatus: params.payload.deferActivationUntil
          ? MatriculaBillingProvisionStatus.PENDENTE
          : MatriculaBillingProvisionStatus.PROVISIONADO,
        ...(params.payload.billingPhase === 'ENROLLMENT_FEE'
          ? { standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null }
          : params.payload.billingPhase === 'RECURRING'
            ? { standaloneSubscriptionId: params.subscriptionId ?? null }
            : {
                standaloneSubscriptionId: params.subscriptionId ?? null,
                standaloneEnrollmentChargeId: params.enrollmentChargeId ?? null,
              }),
        ultimoErro: null,
      },
    });
    return;
  }

  await db.rematriculaFamiliar.updateMany({
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

async function persistAggregateFailure(payload: FamilyBillingPayload, message: string, ownershipGuard?: (tx?: Prisma.TransactionClient) => Promise<void>, tx?: Prisma.TransactionClient) {
  const db: Prisma.TransactionClient = tx ?? prisma;
  const hasPersistedFinancialEffect =
    payload.aggregateType === 'MATRICULA_FAMILIAR'
      ? Boolean(
          await prisma.familyFinancialAllocation.findFirst({
            where: {
              contaId: payload.contaId,
              familyGroupId: payload.aggregateId,
              ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
              OR: [{ sourceChargeId: { not: null } }, { standaloneSubscriptionId: { not: null } }],
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
    if (ownershipGuard) await ownershipGuard(tx);
    await db.matriculaFamiliar.updateMany({
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
      if (ownershipGuard) await ownershipGuard(tx);
    await db.familyEnrollmentOperation.updateMany({
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

  if (ownershipGuard) await ownershipGuard(tx);
    await db.rematriculaFamiliar.updateMany({
    where: { id: payload.aggregateId, contaId: payload.contaId },
    data,
  });
}

async function persistAggregateUncertain(payload: FamilyBillingPayload, message: string, ownershipGuard?: (tx?: Prisma.TransactionClient) => Promise<void>, tx?: Prisma.TransactionClient) {
  const db: Prisma.TransactionClient = tx ?? prisma;
  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    if (ownershipGuard) await ownershipGuard(tx);
    await db.matriculaFamiliar.updateMany({
      where: { id: payload.aggregateId, contaId: payload.contaId },
      data: {
        billingProvisionStatus: MatriculaBillingProvisionStatus.RESULTADO_INCERTO,
        ultimoErro: `RESULTADO_INCERTO: ${message.slice(0, 1900)}`,
      },
    });
    if (payload.operationId) {
      if (ownershipGuard) await ownershipGuard(tx);
    await db.familyEnrollmentOperation.updateMany({
        where: { id: payload.operationId, contaId: payload.contaId },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          lastError: `RESULTADO_INCERTO: ${message.slice(0, 1900)}`,
        },
      });
    }
    return;
  }
  await persistAggregateFailure(payload, `RESULTADO_INCERTO: ${message.slice(0, 1900)}`, ownershipGuard, tx);
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
  ownershipGuard?: FamilyBillingOwnershipGuard;
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
  const targetFamilyGroupId = targetSubscription.familyGroupId;

  const targetAgreement = await withOwnedTransaction(input.ownershipGuard, (tx) => materializeBillingAgreement({
    kind: 'FAMILY',
    contaId: payload.contaId,
    standaloneSubscriptionId: targetSubscription.id,
    familyGroupId: targetFamilyGroupId,
    actorId: payload.actorId,
  }, { tx }));
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
  }, input.ownershipGuard);
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
  ownershipGuard?: FamilyBillingOwnershipGuard,
): Promise<FamilyBillingExecutionResult> {
  const assertOwned = ownershipGuard ?? (async () => undefined);
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
      await assertOwned();
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

  if (enrollmentFeeValue > 0 && payload.billingPhase !== 'RECURRING') {
    await assertOwned();
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
    await assertOwned();

    standaloneEnrollmentChargeId = enrollmentResult.data.chargeId;
    // Persiste o efeito financeiro antes de iniciar outra chamada externa. Assim,
    // uma falha/timeout na assinatura não deixa a taxa real órfã no estado local.
    await withOwnedTransaction(ownershipGuard, (tx) => linkFamilyEnrollmentCharge(payload, standaloneEnrollmentChargeId!, tx));
  }

  if (monthlyValue > 0 && payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE') {
    if (!joinTarget || !joinUpdateDecision) {
      throw new Error('PAYLOAD_JOIN_FAMILIAR_INCOMPLETO');
    }
    const targetAgreement = await withOwnedTransaction(ownershipGuard, (tx) => materializeBillingAgreement({
      kind: 'FAMILY',
      contaId: payload.contaId,
      standaloneSubscriptionId: joinTarget.id,
      familyGroupId: payload.aggregateId,
      actorId: payload.actorId,
    }, { tx }));
    await assertOwned();
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
      ...(payload.billableMatriculaIds ? { matriculaId: { in: payload.billableMatriculaIds } } : {}),
      chargeKind: 'MENSALIDADE',
        status: { in: ['PENDING', 'PROCESSING', 'ACTIVE'] },
        matriculaId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (pendingAllocations.length === 0)
      throw new Error('ALOCACOES_FAMILIARES_PENDENTES_NAO_ENCONTRADAS');
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
      effectivePolicy: payload.scheduledEffectiveAt ? 'NEXT_CYCLE' as const : 'CURRENT_CYCLE_FULL' as const,
      effectiveDate: payload.scheduledEffectiveAt?.slice(0, 10) ?? pendingAllocations[0]!.competenceStart.toISOString().slice(0, 10),
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
        validUntil: dayAfter(
          allocation.competenceEnd ?? new Date(`${payload.endDate}T00:00:00.000Z`),
        ),
        prorationPolicy: 'FULL_CURRENT_CYCLE' as const,
      })),
    };
    let canonicalOperationId = completedCanonicalOperation?.id ?? null;
    if (!canonicalOperationId) {
      await assertOwned();
    const preview = await previewBillingAgreementChange(change);
      if (preview.blockers.length > 0) {
        throw new Error(`UNIFICACAO_FAMILIAR_BLOQUEADA:${preview.blockers.join('|')}`);
      }
      if (preview.adjustments.some((adjustment) => adjustment.type === 'MANUAL_REVIEW')) {
        throw new Error('RESULTADO_INCERTO:CICLO_FAMILIAR_REQUER_REVISAO_MANUAL');
      }
      await assertOwned();
      const result = await commitBillingAgreementChange({
        ...change,
        uiRequestId: canonicalUiRequestId,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedAgreementVersion: preview.sourceVersion,
      }, ownershipGuard);
      await assertOwned();
      if (result.status === 'REQUIRES_RECONCILIATION') {
        throw new Error(`RESULTADO_INCERTO:OPERACAO_CANONICA_FAMILIAR:${result.operationId}`);
      }
      canonicalOperationId = result.operationId;
    }
    const pendingCanonicalAdjustment = await prisma.billingAdjustment.findFirst({
      where: {
        contaId: payload.contaId,
        operationId: canonicalOperationId,
        status: { not: 'APPLIED' },
      },
      select: { id: true },
    });
    if (pendingCanonicalAdjustment) {
      await processPendingBillingAdjustments({
        contaId: payload.contaId,
        operationId: canonicalOperationId,
        ownershipGuard,
      });
      const unresolved = await prisma.billingAdjustment.findFirst({
        where: {
          contaId: payload.contaId,
          operationId: canonicalOperationId,
          status: { not: 'APPLIED' },
        },
        select: { status: true, lastError: true },
      });
      if (unresolved) {
        if (
          unresolved.status === 'PENDING' ||
          unresolved.status === 'FAILED' ||
          unresolved.status === 'PROCESSING'
        ) {
          throw new Error(
            `AJUSTE_FAMILIAR_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`,
          );
        }
        throw new Error(
          `RESULTADO_INCERTO:AJUSTE_FAMILIAR_${unresolved.status}:${unresolved.lastError ?? ''}`,
        );
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
      throw new Error(
        `RESULTADO_INCERTO:PROJECAO_CANONICA_FAMILIAR_INCOMPLETA:${canonicalOperationId}`,
      );
    }
    canonicalJoin = { agreementId: targetAgreement.id, operationId: canonicalOperationId };
    standaloneSubscriptionId = joinTarget.id;
  } else if (monthlyValue > 0) {
    const shortContract = payload.endDate < payload.nextDueDate;
    await assertOwned();
    const subscriptionResult = await createStandaloneCharge(
      shortContract
        ? {
            ...buildStandaloneBaseInput(payload, {
              description: `${payload.description} · contrato curto`,
            }),
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
          },
    );

    if (!subscriptionResult.success) {
      throw new Error(`Falha ao criar assinatura familiar: ${subscriptionResult.error}`);
    }
    await assertOwned();

    if (shortContract) standaloneTuitionChargeId = subscriptionResult.data.chargeId;
    else standaloneSubscriptionId = subscriptionResult.data.chargeId;
  }

  await withOwnedTransaction(ownershipGuard, (tx) => updateGroupMetadata({
    contaId: payload.contaId,
    familyGroupId: payload.aggregateId,
    standaloneSubscriptionId,
    standaloneChargeId: standaloneEnrollmentChargeId,
    tx,
  }));

  if (payload.aggregateType === 'MATRICULA_FAMILIAR') {
    await withOwnedTransaction(ownershipGuard, (tx) => tx.familyFinancialAllocation.updateMany({
      where: {
        contaId: payload.contaId,
        familyGroupId: payload.aggregateId,
        ...(payload.operationId ? { familyEnrollmentOperationId: payload.operationId } : {}),
        ...(payload.billableMatriculaIds ? { matriculaId: { in: payload.billableMatriculaIds } } : {}),
        chargeKind: 'MENSALIDADE',
        status: 'PENDING',
      },
      data: {
        standaloneSubscriptionId,
        sourceChargeId: standaloneTuitionChargeId,
        sourceAgreementId: canonicalJoin?.agreementId ?? standaloneSubscriptionId,
        status:
          payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE' ? 'PROCESSING' : 'AWAITING_WEBHOOK',
      },
    }));
  }

  if (standaloneSubscriptionId && payload.aggregateType === 'REMATRICULA_FAMILIAR') {
    await withOwnedTransaction(ownershipGuard, (tx) => tx.familyFinancialAllocation.updateMany({
      where: {
        contaId: payload.contaId,
        rematriculaFamiliarId: payload.aggregateId,
        status: 'PENDING',
      },
      data: {
        standaloneSubscriptionId,
        status: 'AWAITING_WEBHOOK',
      },
    }));

    await withOwnedTransaction(ownershipGuard, (tx) => tx.rematriculaFamiliarItem.updateMany({
      where: {
        rematriculaFamiliarId: payload.aggregateId,
        decision: 'REMATRICULAR_AGORA',
      },
      data: {
        targetFinancialAgreementId: standaloneSubscriptionId,
      },
    }));
  }

  if (payload.aggregateType === 'MATRICULA_FAMILIAR' && payload.operationId) {
    const isJoin = payload.strategy === 'JOIN_EXISTING_CURRENT_CYCLE';
    await withOwnedTransaction(ownershipGuard, async (tx) => {
      if (isJoin) {
        await assertOwned(tx);
        const updated = await tx.matriculaFamiliar.updateMany({
          where: {
            id: payload.aggregateId,
            contaId: payload.contaId,
            billingVersion: payload.expectedBillingVersion ?? undefined,
            status: { in: [FamilyBillingStatus.PENDENTE, FamilyBillingStatus.ATIVO, FamilyBillingStatus.PARCIAL] },
          },
          data: {
            valorMensalidadeTotal: payload.resultingMonthlyValue ?? monthlyValue,
            totalAlunos: payload.totalAlunos,
            billingVersion: { increment: 1 },
            billingProvisionStatus: payload.deferActivationUntil
              ? MatriculaBillingProvisionStatus.PENDENTE
              : MatriculaBillingProvisionStatus.PROVISIONADO,
            ultimoErro: null,
          },
        });
        if (updated.count === 0) {
          throw new Error('RESULTADO_INCERTO:VERSAO_FINANCEIRA_FAMILIAR_DIVERGENTE_APOS_PUT');
        }
        if (monthlyValue > 0) {
          await assertOwned(tx);
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
          await assertOwned(tx);
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
        await assertOwned(tx);
        const familyUpdated = await tx.matriculaFamiliar.updateMany({
          where: {
            id: payload.aggregateId,
            contaId: payload.contaId,
            status: { in: [FamilyBillingStatus.PENDENTE, FamilyBillingStatus.ATIVO, FamilyBillingStatus.PARCIAL] },
          },
          data: {
            status: payload.deferActivationUntil ? FamilyBillingStatus.PENDENTE : FamilyBillingStatus.ATIVO,
            billingProvisionStatus: payload.deferActivationUntil
              ? MatriculaBillingProvisionStatus.PENDENTE
              : MatriculaBillingProvisionStatus.PROVISIONADO,
            ...(payload.billingPhase === 'ENROLLMENT_FEE'
              ? { standaloneEnrollmentChargeId }
              : payload.billingPhase === 'RECURRING'
                ? {
                    standaloneSubscriptionId,
                    valorMensalidadeTotal: monthlyValue,
                    totalAlunos: payload.totalAlunos,
                  }
                : { standaloneSubscriptionId, standaloneEnrollmentChargeId }),
            ultimoErro: null,
          },
        });
        if (familyUpdated.count === 0) {
          throw new Error('RESULTADO_INCERTO:FAMILIA_TERMINAL_APOS_EFEITO_REMOTO');
        }
      }

      // A matrícula familiar só pode deixar o estado pendente depois que a
      // assinatura/taxa consolidada e suas alocações foram persistidas.
      // Matrículas já ativas não são tocadas: isso preserva retries e JOINs.
      const account = await tx.conta.findUnique({
        where: { id: payload.contaId },
        select: { matriculaActivationPolicy: true, timezone: true },
      });
      if (!payload.deferActivationUntil) {
        const members = await tx.matricula.findMany({
          where: {
            contaId: payload.contaId,
            matriculaFamiliarId: payload.aggregateId,
            ...(payload.billableMatriculaIds ? { id: { in: payload.billableMatriculaIds } } : {}),
            billingProvisionStatus: { in: [
              MatriculaBillingProvisionStatus.NAO_APLICAVEL,
              MatriculaBillingProvisionStatus.PENDENTE,
              MatriculaBillingProvisionStatus.PROCESSANDO,
              MatriculaBillingProvisionStatus.PARCIAL,
            ] },
            status: { in: [StatusMatricula.PENDENTE_TAXA, StatusMatricula.AGUARDANDO_CONFIRMACAO, StatusMatricula.ATIVA] },
          },
          select: { id: true, status: true, taxaStatus: true, taxaIsenta: true, taxaMatricula: true, dataInicio: true, billingProvisionStatus: true },
        });
        for (const member of members) {
          const futureStart = isAcademicDateInFuture(member.dataInicio, new Date(), account?.timezone ?? undefined);
          const decision = futureStart
            ? { action: 'KEEP' as const, reason: 'FEE_NOT_PAID' as const }
            : decideEnrollmentStatusAtContractStart({
                activationPolicy: account?.matriculaActivationPolicy ?? 'IMMEDIATE',
                enrollmentStatus: member.status,
                feeRequired: !member.taxaIsenta && Number(member.taxaMatricula) > 0,
                feeStatus: member.taxaStatus,
              });
          await assertOwned(tx);
        await tx.matricula.updateMany({
            where: {
              id: member.id,
              contaId: payload.contaId,
              status: member.status,
              billingProvisionStatus: member.billingProvisionStatus,
            },
            data: {
              ...(decision.action === 'TRANSITION' ? { status: decision.targetStatus } : {}),
              ...(member.billingProvisionStatus === MatriculaBillingProvisionStatus.NAO_APLICAVEL
                ? {}
                : {
                    billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
                    billingProvisionError: null,
                    billingProvisionAt: new Date(),
                  }),
            },
          });
        }
      }
      if (!payload.deferActivationUntil && payload.billableMatriculaIds) {
        await assertOwned(tx);
        await tx.matricula.updateMany({
          where: {
            contaId: payload.contaId,
            matriculaFamiliarId: payload.aggregateId,
            id: { in: payload.billableMatriculaIds },
            status: StatusMatricula.PAUSADA,
            billingProvisionStatus: {
              in: [
                MatriculaBillingProvisionStatus.PENDENTE,
                MatriculaBillingProvisionStatus.PROCESSANDO,
                MatriculaBillingProvisionStatus.PARCIAL,
              ],
            },
          },
          data: {
            billingProvisionStatus: MatriculaBillingProvisionStatus.PROVISIONADO,
            billingProvisionError: null,
            billingProvisionAt: new Date(),
          },
        });
      }
      if (!payload.deferActivationUntil) {
        await assertOwned(tx);
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
      }
    });
  } else {
    await withOwnedTransaction(ownershipGuard, (tx) => persistAggregateSuccess({
      payload,
      subscriptionId: standaloneSubscriptionId,
      enrollmentChargeId: standaloneEnrollmentChargeId,
      tx,
    }));
  }

  if (standaloneSubscriptionId && payload.aggregateType === 'MATRICULA_FAMILIAR') {
    const sourceAgreement = await withOwnedTransaction(ownershipGuard, (tx) => materializeBillingAgreement({
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
    }, { tx }));
    await assertOwned();
    await scheduleNextCycleFamilyUnification({
      payload,
      sourceAgreementId: sourceAgreement.id,
      ownershipGuard,
    });
    await assertOwned();
  }

  return { standaloneSubscriptionId, standaloneEnrollmentChargeId, standaloneTuitionChargeId };
}

/**
 * Marca o aggregate familiar como FALHO sem lançar erro adicional.
 * Útil para o caminho inline da rota: a cobrança falhou, mas as matrículas
 * já estão criadas; o cliente recebe uma resposta com status FALHO ao invés
 * de um 500.
 */
export async function markFamilyBillingFailed(payload: FamilyBillingPayload, message: string) {
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
  availableAt?: Date;
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
        ...(input.availableAt ? { availableAt: input.availableAt } : {}),
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

export async function processFamilyBillingOutboxEvent(
  eventId: string,
  options: { allowReconciliation?: boolean } = {},
) {
  const event = await prisma.familyBillingOutbox.findUnique({
    where: { id: eventId },
  });

  if (event && event.availableAt > new Date()) {
    return { processed: false, reason: 'NOT_YET_AVAILABLE' as const };
  }

  if (
    !event ||
    event.status === FamilyBillingOutboxStatus.PROCESSED ||
    (event.status === FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION &&
      !options.allowReconciliation)
  ) {
    return { processed: false, reason: 'NOT_FOUND_OR_ALREADY_PROCESSED' as const };
  }

  const claimedAt = new Date();
  const claimToken = globalThis.crypto.randomUUID();
  const claimed = await prisma.familyBillingOutbox.updateMany({
    where: {
      id: eventId,
      contaId: event.contaId,
      status: {
        in: [
          FamilyBillingOutboxStatus.PENDING,
          FamilyBillingOutboxStatus.FAILED,
          ...(options.allowReconciliation
            ? [FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION]
            : []),
        ],
      },
    },
    data: {
      status: FamilyBillingOutboxStatus.PROCESSING,
      lockedAt: claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 5 * 60 * 1000),
      claimToken,
      lastAttemptAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    return { processed: false, reason: 'CLAIMED_BY_OTHER_WORKER' as const };
  }

  let parsedFamilyPayload: FamilyBillingPayload | null = null;
  let leaseLost = false;
  const renewLease = async () => {
    if (leaseLost) return false;
    const renewed = await prisma.familyBillingOutbox.updateMany({
      where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
      data: { leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
    }).catch(() => ({ count: 0 }));
    if (renewed.count !== 1) leaseLost = true;
    return renewed.count === 1;
  };
  const assertOwned: FamilyBillingOwnershipGuard = async (tx) => {
    const renewed = tx
      ? await tx.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: { leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
        })
      : { count: (await renewLease()) ? 1 : 0 };
    if (renewed.count !== 1) throw new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
  };
  const heartbeat = setInterval(() => { void renewLease(); }, 60_000);

  try {
    if (event.eventType === 'CLOSE_MATRICULA_FAMILIAR_SUBSCRIPTION') {
      const raw = event.payload;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Payload de encerramento familiar inválido.');
      }
      const payload = raw as Record<string, unknown>;
      const aggregateId = String(payload.aggregateId ?? '');
      const sourceFinancialAgreementId = String(payload.sourceFinancialAgreementId ?? '');
      const effectiveDate = String(payload.effectiveDate ?? '');
      if (
        String(payload.contaId ?? '') !== event.contaId ||
        aggregateId !== event.aggregateId ||
        !sourceFinancialAgreementId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
      ) {
        throw new Error('PAYLOAD_ENCERRAMENTO_FAMILIAR_DIVERGENTE');
      }

      const family = await prisma.matriculaFamiliar.findFirst({
        where: { id: aggregateId, contaId: event.contaId },
        select: {
          id: true,
          status: true,
          standaloneSubscriptionId: true,
          matriculas: {
            select: {
              status: true,
              rematriculasDerivadas: {
                where: {
                  status: { in: ['PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO', 'ATIVA', 'PAUSADA'] },
                },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      });
      if (!family) throw new Error('MATRICULA_FAMILIAR_NAO_ENCONTRADA');
      if (family.standaloneSubscriptionId !== sourceFinancialAgreementId) {
        throw new Error('ASSINATURA_FAMILIAR_DO_PAYLOAD_DIVERGENTE');
      }
      const terminalStatuses: StatusMatricula[] = [
        StatusMatricula.ENCERRADA,
        StatusMatricula.CANCELADA,
        StatusMatricula.RECUSADA,
      ];
      if (
        family.matriculas.length === 0 ||
        family.matriculas.some((item) => !terminalStatuses.includes(item.status)) ||
        family.matriculas.some((item) => item.rematriculasDerivadas.length > 0)
      ) {
        throw new Error('MATRICULA_FAMILIAR_AINDA_POSSUI_MEMBRO_ATIVO');
      }

      const sourceSubscription = await prisma.standaloneSubscription.findFirst({
        where: { id: sourceFinancialAgreementId, contaId: event.contaId },
        select: { id: true, asaasSubscriptionId: true, familyGroupId: true },
      });
      if (!sourceSubscription) throw new Error('ASSINATURA_FAMILIAR_NAO_ENCONTRADA');

      const operationUiRequestId = `family-natural-closure:${aggregateId}:${sourceFinancialAgreementId}`;
      const completedOperation = await prisma.billingChangeOperation.findFirst({
        where: { contaId: event.contaId, uiRequestId: operationUiRequestId, status: 'COMPLETED' },
        select: { id: true },
      });

      let operationId = completedOperation?.id ?? null;
      if (!operationId && sourceSubscription.asaasSubscriptionId) {
        if (!sourceSubscription.familyGroupId) {
          throw new Error('ASSINATURA_FAMILIAR_SEM_GRUPO_FINANCEIRO');
        }
        const agreement = await withOwnedTransaction(assertOwned, (tx) => materializeBillingAgreement({
          kind: 'FAMILY',
          contaId: event.contaId,
          standaloneSubscriptionId: sourceSubscription.id!,
          familyGroupId: sourceSubscription.familyGroupId!,
          actorId: 'family-enrollment-closure',
        }, { tx }));
        await assertOwned();
        const change = {
          contaId: event.contaId,
          agreementId: agreement.id,
          actorId: 'family-enrollment-closure',
          reason: `Encerramento natural da matrícula familiar ${aggregateId}`,
          kind: 'CANCEL_AGREEMENT' as const,
          effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
          effectiveDate,
        };
        await assertOwned();
        const preview = await previewBillingAgreementChange(change);
        if (
          preview.blockers.length > 0 ||
          preview.adjustments.some((item) => item.type === 'MANUAL_REVIEW')
        ) {
          throw new Error(
            `ENCERRAMENTO_FAMILIAR_REQUER_REVISAO:${preview.blockers.join('|') || 'MANUAL_REVIEW'}`,
          );
        }
        await assertOwned();
        const committed = await commitBillingAgreementChange({
          ...change,
          uiRequestId: operationUiRequestId,
          previewHash: preview.previewHash,
          previewExpiresAt: preview.expiresAt,
          expectedAgreementVersion: preview.sourceVersion,
        }, assertOwned);
        await assertOwned();
        if (committed.status === 'REQUIRES_RECONCILIATION') {
          throw new Error(`RESULTADO_INCERTO:ENCERRAMENTO_FAMILIAR:${committed.operationId}`);
        }
        operationId = committed.operationId;
      }

      if (operationId) {
        const pendingAdjustment = await prisma.billingAdjustment.findFirst({
          where: { contaId: event.contaId, operationId, status: { not: 'APPLIED' } },
          select: { id: true },
        });
        if (pendingAdjustment) {
          await processPendingBillingAdjustments({ contaId: event.contaId, operationId, ownershipGuard: assertOwned });
          const unresolved = await prisma.billingAdjustment.findFirst({
            where: { contaId: event.contaId, operationId, status: { not: 'APPLIED' } },
            select: { status: true, lastError: true },
          });
          if (unresolved) {
            throw new Error(
              `AJUSTE_ENCERRAMENTO_FAMILIAR_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`,
            );
          }
        }
      }

      await withOwnedTransaction(assertOwned, (tx) => tx.matriculaFamiliar.updateMany({
        where: {
          id: aggregateId,
          contaId: event.contaId,
          status: { in: [FamilyBillingStatus.ATIVO, FamilyBillingStatus.PARCIAL] },
        },
        data: { status: FamilyBillingStatus.CANCELADO, academicStatus: 'COMPLETO' },
      }));
      await withOwnedTransaction(assertOwned, (tx) => tx.standaloneSubscription.updateMany({
        where: { id: sourceFinancialAgreementId, contaId: event.contaId },
        data: {
          closureScheduledAt: new Date(),
          validUntil: new Date(`${effectiveDate}T00:00:00.000Z`),
        },
      }));
      const completed = await prisma.familyBillingOutbox.updateMany({
        where: {
          id: eventId,
          contaId: event.contaId,
          status: FamilyBillingOutboxStatus.PROCESSING,
          claimToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: FamilyBillingOutboxStatus.PROCESSED,
          processedAt: new Date(),
          lockedAt: null,
          leaseExpiresAt: null,
          claimToken: null,
          lastError: null,
        },
      });
      if (completed.count !== 1) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      return { processed: true as const };
    }

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
          await assertOwned();
        await processPendingBillingAdjustments({
            contaId: event.contaId,
            operationId: completedClosureOperation.id,
            ownershipGuard: assertOwned,
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
            if (
              unresolved.status === 'PENDING' ||
              unresolved.status === 'FAILED' ||
              unresolved.status === 'PROCESSING'
            ) {
              throw new Error(
                `AJUSTE_ENCERRAMENTO_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`,
              );
            }
            throw new Error(
              `RESULTADO_INCERTO:AJUSTE_ENCERRAMENTO_${unresolved.status}:${unresolved.lastError ?? ''}`,
            );
          }
        }
      }

      await withOwnedTransaction(assertOwned, (tx) => tx.rematriculaFamiliar.updateMany({
        where: { id: event.aggregateId, contaId: event.contaId },
        data: {
          step: 'ENCERRAMENTO_ORIGEM_SOLICITADO',
          sourceBillingStatus: sourceAsaasSubscriptionId ? 'CLOSURE_REQUESTED' : 'REVIEW_MANUAL',
        },
      }));

      if (sourceAsaasSubscriptionId && !completedClosureOperation) {
        if (!sourceSubscription.familyGroupId) {
          throw new Error('ASSINATURA_ORIGEM_SEM_GRUPO_FAMILIAR');
        }
        const sourceAgreement = await withOwnedTransaction(assertOwned, (tx) => materializeBillingAgreement({
          kind: 'FAMILY',
          contaId: event.contaId,
          standaloneSubscriptionId: sourceSubscription.id!,
          familyGroupId: sourceSubscription.familyGroupId!,
          actorId: 'family-billing-outbox',
        }, { tx }));
        await assertOwned();
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
        await assertOwned();
        const closurePreview = await previewBillingAgreementChange(closureChange);
        if (
          closurePreview.blockers.length > 0 ||
          closurePreview.adjustments.some((item) => item.type === 'MANUAL_REVIEW')
        ) {
          throw new Error(
            `ENCERRAMENTO_CANONICO_BLOQUEADO:${closurePreview.blockers.join('|') || 'MANUAL_REVIEW'}`,
          );
        }
        await assertOwned();
        const closureResult = await commitBillingAgreementChange({
          ...closureChange,
          uiRequestId: closureUiRequestId,
          previewHash: closurePreview.previewHash,
          previewExpiresAt: closurePreview.expiresAt,
          expectedAgreementVersion: closurePreview.sourceVersion,
        }, assertOwned);
        await assertOwned();
        if (closureResult.status === 'REQUIRES_RECONCILIATION') {
          throw new Error(`RESULTADO_INCERTO:ENCERRAMENTO_CANONICO:${closureResult.operationId}`);
        }
        const pendingClosureAdjustment = await prisma.billingAdjustment.findFirst({
          where: {
            contaId: event.contaId,
            operationId: closureResult.operationId,
            status: { not: 'APPLIED' },
          },
          select: { id: true },
        });
        if (pendingClosureAdjustment) {
          await processPendingBillingAdjustments({
            contaId: event.contaId,
            operationId: closureResult.operationId,
            ownershipGuard: assertOwned,
          });
          const unresolved = await prisma.billingAdjustment.findFirst({
            where: {
              contaId: event.contaId,
              operationId: closureResult.operationId,
              status: { not: 'APPLIED' },
            },
            select: { status: true, lastError: true },
          });
          if (unresolved) {
            if (
              unresolved.status === 'PENDING' ||
              unresolved.status === 'FAILED' ||
              unresolved.status === 'PROCESSING'
            ) {
              throw new Error(
                `AJUSTE_ENCERRAMENTO_RETRY_PENDENTE:${unresolved.status}:${unresolved.lastError ?? ''}`,
              );
            }
            throw new Error(
              `RESULTADO_INCERTO:AJUSTE_ENCERRAMENTO_${unresolved.status}:${unresolved.lastError ?? ''}`,
            );
          }
        }
      }

      await withOwnedTransaction(assertOwned, (tx) => tx.standaloneSubscription.updateMany({
        where: { id: sourceFinancialAgreementId, contaId: event.contaId },
        data: {
          closureScheduledAt: new Date(),
          validUntil: effectiveDate ? new Date(`${effectiveDate}T12:00:00.000Z`) : undefined,
          familyTransitionId: event.aggregateId,
        },
      }));

      const completed = await prisma.familyBillingOutbox.updateMany({
        where: {
          id: eventId,
          contaId: event.contaId,
          status: FamilyBillingOutboxStatus.PROCESSING,
          claimToken,
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: FamilyBillingOutboxStatus.PROCESSED,
          processedAt: new Date(),
          lockedAt: null,
          leaseExpiresAt: null,
          claimToken: null,
          lastError: null,
        },
      });

      if (completed.count !== 1) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
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
    if (parsedFamilyPayload.billingPhase) {
      const family = await prisma.matriculaFamiliar.findFirst({
        where: { id: event.aggregateId, contaId: event.contaId },
        select: { status: true, matriculas: { select: { id: true, status: true, cobrarDurantePausa: true, dataRetornoPrevista: true, dataInicio: true } } },
      });
      if (!family || family.status === FamilyBillingStatus.CANCELADO) {
        const skipped = await prisma.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: { status: FamilyBillingOutboxStatus.PROCESSED, processedAt: new Date(), lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: 'SKIPPED:FAMILIA_ENCERRADA_ANTES_DA_VIGENCIA' },
        });
        if (skipped.count !== 1) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
        return { processed: false, reason: 'FAMILY_TERMINAL' as const };
      }
      if (parsedFamilyPayload.billingPhase === 'RECURRING') {
        const account = await prisma.conta.findUnique({ where: { id: event.contaId }, select: { timezone: true } });
        const persistedOperationIds = !parsedFamilyPayload.operationMatriculaIds && parsedFamilyPayload.operationId
          ? await prisma.familyFinancialAllocation.findMany({
              where: {
                contaId: event.contaId,
                familyGroupId: event.aggregateId,
                familyEnrollmentOperationId: parsedFamilyPayload.operationId,
                matriculaId: { not: null },
              },
              select: { matriculaId: true },
              distinct: ['matriculaId'],
            })
          : [];
        const latestFutureStart = resolveFamilyOperationFutureStart({
          members: family.matriculas,
          operationMatriculaIds: parsedFamilyPayload.operationMatriculaIds ?? (persistedOperationIds.length
            ? persistedOperationIds.flatMap(({ matriculaId }) => matriculaId ? [matriculaId] : [])
            : null),
          now: new Date(),
          timezone: account?.timezone,
        });
        if (latestFutureStart) {
          const rescheduledPayload = {
            ...parsedFamilyPayload,
            scheduledEffectiveAt: latestFutureStart.toISOString(),
          };
          await prisma.familyBillingOutbox.updateMany({
            where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
            data: {
              status: FamilyBillingOutboxStatus.PENDING,
              availableAt: latestFutureStart,
              payload: rescheduledPayload as unknown as Prisma.InputJsonValue,
              lockedAt: null,
              leaseExpiresAt: null,
          claimToken: null,
              processedAt: null,
              lastError: 'AGUARDANDO_INICIO_ACADEMICO_ATUALIZADO',
            },
          });
          return { processed: false, reason: 'NOT_YET_EFFECTIVE' as const };
        }
      }
      if (parsedFamilyPayload.billingPhase === 'RECURRING' && parsedFamilyPayload.enrollmentFeeValue > 0) {
        const feeOutbox = parsedFamilyPayload.operationId
          ? await prisma.familyBillingOutbox.findFirst({
              where: {
                contaId: event.contaId,
                eventType: `FUTURE_FAMILY_ENROLLMENT_FEE:${parsedFamilyPayload.operationId}`,
                payload: { path: ['operationId'], equals: parsedFamilyPayload.operationId },
              },
              select: { status: true },
            })
          : null;
        if (feeOutbox?.status !== FamilyBillingOutboxStatus.PROCESSED) {
          const attemptsAfterClaim = Number(event.attempts ?? 0) + 1;
          const exhausted = attemptsAfterClaim >= 8;
          const retryAt = new Date(Date.now() + Math.min(60, Math.max(5, attemptsAfterClaim * 5)) * 60 * 1000);
          await prisma.familyBillingOutbox.updateMany({
            where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
            data: {
              status: exhausted ? FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION : FamilyBillingOutboxStatus.PENDING,
              lockedAt: null,
              leaseExpiresAt: null,
          claimToken: null,
              availableAt: retryAt,
              lastError: exhausted
                ? 'LIMITE_DE_TENTATIVAS_AGUARDANDO_CONFIRMACAO_DA_TAXA'
                : 'RECORRENCIA_FUTURA_AGUARDANDO_CONFIRMACAO_DA_TAXA',
            },
          });
          return { processed: false, reason: 'ENROLLMENT_FEE_NOT_CONFIRMED' as const };
        }
      }
      const isEnrollmentFeePhase = parsedFamilyPayload.billingPhase === 'ENROLLMENT_FEE';
      const chargeKind = isEnrollmentFeePhase ? 'TAXA_MATRICULA' : 'MENSALIDADE';
      const allocations = await prisma.familyFinancialAllocation.findMany({
        where: {
          contaId: event.contaId,
          familyGroupId: event.aggregateId,
          familyEnrollmentOperationId: parsedFamilyPayload.operationId ?? undefined,
          chargeKind,
        },
        select: { matriculaId: true, amount: true, status: true, sourceChargeId: true },
      });
      const billableMatriculaIdsNow = family.matriculas
        .filter((member) => member.status !== StatusMatricula.CANCELADA && member.status !== StatusMatricula.ENCERRADA && member.status !== StatusMatricula.RECUSADA && (isEnrollmentFeePhase || member.status !== StatusMatricula.PAUSADA || member.cobrarDurantePausa))
        .map((member) => member.id)
        .sort();
      const priorBillableIds = parsedFamilyPayload.billableMatriculaIds?.slice().sort() ?? null;
      const priorRemoteEffect = allocations.some((allocation) => allocation.status !== 'PENDING' || allocation.sourceChargeId !== null);
      if (priorBillableIds && priorBillableIds.join('|') !== billableMatriculaIdsNow.join('|') && priorRemoteEffect) {
        await prisma.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: {
            status: FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION,
            lockedAt: null,
            leaseExpiresAt: null,
          claimToken: null,
            lastError: 'FUTURE_FAMILY_MEMBERS_CHANGED_AFTER_PREPARATION',
          },
        });
        return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      }
      if (priorBillableIds && priorBillableIds.join('|') === billableMatriculaIdsNow.join('|') && priorRemoteEffect) {
        parsedFamilyPayload = { ...parsedFamilyPayload, billableMatriculaIds: priorBillableIds };
      } else {
      const resolution = resolveFutureFamilyBillingAmounts({
        phase: parsedFamilyPayload.billingPhase,
        operationId: parsedFamilyPayload.operationId,
        payload: {
          monthlyValue: parsedFamilyPayload.monthlyValue,
          enrollmentFeeValue: parsedFamilyPayload.enrollmentFeeValue,
        },
        members: family.matriculas,
        allocations: allocations.map((allocation) => ({
          matriculaId: allocation.matriculaId,
          amount: Number(allocation.amount),
        })),
      });
      if (resolution.kind === 'DEFER_PAUSED') {
        const now = new Date();
        const nextExpectedReturn = family.matriculas
          .filter((member) => member.status === StatusMatricula.PAUSADA && !member.cobrarDurantePausa && member.dataRetornoPrevista)
          .map((member) => member.dataRetornoPrevista!)
          .filter((date) => date > now)
          .sort((left, right) => left.getTime() - right.getTime())[0];
        const availableAt = nextExpectedReturn ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await prisma.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: {
            status: FamilyBillingOutboxStatus.PENDING,
            availableAt,
            lockedAt: null,
            leaseExpiresAt: null,
          claimToken: null,
            processedAt: null,
            lastError: 'AGUARDANDO_RETORNO_DA_PAUSA_FAMILIAR',
          },
        });
        return { processed: false, reason: 'FAMILY_PAUSED' as const };
      }
      if (resolution.kind === 'CANCEL_TERMINAL') {
        const skipped = await prisma.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: { status: FamilyBillingOutboxStatus.PROCESSED, processedAt: new Date(), lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: 'SKIPPED:FAMILIA_ENCERRADA_ANTES_DA_VIGENCIA' },
        });
        if (skipped.count !== 1) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
        return { processed: false, reason: 'FAMILY_TERMINAL' as const };
      }
      if (resolution.kind === 'REQUIRES_RECONCILIATION') {
        await prisma.familyBillingOutbox.updateMany({
          where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
          data: {
            status: FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION,
            lockedAt: null,
            leaseExpiresAt: null,
          claimToken: null,
            lastError: 'FUTURE_FAMILY_BILLING_CANNOT_BE_RECALCULATED_SAFELY',
          },
        });
        return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      }
      const billableMatriculaIds = billableMatriculaIdsNow;
      const terminalMatriculaIds = family.matriculas
        .filter((member) => ['CANCELADA', 'ENCERRADA', 'RECUSADA'].includes(member.status))
        .map((member) => member.id);
      if (terminalMatriculaIds.length > 0) {
        await withOwnedTransaction(assertOwned, (tx) => tx.familyFinancialAllocation.updateMany({
          where: {
            contaId: event.contaId,
            familyGroupId: event.aggregateId,
            familyEnrollmentOperationId: parsedFamilyPayload!.operationId ?? undefined,
            chargeKind,
            matriculaId: { in: terminalMatriculaIds },
            status: 'PENDING',
          },
          data: { status: 'CANCELLED' },
        }));
      }
      parsedFamilyPayload = {
        ...parsedFamilyPayload,
        totalAlunos: resolution.totalAlunos,
        monthlyValue: resolution.monthlyValue,
        enrollmentFeeValue: resolution.enrollmentFeeValue,
        billableMatriculaIds,
      };
      const prepared = await prisma.familyBillingOutbox.updateMany({
        where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
        data: { payload: parsedFamilyPayload as unknown as Prisma.InputJsonValue },
      });
      if (prepared.count === 0) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      }
    }
    await assertOwned();
    await executeFamilyBilling(parsedFamilyPayload, assertOwned);

    const completed = await prisma.familyBillingOutbox.updateMany({
      where: {
        id: eventId,
        contaId: event.contaId,
        status: FamilyBillingOutboxStatus.PROCESSING,
        claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: FamilyBillingOutboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastError: null,
      },
    });

    if (completed.count === 0) {
      return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
    }

    return { processed: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let uncertain = isUncertainFinancialResult(error) || leaseLost || message.includes('FAMILY_BILLING_LEASE_LOST');
    const catchGuard: FamilyBillingOwnershipGuard = async (tx) => {
      if (leaseLost) throw new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
      const renewed = tx
        ? await tx.familyBillingOutbox.updateMany({
            where: { id: eventId, contaId: event.contaId, status: FamilyBillingOutboxStatus.PROCESSING, claimToken, leaseExpiresAt: { gt: new Date() } },
            data: { leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000) },
          })
        : { count: (await renewLease()) ? 1 : 0 };
      if (renewed.count !== 1) throw new Error('FAMILY_BILLING_LEASE_LOST_RESULT_UNCERTAIN');
    };
    const catchAssertOwned = async () => {
      try { await catchGuard(); return true; } catch { return false; }
    };
    if (!(await catchAssertOwned())) { clearInterval(heartbeat); return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const }; }
    let compensationMessage = '';
    if (
      parsedFamilyPayload?.aggregateType === 'MATRICULA_FAMILIAR' &&
      !uncertain &&
      parsedFamilyPayload.strategy !== 'JOIN_EXISTING_CURRENT_CYCLE'
    ) {
      try {
        if (!(await catchAssertOwned())) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
        const compensation = await compensateFamilyCreationRemoteEffects(parsedFamilyPayload, catchGuard);
        if (!compensation.complete) {
          uncertain = true;
          compensationMessage = ` COMPENSACAO_INCOMPLETA:${compensation.errors.join('|')}`;
        }
      } catch (compensationError) {
        uncertain = true;
        compensationMessage = ` COMPENSACAO_INCOMPLETA:${compensationError instanceof Error ? compensationError.message : String(compensationError)}`;
      }
    }
    const finalMessage = `${message}${compensationMessage}`;
    if (parsedFamilyPayload) {
      if (!(await catchAssertOwned())) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      if (uncertain) {
        await withOwnedTransaction(assertOwned, (tx) => persistAggregateUncertain(parsedFamilyPayload!, finalMessage, assertOwned, tx));
      } else {
        await withOwnedTransaction(assertOwned, (tx) => persistAggregateFailure(parsedFamilyPayload!, finalMessage, assertOwned, tx));
      }
    } else if (event.aggregateType === 'REMATRICULA_FAMILIAR') {
      if (!(await catchAssertOwned())) return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
      await withOwnedTransaction(catchGuard, (tx) => tx.rematriculaFamiliar.updateMany({
        where: { id: event.aggregateId, contaId: event.contaId },
        data: {
          status: FamilyBillingStatus.FALHO,
          ultimoErro: uncertain
            ? `RESULTADO_INCERTO: ${message.slice(0, 1900)}`
            : message.slice(0, 2000),
          failureMessage: message.slice(0, 2000),
        },
      }));
    }
    await prisma.familyBillingOutbox.updateMany({
      where: {
        id: eventId,
        contaId: event.contaId,
        status: FamilyBillingOutboxStatus.PROCESSING,
        claimToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: uncertain
          ? FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION
          : FamilyBillingOutboxStatus.FAILED,
        lockedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastError: finalMessage.slice(0, 2000),
        availableAt: new Date(
          Date.now() + Math.min(60, Math.max(5, event.attempts + 1) * 5) * 60 * 1000,
        ),
      },
    });
    if (uncertain) {
      return { processed: false, reason: 'REQUIRES_RECONCILIATION' as const };
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function diagnoseFamilyBillingIntegrity(params?: {
  contaId?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(params?.limit ?? 25, 100));
  const scope = params?.contaId ? { contaId: params.contaId } : {};
  const [groups, matriculas, pendingGroups] = await Promise.all([
    prisma.matriculaFamiliar.findMany({
      where: {
        ...scope,
        status: FamilyBillingStatus.ATIVO,
        billingProvisionStatus: { not: MatriculaBillingProvisionStatus.PROVISIONADO },
        OR: [{ valorMensalidadeTotal: { gt: 0 } }, { valorTaxaMatriculaTotal: { gt: 0 } }],
      },
      select: { id: true, contaId: true },
      take: limit,
    }),
    prisma.matricula.findMany({
      where: {
        ...scope,
        matriculaFamiliarId: { not: null },
        status: 'ATIVA',
          billingProvisionStatus: {
          in: [
            MatriculaBillingProvisionStatus.PENDENTE,
            MatriculaBillingProvisionStatus.PARCIAL,
            MatriculaBillingProvisionStatus.FALHO,
            MatriculaBillingProvisionStatus.RESULTADO_INCERTO,
            ],
          },
        },
      select: { id: true, contaId: true, matriculaFamiliarId: true },
      take: limit,
    }),
    prisma.matriculaFamiliar.findMany({
      where: {
        ...scope,
        status: { in: [FamilyBillingStatus.PENDENTE, FamilyBillingStatus.PARCIAL] },
        billingProvisionStatus: {
          in: [
            MatriculaBillingProvisionStatus.PENDENTE,
            MatriculaBillingProvisionStatus.PARCIAL,
            MatriculaBillingProvisionStatus.FALHO,
          ],
        },
        OR: [{ valorMensalidadeTotal: { gt: 0 } }, { valorTaxaMatriculaTotal: { gt: 0 } }],
        outboxEvents: { none: {} },
      },
      select: { id: true, contaId: true },
      take: limit,
    }),
  ]);

  const result = {
    activeGroupsWithoutProvisioning: groups,
    activeMatriculasWithoutProvisioning: matriculas,
    pendingGroupsWithoutOutbox: pendingGroups,
    total: groups.length + matriculas.length + pendingGroups.length,
  };
  if (result.total > 0) {
    logFinanceOperationalEvent({
      severity: 'warn',
      eventName: 'finance.family_billing.processor.degraded',
      error: result,
      throttleMs: 60_000,
    });
  }
  return result;
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
          claimToken: null,
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
  const cappedOpenEvents = await prisma.familyBillingOutbox.findMany({
    where: {
      attempts: { gte: 8 },
      status: { in: [FamilyBillingOutboxStatus.PENDING, FamilyBillingOutboxStatus.FAILED] },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    take: limit,
    select: { id: true, contaId: true, matriculaFamiliarId: true, payload: true },
  });
  let cappedReconciliationCount = 0;
  for (const capped of cappedOpenEvents) {
    let operationId: string | null = null;
    try { operationId = parseFamilyBillingPayload(capped.payload).operationId ?? null; } catch { /* handled by durable outbox state */ }
    const transitioned = await prisma.$transaction(async (tx) => {
      const marked = await tx.familyBillingOutbox.updateMany({
        where: { id: capped.id, contaId: capped.contaId, status: { in: [FamilyBillingOutboxStatus.PENDING, FamilyBillingOutboxStatus.FAILED] }, attempts: { gte: 8 } },
        data: { status: FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION, lockedAt: null, leaseExpiresAt: null, claimToken: null, lastError: 'LIMITE_DE_TENTATIVAS_ATINGIDO_REQUER_RECONCILIACAO' },
      });
      if (!marked.count) return false;
      if (operationId) await tx.familyEnrollmentOperation.updateMany({
        where: { id: operationId, contaId: capped.contaId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'REQUIRES_RECONCILIATION', lastError: 'LIMITE_DE_TENTATIVAS_ATINGIDO_REQUER_RECONCILIACAO' },
      });
      if (capped.matriculaFamiliarId) await tx.matriculaFamiliar.updateMany({
        where: { id: capped.matriculaFamiliarId, contaId: capped.contaId },
        data: { billingProvisionStatus: MatriculaBillingProvisionStatus.RESULTADO_INCERTO, ultimoErro: 'LIMITE_DE_TENTATIVAS_ATINGIDO_REQUER_RECONCILIACAO' },
      });
      return true;
    });
    if (transitioned) cappedReconciliationCount += 1;
  }
  const events = await prisma.familyBillingOutbox.findMany({
    where: {
      status: {
        in: [
          FamilyBillingOutboxStatus.PENDING,
          FamilyBillingOutboxStatus.FAILED,
          FamilyBillingOutboxStatus.REQUIRES_RECONCILIATION,
        ],
      },
      availableAt: { lte: new Date() },
      attempts: { lt: 8 },
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
      const result = await processFamilyBillingOutboxEvent(event.id, {
        allowReconciliation: true,
      });
      if (result.processed) processed += 1;
      if (result.reason === 'REQUIRES_RECONCILIATION') requiresReconciliation += 1;
    } catch {
      failed += 1;
    }
  }

  const diagnostics = await diagnoseFamilyBillingIntegrity({
    contaId: params?.contaId,
    limit,
  });

  return {
    attempted: events.length,
    processed,
    failed,
    requiresReconciliation: requiresReconciliation + expiredLeases.length + cappedReconciliationCount,
    diagnostics,
  };
}
