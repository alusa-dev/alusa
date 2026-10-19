import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type StoreSaleRefundAttemptStatus } from '@prisma/client';
import { prisma } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';
import { readPaymentFullPreflight } from './payment-command-preflight';

export type StoreSaleRefundDispatchInput = {
  contaId: string;
  actorId: string;
  role?: string;
  chargeId: string;
  correlationId: string;
  returnId: string;
  attemptId: string;
  value?: number;
  description: string;
};

export type StoreSaleRefundDispatch = (input: StoreSaleRefundDispatchInput) => Promise<{
  status: number;
  body: unknown;
}>;

export class StoreSaleRefundError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
    this.name = 'StoreSaleRefundError';
  }
}

type Input = {
  contaId: string;
  saleId: string;
  returnId: string;
  actorId: string;
  role?: string;
  mode: 'REQUEST' | 'RETRY_DENIED';
  dispatch: StoreSaleRefundDispatch;
};

async function withTenant<T>(contaId: string, callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_conta_id', ${contaId}, true)`;
    return callback(tx);
  });
}

function findExactChargeSubset<T extends { value: unknown }>(charges: T[], targetAmount: number): T[] | undefined {
  const target = Math.round(targetAmount * 100);
  const sums = new Map<number, number[]>();
  sums.set(0, []);
  charges.forEach((charge, index) => {
    const cents = Math.round(Number(charge.value ?? 0) * 100);
    for (const [sum, indexes] of [...sums.entries()]) {
      if (sum + cents <= target && !sums.has(sum + cents)) sums.set(sum + cents, [...indexes, index]);
    }
  });
  const indexes = sums.get(target);
  return indexes?.map((index) => charges[index]!);
}

function toRefundAmount(value: Prisma.Decimal | number | null | undefined): number {
  return Number(value ?? 0);
}

function stableValue(prefix: string, returnId: string, chargeId: string): string {
  const digest = createHash('sha256').update(`${returnId}:${chargeId}`).digest('hex').slice(0, 32);
  return `${prefix}-${digest}`;
}

const openRefundAttemptStatuses = ['REQUESTED', 'IN_PROGRESS', 'AWAITING_PAYER_ACTION', 'NEEDS_RECONCILIATION'] as const;

async function lockAndCheckRefundCapacity(params: {
  tx: Prisma.TransactionClient;
  contaId: string;
  returnId: string;
  chargeId: string;
  chargeValue: number;
  requestedAmount: number;
  providerRefundBaseline: number;
  allowExistingReservation?: boolean;
}) {
  const { tx, contaId, returnId, chargeId } = params;
  // Different returns can point at the same payment. Serialize by the tenant/payment
  // pair, then include confirmed and still-open attempts across every return.
  await tx.$queryRaw<unknown[]>`SELECT pg_advisory_xact_lock(hashtext(${contaId}), hashtext(${chargeId}))`;
  const attempts = await tx.storeSaleRefundAttempt.findMany({
    where: { contaId, chargeId },
    select: { returnId: true, status: true, requestedAmount: true, confirmedAmount: true },
  });
  const existing = attempts.find((attempt) => attempt.returnId === returnId
    && ['REQUESTED', ...openRefundAttemptStatuses.slice(1)].includes(attempt.status));
  if (params.allowExistingReservation && existing) return;
  const confirmed = attempts.reduce((sum, attempt) => {
    const confirmedAmount = toRefundAmount(attempt.confirmedAmount);
    // A legacy fully-refunded attempt may have no confirmedAmount persisted.
    const effectiveConfirmed = attempt.status === 'REFUNDED' && confirmedAmount <= 0
      ? toRefundAmount(attempt.requestedAmount)
      : confirmedAmount;
    return sum + effectiveConfirmed;
  }, 0);
  const reserved = attempts
    .filter((attempt) => openRefundAttemptStatuses.includes(attempt.status as typeof openRefundAttemptStatuses[number]))
    .reduce((sum, attempt) => {
      const outstanding = Math.max(toRefundAmount(attempt.requestedAmount) - toRefundAmount(attempt.confirmedAmount), 0);
      return sum + outstanding;
    }, 0);
  const alreadyConsumed = Math.max(params.providerRefundBaseline, confirmed) + reserved;
  const available = Math.max(0, Number((params.chargeValue - alreadyConsumed).toFixed(2)));
  if (params.requestedAmount > available + 0.001) {
    throw new StoreSaleRefundError('SALDO_REEMBOLSO_INSUFICIENTE', 'O saldo disponível para estorno deste pagamento já foi reservado por outra devolução.');
  }
}

