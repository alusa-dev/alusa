import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { BillingAgreementError } from './errors';
import { decimalToCents } from './money';
import type {
  ApplyConfirmedBillingChangeInput,
  BillingAgreementRepositoryPort,
  ReserveBillingOperationInput,
  ReserveBillingOperationResult,
} from './ports';
import type {
  BillingAgreement,
  BillingAgreementChangeResult,
  BillingAgreementContext,
  BillingAllocation,
  BillingAllocationDraft,
  BillingChangeKind,
  BillingChangeOperation,
  BillingCharge,
  BillingRemoteProgress,
} from './types';

type JsonObject = { [key: string]: Prisma.InputJsonValue };

function toJson(value: unknown): Prisma.InputJsonValue {
  // Prisma diferencia NULL da coluna e null dentro de JSON. Aqui o valor
  // sempre será persistido em uma coluna JSON, portanto null é conteúdo.
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === 'object') {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) result[key] = toJson(item);
    }
    return result;
  }
  return String(value);
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function exclusiveDayAfter(value: Date): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function parseBillingType(value: string): BillingAgreement['billingType'] {
  if (value === 'UNDEFINED' || value === 'BOLETO' || value === 'PIX' || value === 'CREDIT_CARD') return value;
  throw new BillingAgreementError('INVALID_INPUT', `Forma de pagamento não suportada: ${value}.`);
}

function parseCycle(value: string): BillingAgreement['cycle'] {
  if (
    value === 'WEEKLY' ||
    value === 'BIWEEKLY' ||
    value === 'MONTHLY' ||
    value === 'BIMONTHLY' ||
    value === 'QUARTERLY' ||
    value === 'SEMIANNUALLY' ||
    value === 'YEARLY'
  ) return value;
  throw new BillingAgreementError('INVALID_INPUT', `Ciclo financeiro não suportado: ${value}.`);
}

function operationType(kind: BillingChangeKind) {
  const types = {
    ADD_ALLOCATION: 'ADD',
    REMOVE_ALLOCATION: 'REMOVE',
    UPDATE_ALLOCATION: 'UPDATE',
    TRANSFER_ALLOCATION: 'TRANSFER',
    PAUSE_ALLOCATION: 'PAUSE_ALLOCATION',
    RESUME_ALLOCATION: 'RESUME_ALLOCATION',
    PAUSE_AGREEMENT: 'PAUSE_AGREEMENT',
    RESUME_AGREEMENT: 'RESUME_AGREEMENT',
    CHANGE_PAYER: 'CHANGE_PAYER',
    CANCEL_AGREEMENT: 'CANCEL',
  } as const;
  return types[kind];
}

