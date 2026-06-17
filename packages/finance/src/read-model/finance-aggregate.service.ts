import { prisma } from '@alusa/database';

export type RebuildFinanceAggregatesInput = {
  contaId?: string;
  startDate?: Date;
  endDate?: Date;
  days?: number;
  maxAccounts?: number;
};

export type RebuildFinanceAggregatesResult = {
  accounts: number;
  transactionsScanned: number;
  dailyAggregates: number;
  monthlyAggregates: number;
};

type AggregateBucket = {
  creditAmount: number;
  debitAmount: number;
  netAmount: number;
  creditCount: number;
  debitCount: number;
  transactionCount: number;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function emptyBucket(): AggregateBucket {
  return {
    creditAmount: 0,
    debitAmount: 0,
    netAmount: 0,
    creditCount: 0,
    debitCount: 0,
    transactionCount: 0,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function applyValue(bucket: AggregateBucket, rawValue: unknown) {
  const value = Number(rawValue ?? 0);
  bucket.netAmount += value;
  bucket.transactionCount += 1;

  if (value >= 0) {
    bucket.creditAmount += value;
    bucket.creditCount += 1;
  } else {
    bucket.debitAmount += Math.abs(value);
    bucket.debitCount += 1;
  }
}

async function listContaIds(maxAccounts: number): Promise<string[]> {
  const rows = await prisma.financialTransactionSnapshot.findMany({
    distinct: ['contaId'],
    orderBy: { fetchedAt: 'asc' },
    take: maxAccounts,
    select: { contaId: true },
  });

  return rows.map((row) => row.contaId);
}

export async function rebuildFinanceAggregates(
  input: RebuildFinanceAggregatesInput = {},
): Promise<RebuildFinanceAggregatesResult> {
  const days = clampInt(input.days, 90, 1, 370);
  const maxAccounts = clampInt(input.maxAccounts, 50, 1, 200);
  const endDate = input.endDate ?? addUtcDays(startOfUtcDay(new Date()), 1);
  const startDate = input.startDate ?? addUtcDays(startOfUtcDay(endDate), -days);
  const contaIds = input.contaId ? [input.contaId] : await listContaIds(maxAccounts);
  const calculatedAt = new Date();
  const result: RebuildFinanceAggregatesResult = {
    accounts: contaIds.length,
    transactionsScanned: 0,
    dailyAggregates: 0,
    monthlyAggregates: 0,
  };

  for (const contaId of contaIds) {
    const rows = await prisma.financialTransactionSnapshot.findMany({
      where: {
        contaId,
        date: { gte: startDate, lt: endDate },
      },
      select: {
        date: true,
        value: true,
      },
      orderBy: { date: 'asc' },
    });
    result.transactionsScanned += rows.length;

    const daily = new Map<string, { day: Date; bucket: AggregateBucket }>();
    const monthly = new Map<string, { periodStart: Date; periodEnd: Date; bucket: AggregateBucket }>();

    for (const row of rows) {
      const day = startOfUtcDay(row.date);
      const dayKey = day.toISOString().slice(0, 10);
      const existingDay = daily.get(dayKey) ?? { day, bucket: emptyBucket() };
      applyValue(existingDay.bucket, row.value);
      daily.set(dayKey, existingDay);

      const month = monthKey(row.date);
      const existingMonth =
        monthly.get(month) ?? {
          periodStart: startOfUtcMonth(row.date),
          periodEnd: endOfUtcMonth(row.date),
          bucket: emptyBucket(),
        };
      applyValue(existingMonth.bucket, row.value);
      monthly.set(month, existingMonth);
    }

    for (const entry of daily.values()) {
      const bucket = entry.bucket;
      await prisma.financeDailyAggregate.upsert({
        where: {
          uq_fin_daily_aggregate_conta_day: {
            contaId,
            day: entry.day,
          },
        },
        update: {
          creditAmount: roundCurrency(bucket.creditAmount),
          debitAmount: roundCurrency(bucket.debitAmount),
          netAmount: roundCurrency(bucket.netAmount),
          creditCount: bucket.creditCount,
          debitCount: bucket.debitCount,
          transactionCount: bucket.transactionCount,
          calculatedAt,
        },
        create: {
          contaId,
          day: entry.day,
          creditAmount: roundCurrency(bucket.creditAmount),
          debitAmount: roundCurrency(bucket.debitAmount),
          netAmount: roundCurrency(bucket.netAmount),
          creditCount: bucket.creditCount,
          debitCount: bucket.debitCount,
          transactionCount: bucket.transactionCount,
          calculatedAt,
        },
      });
      result.dailyAggregates += 1;
    }

    for (const [month, entry] of monthly.entries()) {
      const bucket = entry.bucket;
      await prisma.financeMonthlyAggregate.upsert({
        where: {
          uq_fin_monthly_aggregate_conta_month: {
            contaId,
            month,
          },
        },
        update: {
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          creditAmount: roundCurrency(bucket.creditAmount),
          debitAmount: roundCurrency(bucket.debitAmount),
          netAmount: roundCurrency(bucket.netAmount),
          creditCount: bucket.creditCount,
          debitCount: bucket.debitCount,
          transactionCount: bucket.transactionCount,
          calculatedAt,
        },
        create: {
          contaId,
          month,
          periodStart: entry.periodStart,
          periodEnd: entry.periodEnd,
          creditAmount: roundCurrency(bucket.creditAmount),
          debitAmount: roundCurrency(bucket.debitAmount),
          netAmount: roundCurrency(bucket.netAmount),
          creditCount: bucket.creditCount,
          debitCount: bucket.debitCount,
          transactionCount: bucket.transactionCount,
          calculatedAt,
        },
      });
      result.monthlyAggregates += 1;
    }
  }

  return result;
}
