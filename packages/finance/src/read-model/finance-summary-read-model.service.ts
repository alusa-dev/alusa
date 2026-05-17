import { prisma } from '@alusa/database';

export type FinanceSummaryWindow = {
  start: Date;
  end: Date;
};

export type FinanceSummarySnapshot = {
  contaId: string;
  pendingAmountCurrentWindow: number;
  pendingCountCurrentWindow: number;
  overdueAmount: number;
  overdueCount: number;
  paidAmountMonth: number;
  paidCountMonth: number;
  calculatedAt: Date;
  projectedAt: Date;
  windowStart: Date;
  windowEnd: Date;
};

function enabled() {
  return process.env.FIN_SUMMARY_READMODEL_ENABLED === 'true';
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function mapSnapshot(row: {
  contaId: string;
  pendingAmountCurrentWindow: unknown;
  pendingCountCurrentWindow: number;
  overdueAmount: unknown;
  overdueCount: number;
  paidAmountMonth: unknown;
  paidCountMonth: number;
  calculatedAt: Date;
  projectedAt: Date;
  windowStart: Date;
  windowEnd: Date;
}): FinanceSummarySnapshot {
  return {
    contaId: row.contaId,
    pendingAmountCurrentWindow: toNumber(row.pendingAmountCurrentWindow),
    pendingCountCurrentWindow: row.pendingCountCurrentWindow,
    overdueAmount: toNumber(row.overdueAmount),
    overdueCount: row.overdueCount,
    paidAmountMonth: toNumber(row.paidAmountMonth),
    paidCountMonth: row.paidCountMonth,
    calculatedAt: row.calculatedAt,
    projectedAt: row.projectedAt,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
  };
}

export async function refreshFinanceSummaryReadModel(params: {
  contaId: string;
  window: FinanceSummaryWindow;
  now?: Date;
}): Promise<FinanceSummarySnapshot | null> {
  if (!enabled()) return null;

  const now = params.now ?? new Date();
  const [pendingRows, overdueRows, paidRows] = await Promise.all([
    prisma.chargeReadModel.findMany({
      where: {
        contaId: params.contaId,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { gte: params.window.start, lte: params.window.end },
      },
      select: { value: true },
    }),
    prisma.chargeReadModel.findMany({
      where: {
        contaId: params.contaId,
        status: 'OVERDUE',
      },
      select: { value: true },
    }),
    prisma.chargeReadModel.findMany({
      where: {
        contaId: params.contaId,
        status: 'PAID',
        updatedAt: { gte: params.window.start, lte: params.window.end },
      },
      select: { value: true },
    }),
  ]);

  const data = {
    pendingAmountCurrentWindow: roundCurrency(pendingRows.reduce((sum, row) => sum + toNumber(row.value), 0)),
    pendingCountCurrentWindow: pendingRows.length,
    overdueAmount: roundCurrency(overdueRows.reduce((sum, row) => sum + toNumber(row.value), 0)),
    overdueCount: overdueRows.length,
    paidAmountMonth: roundCurrency(paidRows.reduce((sum, row) => sum + toNumber(row.value), 0)),
    paidCountMonth: paidRows.length,
    calculatedAt: now,
    projectedAt: now,
  };

  const row = await prisma.financeSummaryReadModel.upsert({
    where: {
      uq_finance_summary_conta_window: {
        contaId: params.contaId,
        windowStart: params.window.start,
        windowEnd: params.window.end,
      },
    },
    update: data,
    create: {
      contaId: params.contaId,
      windowStart: params.window.start,
      windowEnd: params.window.end,
      ...data,
    },
  });

  return mapSnapshot(row);
}

export async function getFinanceSummaryReadModel(params: {
  contaId: string;
  window: FinanceSummaryWindow;
  maxAgeSeconds?: number;
  now?: Date;
}): Promise<FinanceSummarySnapshot | null> {
  if (!enabled()) return null;

  const now = params.now ?? new Date();
  const existing = await prisma.financeSummaryReadModel.findUnique({
    where: {
      uq_finance_summary_conta_window: {
        contaId: params.contaId,
        windowStart: params.window.start,
        windowEnd: params.window.end,
      },
    },
  });

  const maxAgeSeconds = params.maxAgeSeconds ?? 60;
  if (
    existing &&
    now.getTime() - existing.projectedAt.getTime() <= maxAgeSeconds * 1000
  ) {
    return mapSnapshot(existing);
  }

  return refreshFinanceSummaryReadModel({
    contaId: params.contaId,
    window: params.window,
    now,
  });
}

export async function getFinanceSummaryLag(params: { contaId: string }) {
  const [chargesBehind, cobrancasBehind] = await Promise.all([
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Charge" c
      LEFT JOIN "ChargeReadModel" crm
        ON crm."contaId" = c."contaId"
       AND crm."sourceKind" = 'CHARGE'
       AND crm."sourceId" = c."id"
      WHERE c."contaId" = ${params.contaId}
        AND (crm."id" IS NULL OR crm."projectedAt" < c."updatedAt")
    `.then((rows) => Number(rows[0]?.count ?? 0)).catch(() => null),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Cobranca" c
      LEFT JOIN "ChargeReadModel" crm
        ON crm."contaId" = c."contaId"
       AND crm."sourceKind" = 'COBRANCA'
       AND crm."sourceId" = c."id"
      WHERE c."contaId" = ${params.contaId}
        AND (crm."id" IS NULL OR crm."projectedAt" < c."updatedAt")
    `.then((rows) => Number(rows[0]?.count ?? 0)).catch(() => null),
  ]);

  return { chargesBehind, cobrancasBehind };
}

export const financeSummaryReadModelService = {
  enabled,
  getFinanceSummaryReadModel,
  refreshFinanceSummaryReadModel,
  getFinanceSummaryLag,
};