function kindFromOperation(value: string): BillingChangeKind {
  const kinds: Record<string, BillingChangeKind> = {
    ADD: 'ADD_ALLOCATION',
    REMOVE: 'REMOVE_ALLOCATION',
    UPDATE: 'UPDATE_ALLOCATION',
    TRANSFER: 'TRANSFER_ALLOCATION',
    PAUSE_ALLOCATION: 'PAUSE_ALLOCATION',
    RESUME_ALLOCATION: 'RESUME_ALLOCATION',
    PAUSE_AGREEMENT: 'PAUSE_AGREEMENT',
    RESUME_AGREEMENT: 'RESUME_AGREEMENT',
    CHANGE_PAYER: 'CHANGE_PAYER',
    CANCEL: 'CANCEL_AGREEMENT',
  };
  const kind = kinds[value];
  if (!kind) throw new BillingAgreementError('INVALID_INPUT', `Operação financeira desconhecida: ${value}.`);
  return kind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRemoteProgress(value: unknown): BillingRemoteProgress[] {
  const container = isRecord(value) && Array.isArray(value.remoteProgress) ? value.remoteProgress : [];
  return container.flatMap((item): BillingRemoteProgress[] => {
    if (!isRecord(item)) return [];
    if (
      typeof item.agreementId !== 'string' ||
      typeof item.action !== 'string' ||
      typeof item.expectedAmountCents !== 'number' ||
      typeof item.confirmed !== 'boolean'
    ) return [];
    return [{
      agreementId: item.agreementId,
      action: item.action as BillingRemoteProgress['action'],
      previousSubscriptionId:
        typeof item.previousSubscriptionId === 'string' ? item.previousSubscriptionId : null,
      resultingSubscriptionId:
        typeof item.resultingSubscriptionId === 'string' ? item.resultingSubscriptionId : null,
      expectedAmountCents: item.expectedAmountCents,
      confirmed: item.confirmed,
    }];
  });
}

function parseOperationResult(value: unknown): BillingAgreementChangeResult | null {
  if (!isRecord(value) || value.status !== 'COMPLETED') return null;
  if (
    typeof value.operationId !== 'string' ||
    typeof value.uiRequestId !== 'string' ||
    !Array.isArray(value.agreementIds) ||
    typeof value.correlationId !== 'string'
  ) return null;
  const agreementIds = value.agreementIds.filter((id): id is string => typeof id === 'string');
  const amounts = isRecord(value.resultingAmountsCents)
    ? Object.fromEntries(Object.entries(value.resultingAmountsCents).filter(([, amount]) => typeof amount === 'number'))
    : {};
  const versions = isRecord(value.versions)
    ? Object.fromEntries(Object.entries(value.versions).filter(([, version]) => typeof version === 'number'))
    : {};
  return {
    operationId: value.operationId,
    uiRequestId: value.uiRequestId,
    status: 'COMPLETED',
    agreementIds,
    resultingAmountsCents: amounts as Record<string, number>,
    versions: versions as Record<string, number>,
    adjustments: [],
    remoteProgress: parseRemoteProgress(value),
    correlationId: value.correlationId,
  };
}

function mapOperation(row: {
  id: string;
  contaId: string;
  uiRequestId: string;
  type: string;
  status: string;
  requestFingerprint: string;
  sourceAgreementId: string | null;
  targetAgreementId: string | null;
  expectedVersion: number;
  previewHash: string;
  effectivePolicy: string;
  effectiveAt: Date;
  correlationId: string;
  result: Prisma.JsonValue | null;
  lastError: string | null;
}): BillingChangeOperation {
  return {
    id: row.id,
    contaId: row.contaId,
    uiRequestId: row.uiRequestId,
    kind: kindFromOperation(row.type),
    status: row.status as BillingChangeOperation['status'],
    requestFingerprint: row.requestFingerprint,
    sourceAgreementId: row.sourceAgreementId ?? '',
    targetAgreementId: row.targetAgreementId,
    expectedVersion: row.expectedVersion,
    previewHash: row.previewHash,
    effectivePolicy: row.effectivePolicy as BillingChangeOperation['effectivePolicy'],
    effectiveDate: row.effectiveAt.toISOString().slice(0, 10),
    correlationId: row.correlationId,
    remoteProgress: parseRemoteProgress(row.result),
    result: parseOperationResult(row.result),
    errorCode: row.lastError,
  };
}

function mapChargeStatus(value: string): string {
  const map: Record<string, string> = {
    CREATED: 'PENDING',
    PENDING_SYNC: 'PENDING',
    OPEN: 'PENDING',
    OVERDUE: 'OVERDUE',
    PAID: 'RECEIVED',
    CANCELED: 'DELETED',
    PENDENTE: 'PENDING',
    A_VENCER: 'PENDING',
    ATRASADO: 'OVERDUE',
    PROCESSANDO: 'AWAITING_RISK_ANALYSIS',
    PAGO: 'RECEIVED',
    CANCELADO: 'DELETED',
    VENCIDO: 'OVERDUE',
    ESTORNADO: 'REFUNDED',
    ESTORNADO_PARCIAL: 'REFUNDED',
  };
  return map[value] ?? value;
}

function billingAllocation(input: {
  id: string;
  contaId: string;
  agreementId: string;
  matriculaId: string;
  alunoId: string;
  kind: string;
  status: string;
  recurring: boolean;
  baseAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  validFrom: Date;
  validUntil: Date | null;
  prorationPolicy: string;
}): BillingAllocation {
  return {
    id: input.id,
    contaId: input.contaId,
    agreementId: input.agreementId,
    enrollmentId: input.matriculaId,
    studentId: input.alunoId,
    kind: input.kind as BillingAllocation['kind'],
    status: input.status as BillingAllocation['status'],
    recurring: input.recurring,
    baseAmountCents: decimalToCents(Number(input.baseAmount)),
    discountAmountCents: decimalToCents(Number(input.discountAmount)),
    netAmountCents: decimalToCents(Number(input.netAmount)),
    validFrom: input.validFrom.toISOString().slice(0, 10),
    validUntil: dateOnly(input.validUntil),
    prorationPolicy: input.prorationPolicy as BillingAllocation['prorationPolicy'],
  };
}

function amountDecimal(cents: number): number {
  return cents / 100;
}

function prorationPolicy(value: BillingAllocationDraft['prorationPolicy']) {
  return value ?? 'FULL_CURRENT_CYCLE';
}

function statusForStart(validFrom: Date): 'ACTIVE' | 'SCHEDULED' {
  return validFrom.getTime() > Date.now() ? 'SCHEDULED' : 'ACTIVE';
}

export function createPrismaBillingAgreementRepository(
  prisma: PrismaClient,
): BillingAgreementRepositoryPort {
  return {
    async getAgreementContext(input): Promise<BillingAgreementContext | null> {
      const row = await prisma.billingAgreement.findFirst({
        where: { id: input.agreementId, contaId: input.contaId },
        include: {
          customer: { select: { asaasCustomerId: true } },
          allocations: {
            include: {
              sourceCharge: {
                include: {
                  cobranca: true,
                  familyFinancialAllocations: {
                    select: { competenceStart: true, competenceEnd: true },
                  },
                },
              },
            },
            orderBy: [{ validFrom: 'asc' }, { id: 'asc' }],
          },
          legacyStandaloneSubscriptions: {
            include: { charges: { include: { cobranca: true } } },
          },
          legacySubscriptions: {
            include: {
              matricula: { include: { cobrancas: { include: { charge: true } } } },
            },
          },
        },
      });
      if (!row) return null;
      const charges = new Map<string, BillingCharge>();
      let currentCycle: BillingAgreementContext['currentCycle'] = null;
      const effectiveDate = input.effectiveDate ?? new Date().toISOString().slice(0, 10);
      const addCharge = (charge: BillingCharge, cycle?: { startsAt: Date; endsAt: Date } | null) => {
        charges.set(charge.id, charge);
        if (
          cycle &&
          cycle.startsAt.toISOString().slice(0, 10) <= effectiveDate &&
          cycle.endsAt.toISOString().slice(0, 10) > effectiveDate
        ) {
          currentCycle = {
            startsAt: cycle.startsAt.toISOString().slice(0, 10),
            endsAt: cycle.endsAt.toISOString().slice(0, 10),
          };
        }
      };
      for (const allocation of row.allocations) {
        const charge = allocation.sourceCharge;
        if (!charge) continue;
        const cobranca = charge.cobranca;
        const familyCycle = charge.familyFinancialAllocations[0];
        addCharge(
          {
            id: charge.id,
            contaId: row.contaId,
            agreementId: row.id,
            allocationId: allocation.id,
            providerPaymentId: charge.asaasPaymentId,
            status: mapChargeStatus(charge.asaasStatus ?? charge.status),
            amountCents: decimalToCents(Number(charge.asaasValue ?? charge.value ?? cobranca?.valor ?? 0)),
            dueDate: dateOnly(charge.dueDate ?? cobranca?.vencimento) ?? effectiveDate,
          },
          cobranca?.competenciaFim
            ? { startsAt: cobranca.competenciaInicio, endsAt: exclusiveDayAfter(cobranca.competenciaFim) }
            : familyCycle?.competenceEnd
              ? { startsAt: familyCycle.competenceStart, endsAt: exclusiveDayAfter(familyCycle.competenceEnd) }
              : null,
        );
      }
      for (const subscription of row.legacyStandaloneSubscriptions) {
        for (const charge of subscription.charges) {
          addCharge({
            id: charge.id,
            contaId: row.contaId,
            agreementId: row.id,
            allocationId: null,
            providerPaymentId: charge.asaasPaymentId,
            status: mapChargeStatus(charge.asaasStatus ?? charge.status),
            amountCents: decimalToCents(Number(charge.asaasValue ?? charge.value ?? charge.cobranca?.valor ?? 0)),
            dueDate: dateOnly(charge.dueDate ?? charge.cobranca?.vencimento) ?? effectiveDate,
          }, charge.cobranca?.competenciaFim ? {
            startsAt: charge.cobranca.competenciaInicio,
            endsAt: exclusiveDayAfter(charge.cobranca.competenciaFim),
          } : null);
        }
      }
      for (const subscription of row.legacySubscriptions) {
        for (const cobranca of subscription.matricula.cobrancas) {
          const chargeId = cobranca.charge?.id ?? `cobranca:${cobranca.id}`;
          addCharge({
            id: chargeId,
            contaId: row.contaId,
            agreementId: row.id,
            allocationId: null,
            providerPaymentId: cobranca.asaasPaymentId ?? cobranca.charge?.asaasPaymentId ?? null,
            status: mapChargeStatus(cobranca.asaasStatus ?? cobranca.status),
            amountCents: decimalToCents(Number(cobranca.asaasValue ?? cobranca.valor)),
            dueDate: cobranca.vencimento.toISOString().slice(0, 10),
          }, { startsAt: cobranca.competenciaInicio, endsAt: exclusiveDayAfter(cobranca.competenciaFim) });
        }
      }
      const legacyStandalone = row.legacyStandaloneSubscriptions[0];
      const agreement: BillingAgreement = {
        id: row.id,
        contaId: row.contaId,
        payer: {
          type: row.payerType,
          id: row.payerId,
          customerId: row.customer?.asaasCustomerId ?? '',
        },
        status: row.status,
        billingType: parseBillingType(row.billingType),
        cycle: parseCycle(row.cycle),
        dueDay: row.dueDay,
        nextDueDate: dateOnly(row.nextDueDate),
        validFrom: dateOnly(row.validFrom),
        validUntil: dateOnly(row.validUntil),
        desiredAmountCents: decimalToCents(Number(row.desiredValue)),
        confirmedAmountCents: decimalToCents(Number(row.confirmedValue)),
        asaasSubscriptionId: row.asaasSubscriptionId,
        remoteStatus: row.remoteStatus,
        version: row.version,
        externalReference: row.externalReference,
        description: legacyStandalone?.description ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      return {
        agreement,
        allocations: row.allocations.map(billingAllocation),
        charges: [...charges.values()].sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
        currentCycle,
      };
    },

    async getOperationByRequest(input) {
      const row = await prisma.billingChangeOperation.findUnique({
        where: { uq_billing_change_operation_conta_request: input },
      });
      return row ? mapOperation(row) : null;
    },

    async reserveOperation(input: ReserveBillingOperationInput): Promise<ReserveBillingOperationResult> {
      const agreementIds = [
        input.change.agreementId,
        ...(input.change.kind === 'TRANSFER_ALLOCATION' ? [input.change.targetAgreementId] : []),
      ];
      const scheduled = await prisma.billingChangeOperation.findFirst({
        where: {
          contaId: input.contaId,
          status: 'COMPLETED',
          effectivePolicy: 'NEXT_CYCLE',
          scheduledAppliedAt: null,
          OR: [
            { sourceAgreementId: { in: agreementIds } },
            { targetAgreementId: { in: agreementIds } },
          ],
        },
        orderBy: { effectiveAt: 'asc' },
      });
      if (scheduled) return { outcome: 'CONFLICT', operation: mapOperation(scheduled) };
      try {
        const row = await prisma.billingChangeOperation.create({
          data: {
            contaId: input.contaId,
            sourceAgreementId: input.change.agreementId,
            targetAgreementId:
              input.change.kind === 'TRANSFER_ALLOCATION' ? input.change.targetAgreementId : null,
            allocationId:
              'allocationIds' in input.change && input.change.allocationIds.length === 1
                ? input.change.allocationIds[0]
                : input.change.kind === 'UPDATE_ALLOCATION' && input.change.allocations.length === 1
                  ? input.change.allocations[0].allocationId
                  : null,
            type: operationType(input.change.kind),
            status: 'PROCESSING',
            uiRequestId: input.uiRequestId,
            requestFingerprint: input.requestFingerprint,
            expectedVersion: input.preview.sourceVersion,
            effectivePolicy: input.change.effectivePolicy,
            effectiveAt: new Date(`${input.change.effectiveDate}T00:00:00.000Z`),
            previewHash: input.preview.previewHash,
            sourceVersion: JSON.stringify(
              Object.fromEntries(input.preview.plans.map((plan) => [plan.agreementId, plan.sourceVersion])),
            ),
            previousAmount: amountDecimal(input.preview.currentAmountCents),
            addedAmount: amountDecimal(input.preview.addedAmountCents),
            removedAmount: amountDecimal(input.preview.removedAmountCents),
            resultingAmount: amountDecimal(input.preview.resultingAmountCents),
            requestPayload: toJson(input.change),
            result: toJson({ remoteProgress: [] }),
            correlationId: input.correlationId,
            actorId: input.change.actorId,
            attempts: 1,
            lockedAt: new Date(),
            lastAttemptAt: new Date(),
          },
        });
        return { outcome: 'RESERVED', operation: mapOperation(row) };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        const existing = await prisma.billingChangeOperation.findUnique({
          where: { uq_billing_change_operation_conta_request: { contaId: input.contaId, uiRequestId: input.uiRequestId } },
        });
        if (!existing) {
          const active = await prisma.billingChangeOperation.findFirst({
            where: {
              contaId: input.contaId,
              status: { in: ['PENDING', 'PROCESSING', 'REQUIRES_RECONCILIATION'] },
              OR: [
                { sourceAgreementId: { in: agreementIds } },
                { targetAgreementId: { in: agreementIds } },
              ],
            },
            orderBy: { createdAt: 'asc' },
          });
          if (!active) throw error;
          return { outcome: 'CONFLICT', operation: mapOperation(active) };
        }
        const operation = mapOperation(existing);
        return operation.requestFingerprint === input.requestFingerprint
          ? { outcome: 'EXISTING', operation }
          : { outcome: 'CONFLICT', operation };
      }
    },

    async recordRemoteProgress(input) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: input.operationId, contaId: input.contaId, status: { in: ['PROCESSING', 'REQUIRES_RECONCILIATION'] } },
        data: { result: toJson({ remoteProgress: input.progress }), lastAttemptAt: new Date() },
      });
    },

    async applyConfirmedChange(input: ApplyConfirmedBillingChangeInput) {
      return prisma.$transaction(async (tx): Promise<BillingAgreementChangeResult> => {
        const plans = new Map(input.preview.plans.map((plan) => [plan.agreementId, plan]));
        for (const [agreementId, version] of Object.entries(input.expectedVersions)) {
          const updated = await tx.billingAgreement.updateMany({
            where: { id: agreementId, contaId: input.contaId, version },
            data: { version: { increment: 1 } },
          });
          if (updated.count !== 1) {
            throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'O acordo mudou durante a confirmação.');
          }
        }
        const effectiveAt = new Date(`${input.change.effectiveDate}T00:00:00.000Z`);
        const isEffectiveNow = effectiveAt.getTime() <= Date.now();
        const endAllocations = async (ids: string[], status: 'ENDED' | 'PAUSED' | 'CANCELLED') => {
          const updated = await tx.billingAllocation.updateMany({
            where: {
              contaId: input.contaId,
              agreementId: input.change.agreementId,
              id: { in: ids },
              status: { in: ['ACTIVE', 'SCHEDULED'] },
            },
            data: {
              validUntil: effectiveAt,
              ...(isEffectiveNow ? { status } : {}),
            },
          });
          if (updated.count !== ids.length) {
            throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Uma alocação mudou durante a confirmação.');
          }
        };
        const createDraft = async (agreementId: string, draft: BillingAllocationDraft) => {
          const validFrom = new Date(`${draft.validFrom ?? input.change.effectiveDate}T00:00:00.000Z`);
          await tx.billingAllocation.create({
            data: {
              contaId: input.contaId,
              agreementId,
              matriculaId: draft.enrollmentId,
              alunoId: draft.studentId,
              sourceOperationId: input.operationId,
              kind: draft.kind,
              status: statusForStart(validFrom),
              recurring: draft.recurring ?? draft.kind === 'TUITION',
              baseAmount: amountDecimal(draft.baseAmountCents),
              discountAmount: amountDecimal(draft.discountAmountCents ?? 0),
              netAmount: amountDecimal(draft.netAmountCents),
              validFrom,
              validUntil: draft.validUntil ? new Date(`${draft.validUntil}T00:00:00.000Z`) : null,
              prorationPolicy: prorationPolicy(draft.prorationPolicy),
            },
          });
        };
        if (input.change.kind === 'ADD_ALLOCATION') {
          for (const draft of input.change.allocations) await createDraft(input.change.agreementId, draft);
        } else if (input.change.kind === 'REMOVE_ALLOCATION') {
          await endAllocations(input.change.allocationIds, 'ENDED');
        } else if (input.change.kind === 'PAUSE_ALLOCATION') {
          await endAllocations(input.change.allocationIds, 'PAUSED');
        } else if (input.change.kind === 'RESUME_ALLOCATION') {
          const paused = await tx.billingAllocation.findMany({
            where: { contaId: input.contaId, agreementId: input.change.agreementId, id: { in: input.change.allocationIds }, status: 'PAUSED' },
          });
          if (paused.length !== input.change.allocationIds.length) {
            throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Alocação pausada mudou durante a retomada.');
          }
          for (const allocation of paused) {
            await tx.billingAllocation.create({
              data: {
                contaId: input.contaId,
                agreementId: input.change.agreementId,
                matriculaId: allocation.matriculaId,
                alunoId: allocation.alunoId,
                sourceOperationId: input.operationId,
                sourceChargeId: allocation.sourceChargeId,
                kind: allocation.kind,
                status: isEffectiveNow ? 'ACTIVE' : 'SCHEDULED',
                recurring: allocation.recurring,
                baseAmount: allocation.baseAmount,
                discountAmount: allocation.discountAmount,
                netAmount: allocation.netAmount,
                validFrom: effectiveAt,
                validUntil: null,
                prorationPolicy: allocation.prorationPolicy,
                metadata: allocation.metadata ?? undefined,
              },
            });
          }
        } else if (input.change.kind === 'UPDATE_ALLOCATION') {
          for (const update of input.change.allocations) {
            const current = await tx.billingAllocation.findFirst({
              where: { id: update.allocationId, contaId: input.contaId, agreementId: input.change.agreementId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
            });
            if (!current) throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Alocação não encontrada para alterar.');
            await endAllocations([current.id], 'ENDED');
            await tx.billingAllocation.create({
              data: {
                contaId: input.contaId,
                agreementId: input.change.agreementId,
                matriculaId: current.matriculaId,
                alunoId: current.alunoId,
                sourceOperationId: input.operationId,
                sourceChargeId: current.sourceChargeId,
                kind: current.kind,
                status: isEffectiveNow ? 'ACTIVE' : 'SCHEDULED',
                recurring: update.recurring ?? current.recurring,
                baseAmount: amountDecimal(update.baseAmountCents),
                discountAmount: amountDecimal(update.discountAmountCents ?? 0),
                netAmount: amountDecimal(update.netAmountCents),
                validFrom: new Date(`${update.validFrom ?? input.change.effectiveDate}T00:00:00.000Z`),
                validUntil: update.validUntil ? new Date(`${update.validUntil}T00:00:00.000Z`) : null,
                prorationPolicy: update.prorationPolicy ?? current.prorationPolicy,
                metadata: current.metadata ?? undefined,
              },
            });
          }
        } else if (input.change.kind === 'TRANSFER_ALLOCATION') {
          const selected = await tx.billingAllocation.findMany({
            where: { contaId: input.contaId, agreementId: input.change.agreementId, id: { in: input.change.allocationIds }, status: { in: ['ACTIVE', 'SCHEDULED'] } },
          });
          if (selected.length !== input.change.allocationIds.length) {
            throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Alocação mudou durante a transferência.');
          }
          await endAllocations(input.change.allocationIds, 'ENDED');
          for (const allocation of selected) {
            await tx.billingAllocation.create({
              data: {
                contaId: input.contaId,
                agreementId: input.change.targetAgreementId,
                matriculaId: allocation.matriculaId,
                alunoId: allocation.alunoId,
                sourceOperationId: input.operationId,
                sourceChargeId: allocation.sourceChargeId,
                kind: allocation.kind,
                status: isEffectiveNow ? 'ACTIVE' : 'SCHEDULED',
                recurring: allocation.recurring,
                baseAmount: allocation.baseAmount,
                discountAmount: allocation.discountAmount,
                netAmount: allocation.netAmount,
                validFrom: effectiveAt,
                validUntil: null,
                prorationPolicy: allocation.prorationPolicy,
                metadata: allocation.metadata ?? undefined,
              },
            });
          }
        } else if (input.change.kind === 'CANCEL_AGREEMENT') {
          await tx.billingAllocation.updateMany({
            where: { contaId: input.contaId, agreementId: input.change.agreementId, status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
            data: { validUntil: effectiveAt, ...(isEffectiveNow ? { status: 'CANCELLED' as const } : {}) },
          });
        }

        if (input.change.kind === 'CHANGE_PAYER') {
          const customer = await tx.customer.findFirst({
            where: { contaId: input.contaId, asaasCustomerId: input.change.newPayer.customerId },
            select: { id: true },
          });
          if (!customer) throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Customer local do novo pagador não encontrado.');
          await tx.billingAgreement.updateMany({
            where: { id: input.change.agreementId, contaId: input.contaId },
            data: { customerId: customer.id, payerType: input.change.newPayer.type, payerId: input.change.newPayer.id },
          });
        }

        const versions: Record<string, number> = {};
        const resultingAmountsCents: Record<string, number> = {};
        for (const [agreementId, plan] of plans) {
          const progress = input.remoteProgress.find((item) => item.agreementId === agreementId);
          const scheduled = plan.remoteAction.startsWith('SCHEDULE_');
          const status =
            plan.remoteAction === 'DELETE_SUBSCRIPTION'
              ? 'CANCELLED'
              : plan.remoteAction === 'PAUSE_SUBSCRIPTION'
                ? 'INACTIVE'
                : plan.resultingAmountCents > 0
                  ? 'ACTIVE'
                  : undefined;
          const updated = await tx.billingAgreement.update({
            where: { uq_billing_agreement_conta_id: { contaId: input.contaId, id: agreementId } },
            data: {
              ...(!scheduled ? {
                desiredValue: amountDecimal(plan.resultingAmountCents),
                validFrom: plan.agreementValidFrom
                  ? new Date(`${plan.agreementValidFrom}T00:00:00.000Z`)
                  : undefined,
                validUntil: plan.agreementValidUntil
                  ? new Date(`${plan.agreementValidUntil}T00:00:00.000Z`)
                  : null,
                // A pausa mantém no Asaas o último valor configurado; apenas
                // o status remoto fica INACTIVE. confirmedValue continua sendo
                // esse snapshot e não deve virar zero artificialmente.
                confirmedValue:
                  plan.remoteAction === 'PAUSE_SUBSCRIPTION'
                    ? undefined
                    : amountDecimal(plan.resultingAmountCents),
                asaasSubscriptionId: progress?.resultingSubscriptionId,
                remoteStatus: status === 'INACTIVE' ? 'INACTIVE' : status === 'ACTIVE' ? 'ACTIVE' : undefined,
                remoteStatusUpdatedAt: new Date(),
              } : {}),
              ...(status ? { status } : {}),
              lastReconciledAt: !scheduled ? new Date() : undefined,
              reconciliationError: null,
            },
            select: { version: true },
          });
          versions[agreementId] = updated.version;
          resultingAmountsCents[agreementId] = plan.resultingAmountCents;
        }
        for (const [index, adjustment] of input.adjustments.entries()) {
          const charge = adjustment.chargeId
            ? await tx.charge.findFirst({ where: { id: adjustment.chargeId, contaId: input.contaId }, select: { id: true } })
            : null;
          await tx.billingAdjustment.create({
            data: {
              contaId: input.contaId,
              agreementId: adjustment.agreementId,
              operationId: input.operationId,
              chargeId: charge?.id ?? null,
              type: adjustment.type,
              status: adjustment.type === 'MANUAL_REVIEW' ? 'REQUIRES_RECONCILIATION' : 'PENDING',
              amount: amountDecimal(adjustment.amountCents),
              effectiveAt,
              idempotencyKey: `${input.operationId}:adjustment:${index}`,
              externalReference: `billing-adjustment:${input.operationId}:${index}`,
            },
          });
        }
        const result: BillingAgreementChangeResult = {
          operationId: input.operationId,
          uiRequestId: '',
          status: 'COMPLETED',
          agreementIds: [...plans.keys()],
          resultingAmountsCents,
          versions,
          adjustments: input.adjustments,
          remoteProgress: input.remoteProgress,
          correlationId: input.correlationId,
        };
        const operation = await tx.billingChangeOperation.findFirst({
          where: { id: input.operationId, contaId: input.contaId },
          select: { uiRequestId: true },
        });
        if (!operation) throw new BillingAgreementError('LOCAL_COMMIT_CONFLICT', 'Operação financeira não encontrada.');
        result.uiRequestId = operation.uiRequestId;
        await tx.billingChangeOperation.updateMany({
          where: { id: input.operationId, contaId: input.contaId, status: { in: ['PROCESSING', 'REQUIRES_RECONCILIATION'] } },
          data: {
            status: 'COMPLETED',
            result: toJson(result),
            completedAt: new Date(),
            lockedAt: null,
            leaseExpiresAt: null,
            lastError: null,
          },
        });
        return result;
      });
    },

    async markOperationUncertain(input) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: input.operationId, contaId: input.contaId, status: { not: 'COMPLETED' } },
        data: {
          status: 'REQUIRES_RECONCILIATION',
          result: toJson({ remoteProgress: input.remoteProgress }),
          lastError: `${input.errorCode}: ${input.errorMessage}`.slice(0, 2000),
          lockedAt: null,
          leaseExpiresAt: null,
          availableAt: new Date(),
        },
      });
    },

    async markOperationFailed(input) {
      await prisma.billingChangeOperation.updateMany({
        where: { id: input.operationId, contaId: input.contaId, status: { not: 'COMPLETED' } },
        data: {
          status: 'FAILED',
          lastError: `${input.errorCode}: ${input.errorMessage}`.slice(0, 2000),
          lockedAt: null,
          leaseExpiresAt: null,
        },
      });
    },
  };
}
