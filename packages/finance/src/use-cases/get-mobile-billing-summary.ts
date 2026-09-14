import { prisma } from '@alusa/database';
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  numberFromFinanceDecimal,
  resolveMobileBillingCategory,
  roundFinanceCurrency,
  type MobileBillingCategory,
} from '../billing-status';

type FinanceDbClient = PrismaClient | Prisma.TransactionClient;

export type MobileBillingPeriod = 'THIS_MONTH' | 'LAST_30_DAYS';

export type MobileBillingSummaryInput = {
  contaId: string;
  period: MobileBillingPeriod;
  now?: Date;
  db?: FinanceDbClient;
};

export type MobileBillingMetric = {
  count: number;
  amount: number;
};

export type MobileBillingSummary = {
  period: MobileBillingPeriod;
  received: MobileBillingMetric;
  confirmed: MobileBillingMetric;
  awaitingPayment: MobileBillingMetric;
  overdue: MobileBillingMetric;
};

type Bucket = { count: number; amount: number };

function emptyBucket(): Bucket {
  return { count: 0, amount: 0 };
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getPeriod(now: Date, period: MobileBillingPeriod) {
  if (period === 'LAST_30_DAYS') {
    return {
      start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      end: now,
    };
  }

  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function isWithin(value: Date | null, start: Date, end: Date) {
  return Boolean(value && value >= start && value < end);
}

function add(bucket: Bucket, amount: number) {
  bucket.count += 1;
  bucket.amount += amount;
}

function belongsToPeriod(input: {
  category: MobileBillingCategory;
  eventDate: Date | null;
  dueDate: Date | null;
  start: Date;
  end: Date;
}) {
  if (input.category === 'REFUNDED' || input.category === 'CANCELLED') {
    return isWithin(input.eventDate, input.start, input.end);
  }
  if (input.category === 'RECEIVED' || input.category === 'CONFIRMED') {
    return isWithin(input.eventDate, input.start, input.end);
  }
  return isWithin(input.dueDate, input.start, input.end);
}

export async function getMobileBillingSummary(input: MobileBillingSummaryInput): Promise<MobileBillingSummary> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const period = getPeriod(now, input.period);
  const buckets: Record<Exclude<MobileBillingCategory, 'IGNORED' | 'REFUNDED' | 'CANCELLED'>, Bucket> = {
    RECEIVED: emptyBucket(),
    CONFIRMED: emptyBucket(),
    AWAITING_PAYMENT: emptyBucket(),
    OVERDUE: emptyBucket(),
  };

  const [academicCharges, standaloneCharges] = await Promise.all([
    db.cobranca.findMany({
      where: {
        contaId: input.contaId,
        matricula: { contaId: input.contaId },
        status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'PAGO', 'ATRASADO', 'CANCELADO'] },
      },
      select: {
        id: true,
        valor: true,
        valorFinal: true,
        asaasValue: true,
        asaasStatus: true,
        asaasNetValue: true,
        status: true,
        liquidacaoStatus: true,
        vencimento: true,
        dataPagamento: true,
        pagoEm: true,
        updatedAt: true,
      },
    }),
    db.charge.findMany({
      where: {
        contaId: input.contaId,
        cobrancaId: null,
        status: { in: ['CREATED', 'PENDING_SYNC', 'OPEN', 'PAID', 'OVERDUE', 'CANCELED'] },
      },
      select: {
        id: true,
        value: true,
        asaasValue: true,
        asaasStatus: true,
        asaasNetValue: true,
        status: true,
        liquidacaoStatus: true,
        dueDate: true,
        liquidadoEm: true,
        statusUpdatedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  for (const charge of academicCharges) {
    const category = resolveMobileBillingCategory({
      localStatus: charge.status,
      asaasStatus: charge.asaasStatus,
      liquidacaoStatus: charge.liquidacaoStatus,
      dueDate: charge.vencimento,
      startOfToday: today,
    });
    if (category === 'IGNORED' || category === 'REFUNDED' || category === 'CANCELLED' || !belongsToPeriod({
      category,
      eventDate: charge.dataPagamento ?? charge.pagoEm ?? charge.updatedAt,
      dueDate: charge.vencimento,
      start: period.start,
      end: period.end,
    })) continue;

    add(buckets[category], numberFromFinanceDecimal(charge.asaasValue ?? charge.valorFinal ?? charge.valor));
  }

  for (const charge of standaloneCharges) {
    const category = resolveMobileBillingCategory({
      localStatus: charge.status,
      asaasStatus: charge.asaasStatus,
      liquidacaoStatus: charge.liquidacaoStatus,
      dueDate: charge.dueDate,
      startOfToday: today,
    });
    if (category === 'IGNORED' || category === 'REFUNDED' || category === 'CANCELLED' || !belongsToPeriod({
      category,
      eventDate: charge.liquidadoEm ?? charge.statusUpdatedAt ?? charge.updatedAt,
      dueDate: charge.dueDate,
      start: period.start,
      end: period.end,
    })) continue;

    add(buckets[category], numberFromFinanceDecimal(charge.asaasValue ?? charge.value));
  }

  return {
    period: input.period,
    received: { count: buckets.RECEIVED.count, amount: roundFinanceCurrency(buckets.RECEIVED.amount) },
    confirmed: { count: buckets.CONFIRMED.count, amount: roundFinanceCurrency(buckets.CONFIRMED.amount) },
    awaitingPayment: { count: buckets.AWAITING_PAYMENT.count, amount: roundFinanceCurrency(buckets.AWAITING_PAYMENT.amount) },
    overdue: { count: buckets.OVERDUE.count, amount: roundFinanceCurrency(buckets.OVERDUE.amount) },
  };
}
