import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  financialTransactionSnapshot: {
    findMany: vi.fn(),
  },
  financeDailyAggregate: {
    upsert: vi.fn(),
  },
  financeMonthlyAggregate: {
    upsert: vi.fn(),
  },
};

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

const { rebuildFinanceAggregates } = await import('../finance-aggregate.service');

describe('finance-aggregate.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.financeDailyAggregate.upsert.mockResolvedValue({});
    prismaMock.financeMonthlyAggregate.upsert.mockResolvedValue({});
  });

  it('agrega créditos, débitos e líquido por dia e mês sem consultar Asaas', async () => {
    prismaMock.financialTransactionSnapshot.findMany.mockResolvedValue([
      { date: new Date('2026-06-01T10:00:00.000Z'), value: 100 },
      { date: new Date('2026-06-01T12:00:00.000Z'), value: -3.49 },
      { date: new Date('2026-06-02T10:00:00.000Z'), value: 200 },
      { date: new Date('2026-06-02T12:00:00.000Z'), value: -50 },
    ]);

    const result = await rebuildFinanceAggregates({
      contaId: 'conta-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
    });

    expect(prismaMock.financeDailyAggregate.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.financeDailyAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uq_fin_daily_aggregate_conta_day: {
            contaId: 'conta-1',
            day: new Date('2026-06-01T00:00:00.000Z'),
          },
        },
        update: expect.objectContaining({
          creditAmount: 100,
          debitAmount: 3.49,
          netAmount: 96.51,
          transactionCount: 2,
        }),
      }),
    );
    expect(prismaMock.financeMonthlyAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uq_fin_monthly_aggregate_conta_month: {
            contaId: 'conta-1',
            month: '2026-06',
          },
        },
        update: expect.objectContaining({
          creditAmount: 300,
          debitAmount: 53.49,
          netAmount: 246.51,
          transactionCount: 4,
        }),
      }),
    );
    expect(result).toMatchObject({
      accounts: 1,
      transactionsScanned: 4,
      dailyAggregates: 2,
      monthlyAggregates: 1,
    });
  });
});
