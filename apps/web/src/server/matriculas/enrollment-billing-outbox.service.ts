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
import { updateSubscription } from '@alusa/finance';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type EnrollmentBillingOutboxResult = {
  eventId: string;
  matriculaId: string | null;
  status: 'PROCESSED' | 'FAILED' | 'SKIPPED' | 'REQUIRES_RECONCILIATION';
  error?: string;
};

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
}) {
  const matricula = await loadProvisionContext(defaultPrisma, {
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
    await defaultPrisma.matricula.update({
      where: { id: matricula.id },
      data: billingProvisionUpdate(MatriculaBillingProvisionStatus.NAO_APLICAVEL),
    });
    return { skipped: true as const, reason: 'SEM_COBRANCA_A_PROVISIONAR' };
  }

  await provisionIndividualEnrollmentBilling({
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

  return { skipped: false as const };
}

function toAsaasDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function computeEnrollmentNetAmount(db: PrismaLike, matriculaId: string) {
  const matricula = await db.matricula.findUnique({
    where: { id: matriculaId },
    select: {
      id: true,
      taxaMatricula: true,
      plano: { select: { valor: true } },
      combo: { select: { valor: true } },
      descontos: { include: { desconto: true } },
    },
  });
  if (!matricula) return 0;

  const baseAmount = Number(matricula.combo?.valor ?? matricula.plano?.valor ?? 0);
  const price = calcularPrecoMatricula({
    planoValor: baseAmount,
    taxaMatricula: Number(matricula.taxaMatricula ?? 0),
    descontos: matricula.descontos.map((item) => ({
      tipo: item.desconto.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
      valor: Number(item.desconto.valor),
      cumulativo: false,
    })),
  });
  return price.planoLiquido;
}

async function runExistingSubscriptionUpdate(input: {
  contaId: string;
  matriculaId: string;
  subscriptionTargetId: string;
  actorUserId: string;
}) {
  const [targetSubscription, newAmount, enrollmentFeeCharge] = await Promise.all([
    defaultPrisma.subscription.findFirst({
      where: { id: input.subscriptionTargetId, contaId: input.contaId },
      include: {
        matricula: {
          select: {
            id: true,
            formaPagamento: true,
            vencimentoDia: true,
            dataFimContrato: true,
            asaasSubscriptionId: true,
          },
        },
      },
    }),
    computeEnrollmentNetAmount(defaultPrisma, input.matriculaId),
    defaultPrisma.cobranca.findFirst({
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

  if (!targetSubscription?.asaasSubscriptionId) {
    throw new Error('ASSINATURA_DESTINO_NAO_PROVISIONADA');
  }

  const [currentAmount, activeAllocationTotal] = await Promise.all([
    computeEnrollmentNetAmount(defaultPrisma, targetSubscription.matriculaId),
    defaultPrisma.familyFinancialAllocation.aggregate({
      where: {
        contaId: input.contaId,
        sourceAgreementId: targetSubscription.id,
        chargeKind: 'MENSALIDADE',
        status: 'ACTIVE',
      },
      _sum: { amount: true },
    }),
  ]);
  const previousMergedAmount = Number(activeAllocationTotal._sum.amount ?? 0);
  const nextValue =
    Math.round((currentAmount + previousMergedAmount + newAmount + Number.EPSILON) * 100) / 100;

  await defaultPrisma.matricula.updateMany({
    where: { id: input.matriculaId, contaId: input.contaId },
    data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PROCESSANDO),
  });

  if (enrollmentFeeCharge && !enrollmentFeeCharge.asaasPaymentId) {
    const feeSync = await pushEnrollmentFeeToAsaas({
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

  await updateSubscription(
    targetSubscription.asaasSubscriptionId,
    {
      value: nextValue,
      updatePendingPayments: true,
      endDate: toAsaasDate(targetSubscription.matricula.dataFimContrato),
    },
    { contaId: input.contaId },
  );

  await defaultPrisma.$transaction(async (tx) => {
    await tx.familyFinancialAllocation.updateMany({
      where: {
        contaId: input.contaId,
        matriculaId: input.matriculaId,
        chargeKind: 'MENSALIDADE',
        status: 'PENDING',
      },
      data: {
        status: 'ACTIVE',
        sourceAgreementId: targetSubscription.id,
        metadata: {
          source: 'MATRICULA_INICIAL',
          subscriptionTargetId: targetSubscription.id,
          asaasSubscriptionId: targetSubscription.asaasSubscriptionId,
          updatePendingPayments: true,
          mergedValue: nextValue,
        } as Prisma.InputJsonValue,
      },
    });
    await tx.matricula.updateMany({
      where: { id: input.matriculaId, contaId: input.contaId },
      data: billingProvisionUpdate(MatriculaBillingProvisionStatus.PROVISIONADO),
    });
    await tx.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        action: 'BILLING_MERGED_INTO_EXISTING_SUBSCRIPTION',
        metadata: {
          subscriptionId: targetSubscription.id,
          asaasSubscriptionId: targetSubscription.asaasSubscriptionId,
          updatePendingPayments: true,
          mergedValue: nextValue,
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
  deps: { prisma?: PrismaClient; now?: Date } = {},
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
    const result =
      event.eventType === 'UPDATE_EXISTING_SUBSCRIPTION_BILLING' && subscriptionTargetId
          ? await runExistingSubscriptionUpdate({
            contaId: event.contaId,
            matriculaId,
            subscriptionTargetId,
            actorUserId,
          })
        : await runProvisionForEnrollment({
            contaId: event.contaId,
            matriculaId,
            actorUserId,
          });

    if ('requiresReconciliation' in result) {
      await db.matriculaBillingOutbox.update({
        where: { id: event.id },
        data: {
          status: MatriculaBillingOutboxStatus.REQUIRES_RECONCILIATION,
          lockedAt: null,
          leaseExpiresAt: null,
          lastError: result.reason,
        },
      });
      return { eventId: event.id, matriculaId, status: 'REQUIRES_RECONCILIATION' };
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
