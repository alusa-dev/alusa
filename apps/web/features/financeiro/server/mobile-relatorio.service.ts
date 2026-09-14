import {
  financialReportQuerySchema,
  getFinancialOverviewReport,
} from '@alusa/finance';

import { calculateBusinessHealthScore } from '@/features/financeiro/relatorios/utils/businessHealthScore';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';

export type MobileReportPeriod = 'this-month' | 'previous-month' | 'last-3-months';
export type MobileReportActor = { userId: string; contaId: string };

export class MobileReportUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileReportUnauthorizedError';
  }
}

async function assertActiveMembership(tx: TenantTransactionClient, actor: MobileReportActor) {
  const membership = await tx.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { role: true },
  });

  if (!membership || !['ADMIN', 'FINANCEIRO'].includes(membership.role.toUpperCase())) {
    throw new MobileReportUnauthorizedError();
  }
}

function civilDayAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCivilMonths(day: string, months: number) {
  const [year, month] = day.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function periodDates(period: MobileReportPeriod, now: Date, timeZone: string) {
  const endDate = civilDayAt(now, timeZone);
  if (period === 'previous-month') {
    const currentMonthStart = `${endDate.slice(0, 7)}-01`;
    return { startDate: addCivilMonths(currentMonthStart, -1), endDate: previousDay(currentMonthStart) };
  }
  if (period === 'last-3-months') {
    return { startDate: addCivilMonths(`${endDate.slice(0, 7)}-01`, -2), endDate };
  }
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}

function periodLabel(period: MobileReportPeriod) {
  if (period === 'previous-month') return 'Mês anterior';
  if (period === 'last-3-months') return 'Últimos 3 meses';
  return 'Este mês';
}

export async function getMobileFinancialReport(input: {
  actor: MobileReportActor;
  period: MobileReportPeriod;
}) {
  return runWithTenant(input.actor.contaId, async (tx) => {
    await assertActiveMembership(tx, input.actor);
    const account = await tx.conta.findFirst({
      where: { id: input.actor.contaId, status: 'ATIVO', deletedAt: null },
      select: { timezone: true },
    });
    if (!account) throw new MobileReportUnauthorizedError();

    const timeZone = account.timezone || 'America/Sao_Paulo';
    const dates = periodDates(input.period, new Date(), timeZone);
    const query = financialReportQuerySchema.parse({
      ...dates,
      dateBasis: 'DUE_DATE',
      search: '',
      page: 1,
      pageSize: 1,
      sort: 'dueDate',
      direction: 'desc',
    });
    const report = await getFinancialOverviewReport({ contaId: input.actor.contaId, query, db: tx });
    const health = calculateBusinessHealthScore({
      summary: report.summary,
      classOccupancy: report.classOccupancy,
      enrollmentHealth: report.enrollmentHealth,
    });
    const riskClass = [...report.rankingByClass].sort((left, right) => right.overdue - left.overdue)[0];
    const cost = report.summary.fees + report.summary.refunds;
    const highlights = [
      report.summary.overdue > 0
        ? {
            title: `${formatCurrency(report.summary.overdue)} em atraso`,
            value: `${report.summary.overdueCount} ${report.summary.overdueCount === 1 ? 'cobrança' : 'cobranças'}`,
            description: 'Valores vencidos que precisam de acompanhamento.',
            tone: 'danger' as const,
          }
        : {
            title: 'Nenhum valor em atraso',
            value: 'Tudo certo',
            description: 'Não há cobranças vencidas dentro do período.',
            tone: 'success' as const,
          },
      ...(cost > 0
        ? [{
            title: 'Taxas e estornos',
            value: formatCurrency(cost),
            description: 'Valores que reduziram o total líquido recebido.',
            tone: 'warning' as const,
          }]
        : []),
      ...(riskClass && riskClass.overdue > 0
        ? [{
            title: `Atenção na turma ${riskClass.name}`,
            value: formatCurrency(riskClass.overdue),
            description: 'Maior concentração de valores em atraso.',
            tone: 'warning' as const,
          }]
        : []),
      ...(report.enrollmentHealth.cancellationsInPeriod > 0
        ? [{
            title: 'Cancelamentos no período',
            value: String(report.enrollmentHealth.cancellationsInPeriod),
            description: 'Matrículas encerradas no recorte selecionado.',
            tone: 'neutral' as const,
          }]
        : []),
    ].slice(0, 3);

    return {
      period: input.period,
      periodLabel: periodLabel(input.period),
      startDate: dates.startDate,
      endDate: dates.endDate,
      generatedAt: report.generatedAt,
      timeZone: report.timeZone,
      summary: {
        totalCharges: report.summary.totalCharges,
        received: report.summary.received,
        receivable: report.summary.receivable,
        overdue: report.summary.overdue,
        fees: report.summary.fees,
        refunds: report.summary.refunds,
        net: report.summary.net,
        averageTicket: report.summary.averageTicket,
        delinquencyRate: report.summary.delinquencyRate,
        chargeCount: report.summary.chargeCount,
        receivedCount: report.summary.receivedCount,
        overdueCount: report.summary.overdueCount,
      },
      enrollmentHealth: report.enrollmentHealth,
      series: report.series.slice(-6),
      health: {
        level: health.level,
        label: health.label,
        description: health.description,
        score: health.score,
        coverage: health.coverage,
      },
      highlights,
      classOccupancy: report.classOccupancy.slice(0, 5),
      dataQuality: report.dataQuality,
    };
  });
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
