import {
  BillingMode,
  MatriculaBillingOutboxStatus,
  MatriculaBillingProvisionStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';

import { prisma as defaultPrisma } from '@/src/prisma';
import { calcularPrecoMatricula } from '@/src/server/matriculas/matricula.service';
import {
  provisionIndividualEnrollmentBilling,
  pushEnrollmentFeeToAsaas,
} from '@/src/server/matriculas/enrollment-billing.orchestrator';
import { billingProvisionUpdate } from './billing-provision-status';
import {
  commitBillingAgreementChange,
  getSubscription,
  materializeBillingAgreement,
  previewBillingAgreementChange,
  processPendingBillingAdjustments,
} from '@alusa/finance';
import {
  formatIsoDate,
  mapFormaPagamentoToBillingType,
  mapPeriodicidadeToCycle,
  resolveChargeableFirstDueDate,
} from './recurring-billing';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type EnrollmentBillingOutboxResult = {
  eventId: string;
  matriculaId: string | null;
  status: 'PROCESSED' | 'FAILED' | 'SKIPPED' | 'REQUIRES_RECONCILIATION';
  error?: string;
};

type ProvisionEnrollmentBilling = typeof provisionIndividualEnrollmentBilling;

function retryDate(now: Date, attempts: number) {
  const minutes = Math.min(12 * 60, Math.max(5, attempts * attempts * 5));
  return new Date(now.getTime() + minutes * 60 * 1000);
}

function buildEnrollmentBillingDedupeKey(matriculaId: string) {
  return `enrollment-billing:${matriculaId}`;
}

function buildSubscriptionMergeDedupeKey(input: { subscriptionTargetId: string; matriculaId: string }) {
  return `enrollment-subscription-update:${input.subscriptionTargetId}:${input.matriculaId}`;
}

function isUncertainFinancialResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|econnreset|etimedout|eai_again|socket hang up|network|fetch failed|und_err_connect_timeout|resultado_incerto/i.test(
    message,
  );
}

export function resolveEnrollmentMergeEffectivePolicy(
  billingStrategy?: { kind?: string } | null,
) {
  return billingStrategy?.kind === 'SCHEDULE_NEXT_CYCLE_UNIFICATION'
    ? ('NEXT_CYCLE' as const)
    : ('CURRENT_CYCLE_FULL' as const);
}