export async function requestStoreSaleRefund(input: Input) {
  const saleReturn = await withTenant(input.contaId, (tx) => tx.storeSaleReturn.findFirst({
    where: { id: input.returnId, saleId: input.saleId, contaId: input.contaId },
    include: {
      attempts: { orderBy: { createdAt: 'asc' } },
      sale: {
        include: {
          charge: true,
          standaloneInstallmentPlan: { include: { charges: { orderBy: { dueDate: 'asc' } } } },
        },
      },
    },
  }));
  if (!saleReturn) throw new StoreSaleRefundError('DEVOLUCAO_NAO_ENCONTRADA', 'Devolução não encontrada.', 404);
  if (saleReturn.refundStatus === 'REFUNDED' || saleReturn.refundStatus === 'AWAITING_PAYER_ACTION') {
    return { status: saleReturn.refundStatus, pending: saleReturn.refundStatus !== 'REFUNDED' };
  }

  const attemptsByCharge = new Map<string, typeof saleReturn.attempts>();
  for (const attempt of saleReturn.attempts) {
    const group = attemptsByCharge.get(attempt.chargeId) ?? [];
    group.push(attempt);
    attemptsByCharge.set(attempt.chargeId, group);
  }
  const latestAttempts = [...attemptsByCharge.values()].map((attempts) => attempts.at(-1)!);
  if (input.mode === 'RETRY_DENIED') {
    if (saleReturn.refundStatus !== 'DENIED' || latestAttempts.length === 0 || !latestAttempts.some((attempt) => attempt.status === 'DENIED') || latestAttempts.some((attempt) => !['DENIED', 'REFUNDED'].includes(attempt.status))) {
      throw new StoreSaleRefundError('REEMBOLSO_NAO_ELEGIVEL_PARA_RETRY', 'Somente estornos definitivamente negados podem ser tentados novamente.');
    }
  } else if (saleReturn.refundStatus === 'NEEDS_RECONCILIATION' || latestAttempts.some((attempt) => attempt.status === 'NEEDS_RECONCILIATION')) {
    throw new StoreSaleRefundError('REEMBOLSO_AGUARDA_RECONCILIACAO', 'O resultado do estorno ainda precisa ser reconciliado; uma nova tentativa está bloqueada.');
  } else if (saleReturn.refundStatus === 'DENIED' || latestAttempts.some((attempt) => attempt.status === 'DENIED')) {
    throw new StoreSaleRefundError('REEMBOLSO_NEGADO_RETRY_EXPLICITO', 'Este estorno foi negado. Use a ação explícita de nova tentativa para gerar uma nova tentativa auditável.');
  } else if (latestAttempts.some((attempt) => !['DENIED', 'NOT_SUPPORTED'].includes(attempt.status))) {
    return { status: saleReturn.refundStatus, pending: true };
  }

  if (toRefundAmount(saleReturn.refundRequestedAmount) <= 0) {
    await withTenant(input.contaId, (tx) => tx.storeSaleReturn.updateMany({
      where: { id: saleReturn.id, contaId: input.contaId },
      data: { refundStatus: 'NOT_REQUESTED', refundIssue: null },
    }));
    return { status: 'NOT_REQUESTED', pending: false };
  }

  const charges = [
    ...(saleReturn.sale.charge ? [saleReturn.sale.charge] : []),
    ...(saleReturn.sale.standaloneInstallmentPlan?.charges ?? []),
  ].filter((charge) => charge.status === 'PAID' && charge.asaasPaymentId);
  if (!charges.length) {
    const manual = saleReturn.sale.finalizationType === 'RECEBIMENTO_PRESENCIAL';
    const status = manual ? 'MANUAL_REFUND_REQUIRED' : 'NOT_SUPPORTED';
    await withTenant(input.contaId, (tx) => tx.storeSaleReturn.updateMany({
      where: { id: saleReturn.id, contaId: input.contaId },
      data: {
        refundStatus: status,
        refundIssue: manual
          ? 'A devolução física foi registrada; o estorno recebido presencialmente precisa ser registrado no financeiro.'
          : 'Não há uma cobrança Asaas paga e vinculada disponível para solicitar o estorno.',
      },
    }));
    return { status, pending: false };
  }

  const deniedAttempts = new Map(latestAttempts.filter((attempt) => attempt.status === 'DENIED').map((attempt) => [attempt.chargeId, attempt]));
  const boletoCharges = charges.filter((charge) => charge.billingType?.toUpperCase() === 'BOLETO');
  const nonBoletoCharges = charges.filter((charge) => charge.billingType?.toUpperCase() !== 'BOLETO');
  let selectedCharges = input.mode === 'RETRY_DENIED'
    ? charges.filter((charge) => deniedAttempts.has(charge.id))
    : charges;
  if (boletoCharges.length > 0 && input.mode !== 'RETRY_DENIED') {
    const exactBoletoSubset = findExactChargeSubset(boletoCharges, toRefundAmount(saleReturn.refundRequestedAmount));
    if (exactBoletoSubset) selectedCharges = exactBoletoSubset;
    else {
      const nonBoletoCapacity = nonBoletoCharges.reduce((sum, charge) => sum + toRefundAmount(charge.value), 0);
      const amountFromNonBoleto = Math.min(toRefundAmount(saleReturn.refundRequestedAmount), nonBoletoCapacity);
      const remainingForBoleto = Number((toRefundAmount(saleReturn.refundRequestedAmount) - amountFromNonBoleto).toFixed(2));
      const exactRemainder = findExactChargeSubset(boletoCharges, remainingForBoleto);
      if (!exactRemainder) {
        await withTenant(input.contaId, (tx) => tx.storeSaleReturn.updateMany({
          where: { id: saleReturn.id, contaId: input.contaId },
          data: { refundStatus: 'NOT_SUPPORTED', refundIssue: 'A devolução não corresponde a parcelas de boleto pagas completas; estorno parcial de boleto não é suportado.' },
        }));
        return { status: 'NOT_SUPPORTED', pending: false };
      }
      selectedCharges = [...nonBoletoCharges, ...exactRemainder];
    }
  }

  const refundBaselinesByCharge = new Map<string, number>();
  for (const charge of selectedCharges) {
    const officialPayment = await readPaymentFullPreflight(charge.asaasPaymentId!, { contaId: input.contaId });
    const providerRefundBaseline = Array.isArray((officialPayment as { refunds?: Array<{ status?: string | null; value?: number | null }> }).refunds)
      ? (officialPayment as unknown as { refunds: Array<{ status?: string | null; value?: number | null }> }).refunds
        .filter((refund) => refund.status?.toUpperCase() === 'DONE')
        .reduce((sum, refund) => sum + Number(refund.value ?? 0), 0)
      : 0;
    refundBaselinesByCharge.set(charge.id, providerRefundBaseline);
  }

  let aggregateExpectedUpdatedAt = saleReturn.updatedAt;
  const retryAttemptsByCharge = new Map<string, { id: string; correlationId: string; status: StoreSaleRefundAttemptStatus }>();
  if (input.mode === 'RETRY_DENIED') {
    const claimed = await withTenant(input.contaId, async (tx) => {
      const update = await tx.storeSaleReturn.updateMany({
        where: { id: saleReturn.id, contaId: input.contaId, refundStatus: 'DENIED', updatedAt: saleReturn.updatedAt },
        data: { refundStatus: 'REQUESTED', refundIssue: null },
      });
      if (update.count !== 1) return null;
      const createdAttempts = new Map<string, { id: string; correlationId: string; status: StoreSaleRefundAttemptStatus }>();
      for (const charge of selectedCharges) {
        const deniedAttempt = deniedAttempts.get(charge.id);
        if (!deniedAttempt) continue;
        const idempotencyKey = `store-return-retry-${randomUUID()}`;
        const correlationId = randomUUID();
        const allocation = toRefundAmount(deniedAttempt.requestedAmount);
        await lockAndCheckRefundCapacity({
          tx, contaId: input.contaId, returnId: saleReturn.id, chargeId: charge.id,
          chargeValue: toRefundAmount(charge.value), requestedAmount: allocation,
          providerRefundBaseline: refundBaselinesByCharge.get(charge.id) ?? 0,
        });
        const attempt = await tx.storeSaleRefundAttempt.create({
          data: {
            contaId: input.contaId,
            returnId: saleReturn.id,
            chargeId: charge.id,
            idempotencyKey,
            correlationId,
            requestedAmount: new Prisma.Decimal(allocation),
            providerRefundBaseline: new Prisma.Decimal(refundBaselinesByCharge.get(charge.id) ?? 0),
          },
        });
        createdAttempts.set(charge.id, attempt);
      }
      const updatedReturn = await tx.storeSaleReturn.findFirst({
        where: { id: saleReturn.id, contaId: input.contaId },
        select: { updatedAt: true },
      });
      return updatedReturn ? { updatedAt: updatedReturn.updatedAt, attempts: createdAttempts } : null;
    });
    if (!claimed) throw new StoreSaleRefundError('REEMBOLSO_RETRY_JA_CLAIMADO', 'Outra tentativa de estorno já foi iniciada. Atualize a devolução.');
    aggregateExpectedUpdatedAt = claimed.updatedAt;
    for (const [chargeId, attempt] of claimed.attempts) retryAttemptsByCharge.set(chargeId, attempt);
  }

  let remaining = input.mode === 'RETRY_DENIED'
    ? selectedCharges.reduce((sum, charge) => sum + toRefundAmount(deniedAttempts.get(charge.id)?.requestedAmount), 0)
    : toRefundAmount(saleReturn.refundRequestedAmount);
  for (const charge of selectedCharges) {
    if (remaining <= 0) break;
    const deniedAttempt = deniedAttempts.get(charge.id);
    const value = toRefundAmount(charge.value);
    const allocation = input.mode === 'RETRY_DENIED'
      ? toRefundAmount(deniedAttempt?.requestedAmount)
      : Math.min(value, remaining);
    if (allocation <= 0) continue;
    const existingRetryAttempt = input.mode === 'RETRY_DENIED' ? retryAttemptsByCharge.get(charge.id) : undefined;
    const attempt = existingRetryAttempt ?? await withTenant(input.contaId, async (tx) => {
      const attemptKey = stableValue('store-return', saleReturn.id, charge.id);
      const correlationId = stableValue('store-return-correlation', saleReturn.id, charge.id);
      const providerRefundBaseline = refundBaselinesByCharge.get(charge.id) ?? 0;
      await lockAndCheckRefundCapacity({
        tx, contaId: input.contaId, returnId: saleReturn.id, chargeId: charge.id,
        chargeValue: value, requestedAmount: allocation, providerRefundBaseline,
        allowExistingReservation: true,
      });
      return tx.storeSaleRefundAttempt.upsert({
        where: { uq_store_sale_refund_attempt_conta_key: { contaId: input.contaId, idempotencyKey: attemptKey } },
        create: {
          contaId: input.contaId,
          returnId: saleReturn.id,
          chargeId: charge.id,
          idempotencyKey: attemptKey,
          correlationId,
          requestedAmount: new Prisma.Decimal(allocation),
          providerRefundBaseline: new Prisma.Decimal(providerRefundBaseline),
        },
        update: {},
      });
    });
    if (attempt.status !== 'REQUESTED') {
      remaining -= allocation;
      continue;
    }

    let refundResult: Awaited<ReturnType<StoreSaleRefundDispatch>>;
    try {
      refundResult = await input.dispatch({
        contaId: input.contaId,
        actorId: input.actorId,
        role: input.role,
        chargeId: charge.id,
        correlationId: attempt.correlationId,
        returnId: saleReturn.id,
        attemptId: attempt.id,
        ...(allocation < value ? { value: allocation } : {}),
        description: `Devolução Loja ${saleReturn.id}`,
      });
    } catch (error) {
      await withTenant(input.contaId, async (tx) => {
        await tx.storeSaleRefundAttempt.updateMany({
          where: { id: attempt.id, contaId: input.contaId, status: 'REQUESTED' },
          data: {
            status: 'NEEDS_RECONCILIATION',
            providerStatus: 'DISPATCH_OUTCOME_UNKNOWN',
            lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown refund dispatch failure',
          },
        });
        await tx.storeSaleReturn.updateMany({
          where: { id: saleReturn.id, contaId: input.contaId, updatedAt: aggregateExpectedUpdatedAt },
          data: { refundStatus: 'NEEDS_RECONCILIATION', refundIssue: 'O resultado do estorno é incerto; reconcilie antes de qualquer nova tentativa.' },
        });
      });
      throw new StoreSaleRefundError('REEMBOLSO_AGUARDA_RECONCILIACAO', 'O resultado do estorno é incerto; uma nova tentativa foi bloqueada até a reconciliação.');
    }
    const resultBody = refundResult.body as { requestUrl?: unknown };
    const requestUrl = typeof resultBody?.requestUrl === 'string' ? resultBody.requestUrl : null;
    const nextStatus: StoreSaleRefundAttemptStatus = refundResult.status >= 500
      ? 'NEEDS_RECONCILIATION'
      : refundResult.status >= 400
        ? 'DENIED'
        : requestUrl
          ? 'AWAITING_PAYER_ACTION'
          : 'IN_PROGRESS';
    await withTenant(input.contaId, (tx) => tx.storeSaleRefundAttempt.updateMany({
      where: { id: attempt.id, contaId: input.contaId, status: 'REQUESTED' },
      data: { status: nextStatus, providerStatus: nextStatus, requestUrl },
    }));
    remaining -= allocation;
  }

  const attempts = await withTenant(input.contaId, (tx) => tx.storeSaleRefundAttempt.findMany({
    where: { returnId: saleReturn.id, contaId: input.contaId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }));
  const latestByCharge = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) latestByCharge.set(attempt.chargeId, attempt);
  const effectiveAttempts = [...latestByCharge.values()];
  const hasDenied = effectiveAttempts.some((attempt) => attempt.status === 'DENIED');
  const hasPayerAction = effectiveAttempts.some((attempt) => attempt.status === 'AWAITING_PAYER_ACTION');
  const hasReconciliation = effectiveAttempts.some((attempt) => attempt.status === 'NEEDS_RECONCILIATION');
  const allRefunded = effectiveAttempts.length > 0 && effectiveAttempts.every((attempt) => attempt.status === 'REFUNDED');
  const aggregateStatus = allRefunded
    ? 'REFUNDED'
    : hasReconciliation
      ? 'NEEDS_RECONCILIATION'
      : hasDenied
        ? 'DENIED'
        : hasPayerAction
          ? 'AWAITING_PAYER_ACTION'
          : 'IN_PROGRESS';
  const requestUrl = effectiveAttempts.find((attempt) => attempt.requestUrl)?.requestUrl ?? null;
  const update = await withTenant(input.contaId, (tx) => tx.storeSaleReturn.updateMany({
    where: { id: saleReturn.id, contaId: input.contaId, updatedAt: aggregateExpectedUpdatedAt },
    data: {
      refundStatus: remaining > 0 || hasReconciliation ? 'NEEDS_RECONCILIATION' : aggregateStatus,
      refundRequestUrl: requestUrl,
      refundIssue: remaining > 0
        ? 'O valor da devolução excede o total pago nas cobranças vinculadas. É necessária reconciliação financeira.'
        : hasReconciliation
          ? saleReturn.refundIssue ?? 'O resultado do estorno ainda não foi confirmado pela plataforma financeira; reconciliação necessária.'
          : null,
    },
  }));
  if (update.count !== 1) {
    throw new StoreSaleRefundError('DEVOLUCAO_ATUALIZADA_CONCORRENTEMENTE', 'A devolução mudou durante a operação; atualize a tela e confira o estado financeiro.');
  }
  await auditLogService.record({
    contaId: input.contaId,
    actor: { type: 'USER', id: input.actorId },
    action: input.mode === 'RETRY_DENIED' ? 'loja.sale.refund_retry_requested' : 'loja.sale.refund_requested',
    entity: { type: 'StoreSaleReturn', id: saleReturn.id },
    metadata: { correlationIds: attempts.map((attempt) => attempt.correlationId), status: aggregateStatus, mode: input.mode },
  });
  return { status: aggregateStatus, pending: !['REFUNDED', 'DENIED', 'NOT_SUPPORTED'].includes(aggregateStatus) };
}
