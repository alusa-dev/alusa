import { Prisma, type PrismaClient } from '@prisma/client';
import { createStandaloneCharge } from '@alusa/finance';

import { createRenewalPending } from './renewal-governance.service';
import { mapPeriodicidadeToCycle } from './recurring-billing';

type JsonRecord = Record<string, unknown>;

type RenewalOutboxResult = {
  eventId: string;
  eventType: string;
  status: 'PROCESSED' | 'FAILED' | 'SKIPPED';
  error?: string;
};

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function mapPaymentMethodToAsaas(value?: string | null) {
  if (value === 'PIX') return 'PIX';
  if (value === 'CARTAO_CREDITO') return 'CREDIT_CARD';
  return 'BOLETO';
}

function payloadRecord(payload: Prisma.JsonValue): JsonRecord {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('PAYLOAD_OUTBOX_INVALIDO');
  }
  return payload as JsonRecord;
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readMoney(record: JsonRecord, key: string) {
  const value = Number(record[key] ?? 0);
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
}

function retryDate(now: Date, attempts: number) {
  const minutes = Math.min(12 * 60, Math.max(5, attempts * attempts * 5));
  return new Date(now.getTime() + minutes * 60 * 1000);
}

async function loadAgreement(
  prisma: PrismaClient,
  input: { contaId: string; acordoId?: string | null; processoId?: string | null },
) {
  return prisma.acordoFinanceiroFuturo.findFirst({
    where: {
      contaId: input.contaId,
      ...(input.acordoId ? { id: input.acordoId } : {}),
      ...(input.processoId ? { processoId: input.processoId } : {}),
    },
    include: {
      processo: {
        include: {
          itens: {
            include: {
              matriculaFutura: {
                select: {
                  id: true,
                  alunoId: true,
                  responsavelFinanceiroId: true,
                  formaPagamento: true,
                  formaPagamentoTaxa: true,
                  dataFimContrato: true,
                  vencimentoDia: true,
                  plano: { select: { periodicidade: true } },
                  combo: { select: { periodicidade: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

function resolvePayer(agreement: Awaited<ReturnType<typeof loadAgreement>>) {
  const renewedItems = agreement?.processo.itens.filter((item) => item.decision === 'RENEW') ?? [];
  const firstFuture = renewedItems.find((item) => item.matriculaFutura)?.matriculaFutura ?? null;
  if (!agreement || !firstFuture) return null;

  const responsavelId = agreement.responsavelId ?? firstFuture.responsavelFinanceiroId;
  if (responsavelId) {
    return {
      payer: { type: 'responsavel' as const, responsavelId },
      firstFuture,
      renewedItems,
    };
  }

  return {
    payer: { type: 'aluno' as const, alunoId: firstFuture.alunoId },
    firstFuture,
    renewedItems,
  };
}

async function markFinancialFailure(
  prisma: PrismaClient,
  input: {
    contaId: string;
    processoId: string;
    agreementId: string;
    code: string;
    message: string;
  },
) {
  await prisma.acordoFinanceiroFuturo.update({
    where: { id: input.agreementId },
    data: {
      status: 'FAILED',
      failureCode: input.code,
      failureMessage: input.message,
    },
  });

  await createRenewalPending(
    {
      contaId: input.contaId,
      processoId: input.processoId,
      type: 'FINANCIAL_PROVISION_FAILED',
      severity: 'BLOCKER',
      code: input.code,
      title: 'Pendência financeira do próximo ciclo',
      message: input.message,
      rule: 'future_financial_agreement',
      impact: 'A rematrícula acadêmica permanece confirmada, mas o financeiro futuro exige reprocessamento.',
      metadata: { agreementId: input.agreementId },
    },
    { prisma },
  );
}

async function handleFeeCharge(
  event: { id: string; contaId: string; processoId: string | null; payload: Prisma.JsonValue },
  prisma: PrismaClient,
  now: Date,
) {
  const payload = payloadRecord(event.payload);
  const agreement = await loadAgreement(prisma, {
    contaId: event.contaId,
    acordoId: readString(payload, 'acordoFinanceiroFuturoId'),
    processoId: event.processoId,
  });
  const payerContext = resolvePayer(agreement);
  const amount = readMoney(payload, 'amount') || Number(agreement?.enrollmentFeeTotal.toString() ?? 0);

  if (!agreement || !payerContext || amount <= 0) {
    return { skipped: true, reason: 'FEE_PRECONDITION_FAILED' };
  }

  if (agreement.asaasPaymentId) {
    return { skipped: true, reason: 'FEE_ALREADY_PROVISIONED' };
  }

  const result = await createStandaloneCharge({
    contaId: event.contaId,
    actor: { type: 'SYSTEM', id: 'RenewalOutbox' },
    payer: payerContext.payer,
    chargeType: 'ONE_TIME',
    billingType: mapPaymentMethodToAsaas(
      payerContext.firstFuture.formaPagamentoTaxa ?? payerContext.firstFuture.formaPagamento,
    ) as 'BOLETO' | 'PIX' | 'CREDIT_CARD',
    description: `Taxa de rematrícula - processo ${agreement.processoId}`,
    value: amount,
    dueDate: toDateKey(now),
    uiRequestId: `renewal-fee:${agreement.id}`,
  });

  if (!result.success) {
    await markFinancialFailure(prisma, {
      contaId: event.contaId,
      processoId: agreement.processoId,
      agreementId: agreement.id,
      code: 'RENEWAL_FEE_CHARGE_FAILED',
      message: `Falha ao criar taxa de rematrícula: ${result.error}`,
    });
    throw new Error(result.error);
  }

  await prisma.$transaction(async (tx) => {
    await tx.acordoFinanceiroFuturo.update({
      where: { id: agreement.id },
      data: {
        asaasPaymentId: result.data.asaasPaymentId ?? result.data.chargeId,
        failureCode: null,
        failureMessage: null,
      },
    });
    await tx.rematriculaAuditLog.create({
      data: {
        contaId: event.contaId,
        processoId: agreement.processoId,
        action: 'RENEWAL_FEE_CHARGE_CREATED',
        entityType: 'AcordoFinanceiroFuturo',
        entityId: agreement.id,
        metadata: {
          asaasPaymentId: result.data.asaasPaymentId ?? null,
          chargeId: result.data.chargeId,
          externalReference: result.data.externalReference,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { skipped: false };
}

async function handleFutureFinanceProvision(
  event: { id: string; contaId: string; processoId: string | null; payload: Prisma.JsonValue },
  prisma: PrismaClient,
) {
  const payload = payloadRecord(event.payload);
  const agreement = await loadAgreement(prisma, {
    contaId: event.contaId,
    acordoId: readString(payload, 'acordoFinanceiroFuturoId'),
    processoId: event.processoId,
  });
  const payerContext = resolvePayer(agreement);

  if (!agreement || !payerContext) {
    return { skipped: true, reason: 'PROVISION_PRECONDITION_FAILED' };
  }

  if (agreement.processo.status === 'CANCELLED' || agreement.status === 'CANCELLED') {
    return { skipped: true, reason: 'PROVISION_CANCELLED' };
  }

  if (agreement.asaasSubscriptionId && agreement.status === 'ACTIVE') {
    return { skipped: true, reason: 'PROVISION_ALREADY_ACTIVE' };
  }

  const monthlyTotal = Number(agreement.monthlyTotal.toString());
  if (monthlyTotal <= 0) {
    return { skipped: true, reason: 'PROVISION_ZERO_VALUE' };
  }

  const periodicidade = payerContext.firstFuture.combo?.periodicidade
    ?? payerContext.firstFuture.plano?.periodicidade;
  if (!periodicidade) {
    await markFinancialFailure(prisma, {
      contaId: event.contaId,
      processoId: agreement.processoId,
      agreementId: agreement.id,
      code: 'RENEWAL_BILLING_CYCLE_MISSING',
      message: 'Plano ou combo futuro não possui periodicidade financeira válida.',
    });
    throw new Error('RENEWAL_BILLING_CYCLE_MISSING');
  }

  await prisma.acordoFinanceiroFuturo.update({
    where: { id: agreement.id },
    data: { status: 'PROVISIONING', failureCode: null, failureMessage: null },
  });

  const result = await createStandaloneCharge({
    contaId: event.contaId,
    actor: { type: 'SYSTEM', id: 'RenewalOutbox' },
    payer: payerContext.payer,
    chargeType: 'SUBSCRIPTION',
    billingType: mapPaymentMethodToAsaas(payerContext.firstFuture.formaPagamento) as
      | 'BOLETO'
      | 'PIX'
      | 'CREDIT_CARD',
    description: `Mensalidade do próximo ciclo - rematrícula ${agreement.processoId}`,
    value: monthlyTotal,
    nextDueDate: toDateKey(agreement.firstDueDate ?? agreement.effectiveAt),
    endDate: toDateKey(payerContext.firstFuture.dataFimContrato),
    cycle: mapPeriodicidadeToCycle(periodicidade),
    uiRequestId: `renewal-future-finance:${agreement.id}`,
  });

  if (!result.success) {
    await markFinancialFailure(prisma, {
      contaId: event.contaId,
      processoId: agreement.processoId,
      agreementId: agreement.id,
      code: 'FUTURE_FINANCE_PROVISION_FAILED',
      message: `Falha ao provisionar mensalidade futura: ${result.error}`,
    });
    throw new Error(result.error);
  }

  await prisma.$transaction(async (tx) => {
    await tx.acordoFinanceiroFuturo.update({
      where: { id: agreement.id },
      data: {
        status: 'ACTIVE',
        asaasSubscriptionId: result.data.asaasSubscriptionId ?? result.data.chargeId,
        externalReference: result.data.externalReference,
        failureCode: null,
        failureMessage: null,
      },
    });
    await tx.matricula.updateMany({
      where: {
        contaId: event.contaId,
        id: {
          in: payerContext.renewedItems
            .map((item) => item.matriculaFuturaId)
            .filter((id): id is string => Boolean(id)),
        },
      },
      data: {
        billingProvisionStatus: 'PROVISIONADO',
        pendingAsaasSubscriptionId: result.data.asaasSubscriptionId ?? result.data.chargeId,
      },
    });
    await tx.rematriculaAuditLog.create({
      data: {
        contaId: event.contaId,
        processoId: agreement.processoId,
        action: 'FUTURE_FINANCE_PROVISIONED',
        entityType: 'AcordoFinanceiroFuturo',
        entityId: agreement.id,
        metadata: {
          asaasSubscriptionId: result.data.asaasSubscriptionId ?? null,
          chargeId: result.data.chargeId,
          externalReference: result.data.externalReference,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { skipped: false };
}

export async function enqueueFutureFinancialProvisioning(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
) {
  const now = input.now ?? new Date();
  const agreements = await deps.prisma.acordoFinanceiroFuturo.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['SCHEDULED', 'READY_TO_PROVISION', 'FAILED'] },
      provisionAt: { lte: now },
    },
    include: { processo: { select: { id: true, status: true } } },
    orderBy: { provisionAt: 'asc' },
    take: input.limit ?? 20,
  });

  const results: Array<{ acordoId: string; status: 'QUEUED' | 'SKIPPED' }> = [];

  for (const agreement of agreements) {
    if (agreement.processo.status === 'CANCELLED') {
      await deps.prisma.acordoFinanceiroFuturo.update({
        where: { id: agreement.id },
        data: { status: 'CANCELLED' },
      });
      results.push({ acordoId: agreement.id, status: 'SKIPPED' });
      continue;
    }

    const dedupeKey = `renewal-finance:${agreement.id}`;
    await deps.prisma.$transaction(async (tx) => {
      await tx.acordoFinanceiroFuturo.update({
        where: { id: agreement.id },
        data: { status: 'READY_TO_PROVISION' },
      });

      const existing = await tx.rematriculaOutbox.findFirst({
        where: {
          contaId: input.contaId,
          dedupeKey,
          status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
        },
        select: { id: true, status: true },
      });

      if (existing) {
        if (existing.status === 'FAILED') {
          await tx.rematriculaOutbox.update({
            where: { id: existing.id },
            data: { status: 'PENDING', availableAt: now, lastError: null },
          });
        }
        return;
      }

      await tx.rematriculaOutbox.create({
        data: {
          contaId: input.contaId,
          processoId: agreement.processoId,
          eventType: 'PROVISION_FUTURE_FINANCE',
          dedupeKey,
          availableAt: now,
          payload: {
            acordoFinanceiroFuturoId: agreement.id,
            processoId: agreement.processoId,
          } as Prisma.InputJsonValue,
        },
      });
    });

    results.push({ acordoId: agreement.id, status: 'QUEUED' });
  }

  return results;
}

export async function processRenewalOutbox(
  input: { contaId: string; now?: Date; limit?: number },
  deps: { prisma: PrismaClient },
) {
  const now = input.now ?? new Date();
  const events = await deps.prisma.rematriculaOutbox.findMany({
    where: {
      contaId: input.contaId,
      status: { in: ['PENDING', 'FAILED'] },
      availableAt: { lte: now },
      attempts: { lt: 8 },
    },
    orderBy: { availableAt: 'asc' },
    take: input.limit ?? 25,
  });

  const results: RenewalOutboxResult[] = [];

  for (const event of events) {
    const locked = await deps.prisma.rematriculaOutbox.updateMany({
      where: {
        id: event.id,
        contaId: input.contaId,
        status: event.status,
      },
      data: {
        status: 'PROCESSING',
        lockedAt: now,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (locked.count === 0) {
      results.push({ eventId: event.id, eventType: event.eventType, status: 'SKIPPED' });
      continue;
    }

    try {
      if (event.eventType === 'CREATE_RENEWAL_FEE_CHARGE') {
        await handleFeeCharge(event, deps.prisma, now);
      } else if (event.eventType === 'PROVISION_FUTURE_FINANCE') {
        await handleFutureFinanceProvision(event, deps.prisma);
      } else {
        throw new Error(`Evento de rematrícula não suportado: ${event.eventType}`);
      }

      await deps.prisma.rematriculaOutbox.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      results.push({ eventId: event.id, eventType: event.eventType, status: 'PROCESSED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao processar outbox.';
      const nextAttempts = event.attempts + 1;
      await deps.prisma.rematriculaOutbox.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          lockedAt: null,
          lastError: message,
          availableAt: retryDate(now, nextAttempts),
        },
      });
      results.push({
        eventId: event.id,
        eventType: event.eventType,
        status: 'FAILED',
        error: message,
      });
    }
  }

  return results;
}