async function loadProvisionContext(db: PrismaLike, input: { contaId: string; matriculaId: string }) {
  return db.matricula.findFirst({
    where: {
      id: input.matriculaId,
      contaId: input.contaId,
      billingMode: BillingMode.INDIVIDUAL,
    },
    include: {
      cobrancas: {
        where: { tipo: 'TAXA_MATRICULA' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
      descontos: { include: { desconto: true } },
      plano: { select: { valor: true } },
      combo: { select: { valor: true } },
    },
  });
}

async function runProvisionForEnrollment(input: {
  contaId: string;
  matriculaId: string;
  actorUserId: string;
}, deps: {
  prisma: PrismaClient;
  provisionEnrollmentBilling: ProvisionEnrollmentBilling;
}) {
  const matricula = await loadProvisionContext(deps.prisma, {
    contaId: input.contaId,
    matriculaId: input.matriculaId,
  });

  if (!matricula) {
    return { skipped: true as const, reason: 'MATRICULA_NAO_ENCONTRADA_OU_NAO_INDIVIDUAL' };
  }

  if (
    matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.NAO_APLICAVEL ||
    matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.PROVISIONADO ||
    matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.CANCELADO
  ) {
    return { skipped: true as const, reason: `STATUS_${matricula.billingProvisionStatus}` };
  }

  if (matricula.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO) {
    return { requiresReconciliation: true as const, reason: 'RESULTADO_INCERTO' };
  }

  const planoValor = matricula.combo
    ? Number(matricula.combo.valor)
    : matricula.plano
      ? Number(matricula.plano.valor)
      : Number(matricula.taxaMatricula);

  const preco = calcularPrecoMatricula({
    planoValor,
    taxaMatricula: Number(matricula.taxaMatricula),
    descontos: matricula.descontos.map((item) => ({
      tipo: item.desconto.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
      valor: Number(item.desconto.valor),
      cumulativo: false,
    })),
  });

  const gerarCobrancaTaxa =
    !matricula.taxaIsenta && Number(matricula.taxaMatricula) > 0 && Boolean(matricula.cobrancas[0]);
  const criarCobranca = preco.planoLiquido > 0;

  if (!gerarCobrancaTaxa && !criarCobranca) {
    await deps.prisma.matricula.updateMany({
      where: { id: matricula.id, contaId: input.contaId },
      data: billingProvisionUpdate(MatriculaBillingProvisionStatus.NAO_APLICAVEL),
    });
    return { skipped: true as const, reason: 'SEM_COBRANCA_A_PROVISIONAR' };
  }

  await deps.provisionEnrollmentBilling({
    contaId: matricula.contaId,
    actorUserId: input.actorUserId,
    matriculaId: matricula.id,
    payload: {
      criarCobranca,
      gerarCobrancaTaxa,
      taxaIsenta: matricula.taxaIsenta,
    },
    preco,
    cobrancas: {
      taxa: matricula.cobrancas[0]
        ? {
            id: matricula.cobrancas[0].id,
            formaPagamento: matricula.cobrancas[0].formaPagamento,
            asaasPaymentId: matricula.cobrancas[0].asaasPaymentId,
          }
        : null,
      mensalidade: null,
    },
    matriculaSnapshot: {
      asaasSubscriptionId: matricula.asaasSubscriptionId,
    },
  });

  const completion = await deps.prisma.matricula.findFirst({
    where: { id: matricula.id, contaId: matricula.contaId },
    select: {
      billingProvisionStatus: true,
      billingProvisionError: true,
    },
  });

  if (!completion) {
    return {
      retryableFailure: true as const,
      reason: 'MATRICULA_NAO_ENCONTRADA_APOS_PROVISIONAMENTO',
    };
  }

  if (completion.billingProvisionStatus === MatriculaBillingProvisionStatus.RESULTADO_INCERTO) {
    return {
      requiresReconciliation: true as const,
      reason: completion.billingProvisionError ?? 'RESULTADO_INCERTO',
    };
  }

  if (
    completion.billingProvisionStatus !== MatriculaBillingProvisionStatus.PROVISIONADO &&
    completion.billingProvisionStatus !== MatriculaBillingProvisionStatus.NAO_APLICAVEL
  ) {
    return {
      retryableFailure: true as const,
      reason: [
        'BILLING_PROVISION_INCOMPLETE',
        completion.billingProvisionStatus,
        completion.billingProvisionError,
      ]
        .filter(Boolean)
        .join(':'),
    };
  }

  return { skipped: false as const };
}

function exclusiveDayAfter(date: Date) {
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 1);
  return formatIsoDate(end);
}

async function runExistingSubscriptionUpdate(input: {
  contaId: string;
  matriculaId: string;
  subscriptionTargetId: string;
  actorUserId: string;
  billingStrategy?: { kind?: string; effectiveAt?: string } | null;
}, deps: {
  prisma: PrismaClient;
  previewChange: typeof previewBillingAgreementChange;
  commitChange: typeof commitBillingAgreementChange;
  processAdjustments: typeof processPendingBillingAdjustments;
  getRemoteSubscription: typeof getSubscription;
  materializeAgreement: typeof materializeBillingAgreement;
  pushEnrollmentFee: typeof pushEnrollmentFeeToAsaas;
}) {
  const [targetSubscription, enrollment, allocations, enrollmentFeeCharge] = await Promise.all([
    deps.prisma.subscription.findFirst({
      where: { id: input.subscriptionTargetId, contaId: input.contaId },
      include: {
        billingAgreement: true,
        matricula: {
          select: {
            id: true,
            dataInicio: true,
            formaPagamento: true,
            vencimentoDia: true,
            dataFimContrato: true,
            asaasSubscriptionId: true,
            plano: { select: { periodicidade: true } },
            combo: { select: { periodicidade: true } },
          },
        },
      },
    }),
    deps.prisma.matricula.findFirst({
      where: { id: input.matriculaId, contaId: input.contaId },
      select: { id: true, alunoId: true, dataInicio: true, dataFimContrato: true },
    }),
    deps.prisma.familyFinancialAllocation.findMany({
      where: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        status: { in: ['PENDING', 'ACTIVE'] },
      },
      orderBy: { createdAt: 'asc' },
    }),
    deps.prisma.cobranca.findFirst({
      where: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        tipo: 'TAXA_MATRICULA',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        formaPagamento: true,
        asaasPaymentId: true,
      },
    }),
  ]);

  if (!targetSubscription?.asaasSubscriptionId || !enrollment) {
    throw new Error('ASSINATURA_DESTINO_NAO_PROVISIONADA');
  }
  const tuition = allocations.find((item) => item.chargeKind === 'MENSALIDADE');
  if (!tuition) throw new Error('ALOCACAO_MENSALIDADE_NAO_ENCONTRADA');

  const remoteBefore = await deps.getRemoteSubscription(targetSubscription.asaasSubscriptionId, {
    contaId: input.contaId,
  });
  const remoteValueBefore = Number(remoteBefore.value);

  await deps.prisma.matricula.updateMany({
    where: { id: input.matriculaId, contaId: input.contaId },
    data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PROCESSANDO),
  });

  if (enrollmentFeeCharge && !enrollmentFeeCharge.asaasPaymentId) {
    const feeSync = await deps.pushEnrollmentFee({
      contaId: input.contaId,
      actorUserId: input.actorUserId,
      matriculaId: input.matriculaId,
      cobrancaTaxa: {
        id: enrollmentFeeCharge.id,
        formaPagamento: enrollmentFeeCharge.formaPagamento,
        asaasPaymentId: enrollmentFeeCharge.asaasPaymentId,
      },
    });

    if (!feeSync.success) {
      throw new Error(`TAXA_MATRICULA_NAO_CONFIRMADA:${feeSync.error ?? 'ERRO_TAXA'}`);
    }
  }

  const billingType =
    targetSubscription.billingAgreement?.billingType ??
    mapFormaPagamentoToBillingType(targetSubscription.matricula.formaPagamento);
  const periodicidade =
    targetSubscription.matricula.combo?.periodicidade ??
    targetSubscription.matricula.plano?.periodicidade;
  if (!billingType || !periodicidade) {
    throw new Error('DADOS_CANONICOS_DA_ASSINATURA_DESTINO_INCOMPLETOS');
  }
  const agreement = await deps.materializeAgreement({
    kind: 'INDIVIDUAL',
    contaId: input.contaId,
    subscriptionId: targetSubscription.id,
    actorId: input.actorUserId,
    value: remoteValueBefore,
    billingType,
    cycle: targetSubscription.billingAgreement?.cycle ?? mapPeriodicidadeToCycle(periodicidade),
    nextDueDate: targetSubscription.billingAgreement?.nextDueDate
      ? formatIsoDate(targetSubscription.billingAgreement.nextDueDate)
      : formatIsoDate(
          resolveChargeableFirstDueDate(
            targetSubscription.matricula.dataInicio,
            targetSubscription.matricula.vencimentoDia,
          ),
        ),
    validUntil: formatIsoDate(targetSubscription.matricula.dataFimContrato),
    terms: targetSubscription.billingAgreement
      ? {
          interestValue: targetSubscription.billingAgreement.interestValue
            ? Number(targetSubscription.billingAgreement.interestValue)
            : null,
          interestType: targetSubscription.billingAgreement.interestType,
          fineValue: targetSubscription.billingAgreement.fineValue
            ? Number(targetSubscription.billingAgreement.fineValue)
            : null,
          fineType: targetSubscription.billingAgreement.fineType,
          discountValue: targetSubscription.billingAgreement.discountValue
            ? Number(targetSubscription.billingAgreement.discountValue)
            : null,
          discountType: targetSubscription.billingAgreement.discountType,
          discountDueDateLimitDays:
            targetSubscription.billingAgreement.discountDueDateLimitDays,
        }
      : undefined,
  });

  const effectivePolicy = resolveEnrollmentMergeEffectivePolicy(input.billingStrategy);
  const effectiveDate = formatIsoDate(
    input.billingStrategy?.effectiveAt
      ? new Date(input.billingStrategy.effectiveAt)
      : enrollment.dataInicio,
  );
  const uiRequestId = `enrollment-merge:${input.subscriptionTargetId}:${input.matriculaId}`;
  const completedOperation = await deps.prisma.billingChangeOperation.findFirst({
    where: { contaId: input.contaId, uiRequestId, status: 'COMPLETED' },
    select: { id: true },
  });
  const drafts = allocations.map((allocation) => ({
    clientId: allocation.id,
    enrollmentId: enrollment.id,
    studentId: enrollment.alunoId,
    kind: allocation.chargeKind === 'MENSALIDADE'
      ? ('TUITION' as const)
      : ('ENROLLMENT_FEE' as const),
    recurring: allocation.chargeKind === 'MENSALIDADE',
    baseAmountCents: Math.round(Number(allocation.baseAmount ?? allocation.amount) * 100),
    discountAmountCents: Math.round(Number(allocation.discountAmount ?? 0) * 100),
    netAmountCents: Math.round(Number(allocation.amount) * 100),
    validFrom: formatIsoDate(allocation.competenceStart),
    validUntil: allocation.chargeKind === 'MENSALIDADE'
      ? exclusiveDayAfter(allocation.competenceEnd ?? enrollment.dataFimContrato)
      : exclusiveDayAfter(allocation.competenceStart),
    prorationPolicy: allocation.chargeKind === 'MENSALIDADE'
      ? (effectivePolicy === 'NEXT_CYCLE' ? ('NEXT_CYCLE' as const) : ('FULL_CURRENT_CYCLE' as const))
      : ('MANUAL' as const),
  }));
  const change = {
    contaId: input.contaId,
    agreementId: agreement.id,
    actorId: input.actorUserId,
    reason: `Inclusão da matrícula ${input.matriculaId} em cobrança existente`,
    kind: 'ADD_ALLOCATION' as const,
    effectivePolicy,
    effectiveDate,
    allocations: drafts,
  };
  let operationId = completedOperation?.id ?? null;
  if (!operationId) {
    const preview = await deps.previewChange(change);
    if (preview.blockers.length > 0) {
      return { requiresReconciliation: true as const, reason: `BILLING_PREVIEW_BLOCKED:${preview.blockers.join('|')}` };
    }
    if (preview.adjustments.some((adjustment) => adjustment.type === 'MANUAL_REVIEW')) {
      return { requiresReconciliation: true as const, reason: 'CURRENT_CYCLE_REQUIRES_MANUAL_REVIEW' };
    }
    const result = await deps.commitChange({
      ...change,
      uiRequestId,
      previewHash: preview.previewHash,
      previewExpiresAt: preview.expiresAt,
      expectedAgreementVersion: preview.sourceVersion,
    });
    if (result.status === 'REQUIRES_RECONCILIATION') {
      return { requiresReconciliation: true as const, reason: `BILLING_OPERATION_UNCERTAIN:${result.operationId}` };
    }
    operationId = result.operationId;
  }

  const pendingAdjustment = await deps.prisma.billingAdjustment.findFirst({
    where: { contaId: input.contaId, operationId, status: { not: 'APPLIED' } },
    select: { id: true },
  });
  if (pendingAdjustment) {
    await deps.processAdjustments({ contaId: input.contaId, operationId });
    const unresolved = await deps.prisma.billingAdjustment.findFirst({
      where: {
        contaId: input.contaId,
        operationId,
        status: { not: 'APPLIED' },
      },
      select: { id: true, status: true, lastError: true },
    });
    if (unresolved) {
      if (unresolved.status === 'PENDING' || unresolved.status === 'FAILED' || unresolved.status === 'PROCESSING') {
        return {
          retryableFailure: true as const,
          reason: `BILLING_ADJUSTMENT_RETRY_PENDING:${unresolved.status}:${unresolved.lastError ?? unresolved.id}`,
        };
      }
      return {
        requiresReconciliation: true as const,
        reason: `BILLING_ADJUSTMENT_UNRESOLVED:${unresolved.status}:${unresolved.lastError ?? unresolved.id}`,
      };
    }
  }

  const canonicalAllocations = await deps.prisma.billingAllocation.findMany({
    where: { contaId: input.contaId, agreementId: agreement.id, sourceOperationId: operationId },
    select: { id: true, kind: true },
  });
  const expectedKinds = allocations.map((allocation) =>
    allocation.chargeKind === 'MENSALIDADE' ? 'TUITION' : 'ENROLLMENT_FEE',
  );
  const hasCompleteCanonicalProjection =
    canonicalAllocations.length === expectedKinds.length &&
    expectedKinds.every(
      (kind) => canonicalAllocations.filter((allocation) => allocation.kind === kind).length === 1,
    );
  if (!hasCompleteCanonicalProjection) {
    return {
      requiresReconciliation: true as const,
      reason: `CANONICAL_ALLOCATION_PROJECTION_INCOMPLETE:${operationId}`,
    };
  }
  await deps.prisma.$transaction(async (tx) => {
    for (const allocation of allocations) {
      const kind = allocation.chargeKind === 'MENSALIDADE' ? 'TUITION' : 'ENROLLMENT_FEE';
      const canonical = canonicalAllocations.find((item) => item.kind === kind);
      await tx.familyFinancialAllocation.updateMany({
        where: { id: allocation.id, contaId: input.contaId, matriculaId: input.matriculaId },
        data: {
          status: effectivePolicy === 'NEXT_CYCLE' ? 'SCHEDULED' : 'ACTIVE',
          sourceAgreementId: agreement.id,
          billingAllocationId: canonical!.id,
          metadata: {
            source: 'MATRICULA_INICIAL_CANONICAL',
            subscriptionTargetId: targetSubscription.id,
            billingAgreementId: agreement.id,
            billingOperationId: operationId,
            effectivePolicy,
            remoteValueBefore,
          } as Prisma.InputJsonValue,
        },
      });
    }
    const [account, enrollment] = await Promise.all([
      tx.conta.findFirst({
        where: { id: input.contaId },
        select: { matriculaActivationPolicy: true },
      }),
      tx.matricula.findFirst({
        where: { id: input.matriculaId, contaId: input.contaId },
        select: { status: true, taxaIsenta: true, taxaMatricula: true },
      }),
    ]);
    const activationStatus =
      account?.matriculaActivationPolicy === 'REQUIRES_PAYMENT' &&
      enrollment &&
      !enrollment.taxaIsenta &&
      Number(enrollment.taxaMatricula) > 0
        ? ('PENDENTE_TAXA' as const)
        : ('ATIVA' as const);

    await tx.matricula.updateMany({
      where: { id: input.matriculaId, contaId: input.contaId },
      data: {
        ...billingProvisionUpdate(MatriculaBillingProvisionStatus.PROVISIONADO),
        ...(enrollment?.status === 'AGUARDANDO_CONFIRMACAO'
          ? { status: activationStatus }
          : {}),
      },
    });
    await tx.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        action: 'BILLING_ALLOCATION_ADDED_TO_CANONICAL_AGREEMENT',
        metadata: {
          subscriptionId: targetSubscription.id,
          billingAgreementId: agreement.id,
          billingOperationId: operationId,
          effectivePolicy,
          recoveredCompletedOperation: Boolean(completedOperation),
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { skipped: false as const };
}

export async function enqueueEnrollmentBillingOutbox(
  input: {
    contaId: string;
    matriculaId: string;
    actorUserId: string;
    availableAt?: Date;
  },
  deps: { prisma?: PrismaLike } = {},
) {
  const db = deps.prisma ?? defaultPrisma;
  const dedupeKey = buildEnrollmentBillingDedupeKey(input.matriculaId);
  const existing = await db.matriculaBillingOutbox.findFirst({
    where: {
      contaId: input.contaId,
      dedupeKey,
      status: {
        in: [
          MatriculaBillingOutboxStatus.PENDING,
          MatriculaBillingOutboxStatus.PROCESSING,
          MatriculaBillingOutboxStatus.FAILED,
          MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
        ],
      },
    },
  });
  if (existing) return existing;

  try {
    return await db.matriculaBillingOutbox.create({
      data: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        aggregateType: 'MATRICULA',
        aggregateId: input.matriculaId,
        eventType: 'PROVISION_ENROLLMENT_BILLING',
        dedupeKey,
        idempotencyKey: dedupeKey,
        externalReference: `matricula:${input.matriculaId}:billing`,
        correlationId: dedupeKey,
        availableAt: input.availableAt ?? new Date(),
        payload: {
          matriculaId: input.matriculaId,
          actorUserId: input.actorUserId,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      const raced = await db.matriculaBillingOutbox.findFirst({
        where: { contaId: input.contaId, dedupeKey },
      });
      if (
        raced?.status === MatriculaBillingOutboxStatus.PROCESSED &&
        raced.matriculaId === input.matriculaId
      ) {
        const incompleteEnrollment = await db.matricula.findFirst({
          where: {
            id: input.matriculaId,
            contaId: input.contaId,
            billingProvisionStatus: {
              in: [
                MatriculaBillingProvisionStatus.PENDENTE,
                MatriculaBillingProvisionStatus.PROCESSANDO,
                MatriculaBillingProvisionStatus.PARCIAL,
                MatriculaBillingProvisionStatus.FALHO,
              ],
            },
          },
          select: { id: true },
        });
        if (!incompleteEnrollment) return raced;

        await db.matriculaBillingOutbox.updateMany({
          where: {
            id: raced.id,
            contaId: input.contaId,
            status: MatriculaBillingOutboxStatus.PROCESSED,
          },
          data: {
            status: MatriculaBillingOutboxStatus.PENDING,
            attempts: 0,
            availableAt: input.availableAt ?? new Date(),
            lockedAt: null,
            leaseExpiresAt: null,
            processedAt: null,
            lastError: 'REABERTO_PARA_RECONCILIAR_PROVISIONAMENTO_INCOMPLETO',
            payload: {
              matriculaId: input.matriculaId,
              actorUserId: input.actorUserId,
            } as Prisma.InputJsonValue,
          },
        });
        const reopened = await db.matriculaBillingOutbox.findFirst({
          where: { contaId: input.contaId, dedupeKey },
        });
        if (reopened) return reopened;
      }
      if (raced) return raced;
    }
    throw error;
  }
}

export async function enqueueEnrollmentSubscriptionMergeOutbox(
  input: {
    contaId: string;
    matriculaId: string;
    subscriptionTargetId: string;
    actorUserId: string;
    availableAt?: Date;
  },
  deps: { prisma?: PrismaLike } = {},
) {
  const db = deps.prisma ?? defaultPrisma;
  const dedupeKey = buildSubscriptionMergeDedupeKey({
    subscriptionTargetId: input.subscriptionTargetId,
    matriculaId: input.matriculaId,
  });
  const existing = await db.matriculaBillingOutbox.findFirst({
    where: {
      contaId: input.contaId,
      dedupeKey,
      status: {
        in: [
          MatriculaBillingOutboxStatus.PENDING,
          MatriculaBillingOutboxStatus.PROCESSING,
          MatriculaBillingOutboxStatus.FAILED,
          MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
        ],
      },
    },
  });
  if (existing) return existing;

  try {
    return await db.matriculaBillingOutbox.create({
      data: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        aggregateType: 'MATRICULA',
        aggregateId: input.matriculaId,
        eventType: 'UPDATE_EXISTING_SUBSCRIPTION_BILLING',
        dedupeKey,
        idempotencyKey: dedupeKey,
        externalReference: `matricula:${input.matriculaId}:billing`,
        correlationId: dedupeKey,
        availableAt: input.availableAt ?? new Date(),
        payload: {
          matriculaId: input.matriculaId,
          actorUserId: input.actorUserId,
          subscriptionTargetId: input.subscriptionTargetId,
          billingStrategy: {
            kind: 'JOIN_EXISTING_CURRENT_CYCLE',
            financialGroupId: `subscription:${input.subscriptionTargetId}`,
          },
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      const raced = await db.matriculaBillingOutbox.findFirst({
        where: { contaId: input.contaId, dedupeKey },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function processEnrollmentBillingOutboxEvent(
  eventId: string,
  deps: {
    prisma?: PrismaClient;
    now?: Date;
    provisionEnrollmentBilling?: ProvisionEnrollmentBilling;
    previewBillingAgreementChange?: typeof previewBillingAgreementChange;
    commitBillingAgreementChange?: typeof commitBillingAgreementChange;
    processPendingBillingAdjustments?: typeof processPendingBillingAdjustments;
    getSubscription?: typeof getSubscription;
    materializeBillingAgreement?: typeof materializeBillingAgreement;
    pushEnrollmentFeeToAsaas?: typeof pushEnrollmentFeeToAsaas;
  } = {},
): Promise<EnrollmentBillingOutboxResult> {
  const db = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();
  const event = await db.matriculaBillingOutbox.findUnique({ where: { id: eventId } });

  if (!event || event.status === MatriculaBillingOutboxStatus.PROCESSED) {
    return { eventId, matriculaId: null, status: 'SKIPPED' };
  }

  if (event.status === MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION) {
    return { eventId, matriculaId: event.matriculaId, status: 'REQUIRES_RECONCILIATION' };
  }

  const locked = await db.matriculaBillingOutbox.updateMany({
    where: {
      id: event.id,
      OR: [
        {
          status: {
            in: [MatriculaBillingOutboxStatus.PENDING, MatriculaBillingOutboxStatus.FAILED],
          },
        },
        {
          status: MatriculaBillingOutboxStatus.PROCESSING,
          leaseExpiresAt: { lte: now },
        },
      ],
    },
    data: {
      status: MatriculaBillingOutboxStatus.PROCESSING,
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      lastAttemptAt: now,
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (locked.count === 0) {
    return { eventId: event.id, matriculaId: event.matriculaId, status: 'SKIPPED' };
  }

  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const matriculaId =
    typeof payload.matriculaId === 'string' && payload.matriculaId.trim()
      ? payload.matriculaId.trim()
      : event.matriculaId;
  const actorUserId =
    typeof payload.actorUserId === 'string' && payload.actorUserId.trim()
      ? payload.actorUserId.trim()
      : 'enrollment-billing-outbox';

  if (!matriculaId) {
    const message = 'Evento de provisionamento sem matrícula vinculada.';
    await db.matriculaBillingOutbox.update({
      where: { id: event.id },
      data: {
        status: MatriculaBillingOutboxStatus.FAILED,
        lockedAt: null,
        leaseExpiresAt: null,
        lastError: message,
        availableAt: retryDate(now, event.attempts + 1),
      },
    });
    return { eventId: event.id, matriculaId: null, status: 'FAILED', error: message };
  }

  try {
    const subscriptionTargetId =
      typeof payload.subscriptionTargetId === 'string' && payload.subscriptionTargetId.trim()
        ? payload.subscriptionTargetId.trim()
        : null;
    const billingStrategy =
      payload.billingStrategy && typeof payload.billingStrategy === 'object' && !Array.isArray(payload.billingStrategy)
        ? payload.billingStrategy as { kind?: string; effectiveAt?: string }
        : null;
    const result =
      event.eventType === 'UPDATE_EXISTING_SUBSCRIPTION_BILLING' && subscriptionTargetId
          ? await runExistingSubscriptionUpdate({
            contaId: event.contaId,
            matriculaId,
            subscriptionTargetId,
            actorUserId,
            billingStrategy,
          }, {
            prisma: db,
            previewChange: deps.previewBillingAgreementChange ?? previewBillingAgreementChange,
            commitChange: deps.commitBillingAgreementChange ?? commitBillingAgreementChange,
            processAdjustments:
              deps.processPendingBillingAdjustments ?? processPendingBillingAdjustments,
            getRemoteSubscription: deps.getSubscription ?? getSubscription,
            materializeAgreement: deps.materializeBillingAgreement ?? materializeBillingAgreement,
            pushEnrollmentFee: deps.pushEnrollmentFeeToAsaas ?? pushEnrollmentFeeToAsaas,
          })
        : await runProvisionForEnrollment({
            contaId: event.contaId,
            matriculaId,
            actorUserId,
          }, {
            prisma: db,
            provisionEnrollmentBilling:
              deps.provisionEnrollmentBilling ?? provisionIndividualEnrollmentBilling,
          });

    if ('requiresReconciliation' in result) {
      const reason = result.reason ?? 'REQUIRES_RECONCILIATION';
      await db.$transaction(async (tx) => {
        await tx.matriculaBillingOutbox.update({
          where: { id: event.id },
          data: {
            status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
            lockedAt: null,
            leaseExpiresAt: null,
            lastError: reason,
          },
        });
        await tx.matricula.updateMany({
          where: { id: matriculaId, contaId: event.contaId },
          data: billingProvisionUpdate(
            MatriculaBillingProvisionStatus.PARCIAL,
            reason.slice(0, 2000),
          ),
        });
        await tx.matriculaLog.create({
          data: {
            matriculaId,
            action: 'BILLING_PROVISION_REQUIRES_RECONCILIATION',
            metadata: { eventId: event.id, reason } as Prisma.InputJsonValue,
          },
        });
      });
      return { eventId: event.id, matriculaId, status: 'REQUIRES_RECONCILIATION' };
    }

    if ('retryableFailure' in result) {
      const reason = (result.reason ?? 'BILLING_RETRY_PENDING').slice(0, 2000);
      await db.$transaction(async (tx) => {
        await tx.matriculaBillingOutbox.update({
          where: { id: event.id },
          data: {
            status: MatriculaBillingOutboxStatus.FAILED,
            lockedAt: null,
            leaseExpiresAt: null,
            lastError: reason,
            availableAt: retryDate(now, event.attempts + 1),
          },
        });
        await tx.matriculaLog.create({
          data: {
            matriculaId,
            action: 'BILLING_PROVISION_INCOMPLETE_RETRY_SCHEDULED',
            metadata: {
              eventId: event.id,
              correlationId: event.correlationId,
              error: reason,
            } as Prisma.InputJsonValue,
          },
        });
      });

      return {
        eventId: event.id,
        matriculaId,
        status: 'FAILED',
        error: reason,
      };
    }

    await db.matriculaBillingOutbox.update({
      where: { id: event.id },
      data: {
        status: MatriculaBillingOutboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedAt: null,
        leaseExpiresAt: null,
        lastError: result.skipped ? result.reason : null,
      },
    });

    return { eventId: event.id, matriculaId, status: 'PROCESSED' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const uncertain = isUncertainFinancialResult(error);

    await db.$transaction(async (tx) => {
      await tx.matriculaBillingOutbox.update({
        where: { id: event.id },
        data: {
          status: uncertain
            ? MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION
            : MatriculaBillingOutboxStatus.FAILED,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: message.slice(0, 2000),
          availableAt: uncertain ? event.availableAt : retryDate(now, event.attempts + 1),
        },
      });

      if (uncertain) {
        await tx.matricula.updateMany({
          where: { id: matriculaId, contaId: event.contaId },
          data: billingProvisionUpdate(
            MatriculaBillingProvisionStatus.RESULTADO_INCERTO,
            message.slice(0, 2000),
          ),
        });
        await tx.matriculaLog.create({
          data: {
            matriculaId,
            action: 'BILLING_PROVISION_RESULTADO_INCERTO',
            metadata: {
              eventId: event.id,
              error: message,
              reason:
                'A resposta do serviço financeiro foi perdida ou expirou. Reconciliar antes de reenfileirar.',
            } as Prisma.InputJsonValue,
          },
        });
      } else {
        await tx.matricula.updateMany({
          where: { id: matriculaId, contaId: event.contaId },
          data: billingProvisionUpdate(
            MatriculaBillingProvisionStatus.FALHO,
            message.slice(0, 2000),
          ),
        });
        await tx.matriculaLog.create({
          data: {
            matriculaId,
            action: 'BILLING_PROVISION_FAILED',
            metadata: {
              eventId: event.id,
              error: message,
            } as Prisma.InputJsonValue,
          },
        });
      }
    });

    return {
      eventId: event.id,
      matriculaId,
      status: uncertain ? 'REQUIRES_RECONCILIATION' : 'FAILED',
      error: message,
    };
  }
}

export async function processEnrollmentBillingOutboxBatch(
  input: { contaId?: string; limit?: number; now?: Date } = {},
  deps: { prisma?: PrismaClient } = {},
) {
  const db = deps.prisma ?? defaultPrisma;
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const now = input.now ?? new Date();
  const events = await db.matriculaBillingOutbox.findMany({
    where: {
      OR: [
        {
          status: {
            in: [MatriculaBillingOutboxStatus.PENDING, MatriculaBillingOutboxStatus.FAILED],
          },
          availableAt: { lte: now },
        },
        {
          status: MatriculaBillingOutboxStatus.PROCESSING,
          leaseExpiresAt: { lte: now },
        },
      ],
      attempts: { lt: 8 },
      ...(input.contaId ? { contaId: input.contaId } : {}),
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });

  const results: EnrollmentBillingOutboxResult[] = [];
  for (const event of events) {
    results.push(await processEnrollmentBillingOutboxEvent(event.id, { prisma: db, now }));
  }

  return {
    attempted: results.length,
    processed: results.filter((result) => result.status === 'PROCESSED').length,
    failed: results.filter((result) => result.status === 'FAILED').length,
    requiresReconciliation: results.filter((result) => result.status === 'REQUIRES_RECONCILIATION')
      .length,
    skipped: results.filter((result) => result.status === 'SKIPPED').length,
    results,
  };
}
