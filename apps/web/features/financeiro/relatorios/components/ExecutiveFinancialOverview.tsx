'use client';

import Link from 'next/link';
import * as React from 'react';

import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  InfoCircle,
  Warning,
} from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { FinancialMetricSummary, FinancialOverviewReport } from '../dtos';
import {
  businessScoreColor,
  calculateBusinessHealthScore,
  type BusinessHealthLevel,
  type BusinessHealthScore,
} from '../utils/businessHealthScore';
import { formatReportMoney } from '../utils/formatters';
import { FinancialMetricCard } from './FinancialMetricCard';
import { EnrollmentCancellationChart } from './EnrollmentCancellationChart';
import { FinancialTrendChart } from './ReportCharts';

const EMPTY_SUMMARY: FinancialMetricSummary = {
  totalCharges: 0,
  received: 0,
  receivable: 0,
  overdue: 0,
  processing: 0,
  fees: 0,
  refunds: 0,
  net: 0,
  toSettle: 0,
  available: 0,
  averageTicket: 0,
  delinquencyRate: 0,
  chargeCount: 0,
  receivedCount: 0,
  overdueCount: 0,
};

function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

const healthStyles: Record<
  BusinessHealthLevel,
  {
    badge: string;
    icon: typeof CheckCircle;
  }
> = {
  healthy: {
    badge:
      'bg-emerald-50 text-emerald-700 alusa-dark:bg-emerald-950/30 alusa-dark:text-emerald-300',
    icon: CheckCircle,
  },
  stable: {
    badge: 'bg-lime-50 text-lime-700 alusa-dark:bg-lime-950/30 alusa-dark:text-lime-300',
    icon: CheckCircle,
  },
  attention: {
    badge: 'bg-amber-50 text-amber-700 alusa-dark:bg-amber-950/30 alusa-dark:text-amber-300',
    icon: Warning,
  },
  critical: {
    badge: 'bg-red-50 text-red-700 alusa-dark:bg-red-950/30 alusa-dark:text-red-300',
    icon: AlertCircle,
  },
  empty: {
    badge: 'bg-slate-100 text-slate-600 alusa-dark:bg-slate-800 alusa-dark:text-slate-300',
    icon: InfoCircle,
  },
};

export function ExecutiveFinancialOverview({
  data,
  loading,
  businessHealthData,
  businessHealthLoading,
  annualEnrollmentData,
  annualEnrollmentLoading,
}: {
  data: FinancialOverviewReport | null;
  loading: boolean;
  businessHealthData?: FinancialOverviewReport | null;
  businessHealthLoading?: boolean;
  annualEnrollmentData?: FinancialOverviewReport | null;
  annualEnrollmentLoading?: boolean;
}): React.JSX.Element {
  const summary = data?.summary ?? EMPTY_SUMMARY;
  const healthSource = businessHealthData === undefined ? data : businessHealthData;
  const annualEnrollmentSource = annualEnrollmentData === undefined ? data : annualEnrollmentData;
  const health = calculateBusinessHealthScore({
    summary: healthSource?.summary ?? EMPTY_SUMMARY,
    classOccupancy: healthSource?.classOccupancy ?? [],
    enrollmentHealth: healthSource?.enrollmentHealth ?? {
      activeEnrollments: 0,
      enrollmentsInPeriod: 0,
      cancellationsInPeriod: 0,
      openingActiveEnrollments: 0,
      retentionRate: null,
    },
  });

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="financial-kpis-title"
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-white p-5 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <SectionHeading
          id="financial-kpis-title"
          title="Indicadores principais"
          description="Uma leitura direta do que foi cobrado, recebido e ainda exige acompanhamento."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <FinancialMetricCard
            label="Total em cobranças"
            value={summary.totalCharges}
            description="Soma das cobranças válidas do período, sem cobranças canceladas."
            loading={loading}
          />
          <FinancialMetricCard
            label="Recebido"
            value={summary.received}
            description="Pagamentos confirmados antes de taxas e estornos."
            loading={loading}
          />
          <FinancialMetricCard
            label="Valor líquido"
            value={summary.net}
            description="Valor recebido depois de taxas financeiras e estornos."
            loading={loading}
          />
          <FinancialMetricCard
            label="A receber"
            value={summary.receivable}
            description="Saldo ainda dentro do prazo de vencimento no período."
            loading={loading}
          />
          <FinancialMetricCard
            label="Em atraso"
            value={summary.overdue}
            description="Saldo vencido e ainda não recebido."
            loading={loading}
          />
          <FinancialMetricCard
            label="Ticket médio"
            value={summary.averageTicket}
            description="Valor mensal médio vigente por matrícula ativa."
            loading={loading}
          />
        </div>
      </section>

      <section
        aria-labelledby="financial-flow-title"
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} space-y-6 rounded-2xl bg-white p-5 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <SectionHeading
          id="financial-flow-title"
          title="Visão geral"
          description="Entenda como os recebimentos evoluíram e o que ainda depende de entrada."
        />
        <div className="grid items-stretch gap-4 xl:grid-cols-2">
          <FinancialTrendChart
            title="Total em cobranças × recebido"
            description="Evolução mensal do total cobrado e recebido no ano atual."
            data={annualEnrollmentSource?.series ?? []}
            loading={annualEnrollmentLoading === undefined ? loading : annualEnrollmentLoading}
          />
          <EnrollmentCancellationChart
            data={annualEnrollmentSource?.enrollmentSeries ?? []}
            loading={annualEnrollmentLoading === undefined ? loading : annualEnrollmentLoading}
          />
        </div>

        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ReceivablesComposition summary={summary} loading={loading} />
          <HealthOverview
            health={health}
            loading={businessHealthLoading === undefined ? loading : businessHealthLoading}
          />
          <ClassOccupancyCard data={data} loading={loading} />
          <AttentionPoints summary={summary} data={data} loading={loading} />
          <div className="min-w-0 md:col-span-2 xl:col-span-2">
            <AcademicContext data={data} loading={loading} />
          </div>
        </div>

        <QuickReports />

        <DataCoverage />
      </section>
    </div>
  );
}

function HealthOverview({ health, loading }: { health: BusinessHealthScore; loading: boolean }) {
  const style = healthStyles[health.level];
  const StatusIcon = style.icon;
  const scoreSegmentCount = 50;
  const filledSegments =
    health.score === null ? 0 : Math.round((health.score / 100) * scoreSegmentCount);

  return (
    <section
      aria-labelledby="financial-health-title"
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} h-full overflow-hidden rounded-2xl bg-white shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
    >
      <div className="flex h-full flex-col">
        <DashboardCardHeader
          id="financial-health-title"
          title="Score de saúde do negócio"
          description="Estado operacional atual da escola."
          end={
            !loading ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium',
                  style.badge,
                )}
              >
                <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Diagnóstico
              </span>
            ) : null
          }
        />

        <div className="flex flex-1 flex-col justify-between p-5">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between gap-4">
                <p className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                  {health.label}
                </p>
                {health.score !== null ? (
                  <p className="shrink-0 text-lg font-semibold tabular-nums text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    {health.score} <span className="text-xs font-medium text-gray-500">/ 100</span>
                  </p>
                ) : null}
              </div>
              <div
                className="mt-3 flex items-center justify-between"
                role="img"
                aria-label={
                  health.score === null
                    ? 'Score indisponível'
                    : `Score de saúde do negócio: ${health.score} de 100`
                }
              >
                {Array.from({ length: scoreSegmentCount }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-7 w-1 shrink-0 rounded-full sm:w-1.5',
                      index < filledSegments
                        ? null
                        : 'bg-slate-100 alusa-dark:bg-[color:var(--color-bg-card-soft)]',
                    )}
                    style={
                      index < filledSegments
                        ? {
                            backgroundColor: businessScoreColor(
                              (index / Math.max(1, scoreSegmentCount - 1)) * 100,
                            ),
                          }
                        : undefined
                    }
                    aria-hidden="true"
                  />
                ))}
              </div>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-gray-500 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:text-[color:var(--color-text-secondary)]">
                {health.description}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ReceivablesComposition({
  summary,
  loading,
}: {
  summary: FinancialMetricSummary;
  loading: boolean;
}) {
  const total = Math.max(0, summary.received + summary.receivable + summary.overdue);
  const received = percentage(summary.received, total);
  const receivable = percentage(summary.receivable, total);
  const overdue = Math.max(0, Number((100 - received - receivable).toFixed(1)));
  const gradient =
    total > 0
      ? `conic-gradient(#5c2f91 0 ${received}%, #c4b5fd ${received}% ${received + receivable}%, #ef5350 ${received + receivable}% 100%)`
      : 'conic-gradient(#e2e8f0 0 100%)';

  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} min-w-0 overflow-hidden rounded-2xl bg-white shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="receivables-composition-title"
    >
      <DashboardCardHeader
        id="receivables-composition-title"
        title="Situação dos recebimentos"
        description="Participação de cada situação no valor acompanhado."
      />
      <div className="p-5">
        {loading ? (
          <div className="flex items-center gap-6">
            <Skeleton className="h-36 w-36 shrink-0 rounded-full" />
            <div className="flex-1 space-y-3">
              {[1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid items-center gap-6 sm:grid-cols-[9rem_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[9rem_minmax(0,1fr)]">
            <div
              className="relative mx-auto grid h-36 w-36 shrink-0 place-items-center rounded-full"
              style={{ background: gradient }}
              role="img"
              aria-label={`Recebido ${received}%, a receber ${receivable}% e em atraso ${overdue}%`}
            >
              <div className="grid h-[6.5rem] w-[6.5rem] place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(92,47,145,0.06)] alusa-dark:bg-[color:var(--color-bg-card)]">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400 alusa-dark:text-[color:var(--color-text-secondary)]">
                    Recebido
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-brand-primary alusa-dark:text-[color:var(--color-text-primary)]">
                    {formatReportMoney(summary.received)}
                  </p>
                </div>
              </div>
            </div>
            <dl className="w-full divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-subtle)]">
              <CompositionItem color="bg-brand-accent" label="Recebido" value={summary.received} />
              <CompositionItem color="bg-violet-300" label="A receber" value={summary.receivable} />
              <CompositionItem color="bg-[#ef5350]" label="Em atraso" value={summary.overdue} />
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

function CompositionItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex min-h-12 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', color)} aria-hidden="true" />
      <dt className="min-w-0 flex-1 text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
        {label}
      </dt>
      <dd className="text-sm font-semibold tabular-nums text-brand-primary alusa-dark:text-[color:var(--color-text-primary)]">
        {formatReportMoney(value)}
      </dd>
    </div>
  );
}

function AcademicContext({
  data,
  loading,
}: {
  data: FinancialOverviewReport | null;
  loading: boolean;
}) {
  const classRanking = data?.rankingByClass ?? [];
  const planRanking = data?.rankingByPlan ?? [];
  const strongestClass = [...classRanking].sort((a, b) => b.received - a.received)[0];
  const riskClass = [...classRanking].sort((a, b) => b.delinquencyRate - a.delinquencyRate)[0];
  const strongestPlan = [...planRanking].sort((a, b) => b.received - a.received)[0];

  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} h-full overflow-hidden rounded-2xl bg-white shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="academic-context-title"
    >
      <DashboardCardHeader
        id="academic-context-title"
        title="Contexto educacional"
        description="Como turmas e planos participam do resultado financeiro."
      />
      <div className="p-5">
        {loading ? (
          <div className="space-y-2.5">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-14 w-full" />
            ))}
          </div>
        ) : classRanking.length === 0 && planRanking.length === 0 ? (
          <p className="grid min-h-32 place-items-center text-sm text-gray-500">
            Sem dados acadêmicos suficientes neste período.
          </p>
        ) : (
          <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-subtle)]">
            <AcademicItem
              label="Turma com maior recebimento"
              name={strongestClass?.name}
              value={strongestClass ? formatReportMoney(strongestClass.received) : '—'}
            />
            <AcademicItem
              label="Turma com maior inadimplência"
              name={riskClass?.name}
              value={riskClass ? `${riskClass.delinquencyRate.toLocaleString('pt-BR')}%` : '—'}
              danger={Boolean(riskClass?.delinquencyRate)}
            />
            <AcademicItem
              label="Plano com maior recebimento"
              name={strongestPlan?.name}
              value={strongestPlan ? formatReportMoney(strongestPlan.received) : '—'}
            />
          </dl>
        )}
      </div>
    </section>
  );
}

function ClassOccupancyCard({
  data,
  loading,
}: {
  data: FinancialOverviewReport | null;
  loading: boolean;
}) {
  const occupancy = data?.classOccupancy ?? [];
  const totalCapacity = occupancy.reduce((total, item) => total + item.capacity, 0);
  const totalOccupied = occupancy.reduce((total, item) => total + item.occupiedSeats, 0);
  const averageOccupancy = percentage(totalOccupied, totalCapacity);
  const visibleClasses = occupancy.slice(0, 5);

  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="class-occupancy-title"
    >
      <DashboardCardHeader
        id="class-occupancy-title"
        title="Ocupação das turmas"
        description="Vagas atualmente ocupadas nas turmas ativas."
      />
      <div className="flex flex-1 flex-col p-5">
        {loading ? (
          <div className="flex flex-1 flex-col">
            <div className="space-y-4">
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-8 w-full" />
              ))}
            </div>
            <Skeleton className="mt-auto h-9 w-full border-t border-slate-100 pt-3" />
          </div>
        ) : visibleClasses.length === 0 ? (
          <p className="grid min-h-52 flex-1 place-items-center text-sm text-gray-500">
            Nenhuma turma ativa encontrada.
          </p>
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="space-y-4">
              {visibleClasses.map((item) => (
                <div key={item.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-gray-700 alusa-dark:text-[color:var(--color-text-primary)]">
                      {item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                      {item.occupiedSeats}/{item.capacity}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eee7f7] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                    <div
                      className="h-full rounded-full bg-brand-accent"
                      style={{ width: `${Math.min(100, item.occupancyRate)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p
              className="mt-auto border-t border-slate-100 pt-3 text-xs leading-5 text-gray-500 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:text-[color:var(--color-text-secondary)]"
              aria-label={`A ocupação está em ${averageOccupancy.toLocaleString('pt-BR')}% das vagas disponíveis`}
            >
              A ocupação está em{' '}
              <span className="font-medium tabular-nums text-gray-700 alusa-dark:text-[color:var(--color-text-primary)]">
                {averageOccupancy.toLocaleString('pt-BR')}%
              </span>{' '}
              das vagas disponíveis.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function AcademicItem({
  label,
  name,
  value,
  danger,
}: {
  label: string;
  name?: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[11px] leading-4 text-gray-400">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium leading-5 text-gray-800 alusa-dark:text-[color:var(--color-text-primary)]">
          {name ?? 'Não identificado'}
        </dd>
      </div>
      <dd
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          danger
            ? 'text-[#d93f47] alusa-dark:text-red-400'
            : 'text-brand-primary alusa-dark:text-[color:var(--color-text-primary)]',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function AttentionPoints({
  summary,
  data,
  loading,
}: {
  summary: FinancialMetricSummary;
  data: FinancialOverviewReport | null;
  loading: boolean;
}) {
  const cost = summary.fees + summary.refunds;
  const riskClass = [...(data?.rankingByClass ?? [])].sort((a, b) => b.overdue - a.overdue)[0];

  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="attention-points-title"
    >
      <DashboardCardHeader
        id="attention-points-title"
        title="Pontos de atenção"
        description="Sinais objetivos que merecem acompanhamento da gestão."
      />
      <div className="flex flex-1 flex-col p-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <AttentionItem
              tone={summary.overdue > 0 ? 'danger' : 'success'}
              title={
                summary.overdue > 0
                  ? `${formatReportMoney(summary.overdue)} ainda estão em atraso`
                  : 'Nenhum valor em atraso no período'
              }
              description={
                summary.overdue > 0
                  ? `${summary.overdueCount} cobranças precisam de acompanhamento.`
                  : 'A instituição não possui cobranças vencidas dentro do recorte.'
              }
              href={summary.overdue > 0 ? '/financeiro/cobrancas?statusView=overdue' : undefined}
            />
            <AttentionItem
              tone={cost > 0 ? 'neutral' : 'success'}
              title={`${formatReportMoney(cost)} consumidos por taxas e estornos`}
              description="Diferença entre o valor bruto recebido e o valor líquido."
            />
            {riskClass ? (
              <AttentionItem
                tone={riskClass.overdue > 0 ? 'warning' : 'success'}
                title={`${riskClass.name}: ${formatReportMoney(riskClass.overdue)} em atraso`}
                description="Maior exposição ao atraso entre as turmas do período."
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function AttentionItem({
  tone,
  title,
  description,
  href,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  title: string;
  description: string;
  href?: string;
}) {
  const colors = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    neutral: 'bg-brand-accent',
  };
  const content = (
    <div
      className={cn(
        'flex min-h-[72px] items-start gap-3 rounded-xl border border-slate-100 p-4 alusa-dark:border-[color:var(--color-border-default)]',
        href &&
          'transition-colors hover:bg-slate-50 alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]',
      )}
    >
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', colors[tone])}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          {title}
        </p>
        <p className="mt-1 text-xs leading-4 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      {href ? (
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      ) : null}
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30"
    >
      {content}
    </Link>
  ) : (
    content
  );
}

const QUICK_REPORTS = [
  {
    title: 'Cobranças em atraso',
    description: 'Acompanhe responsáveis e valores vencidos.',
    href: '/financeiro/cobrancas?statusView=overdue',
  },
  {
    title: 'Pagamentos por aluno',
    description: 'Consulte o histórico financeiro acadêmico.',
    href: '/financeiro/pagamentos',
  },
  {
    title: 'Extrato financeiro',
    description: 'Veja entradas, saídas e liquidações da conta.',
    href: '/financeiro/extrato',
  },
  {
    title: 'Resultado de eventos',
    description: 'Analise vendas e desempenho dos eventos.',
    href: '/eventos/relatorios',
  },
] as const;

function QuickReports() {
  return (
    <section
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-white p-5 shadow-none alusa-dark:bg-[color:var(--color-bg-card)]`}
      aria-labelledby="quick-reports-title"
    >
      <SectionHeading
        id="quick-reports-title"
        title="Relatórios rápidos"
        description="Continue a análise nos recortes mais usados pela gestão."
        compact
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK_REPORTS.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="group flex min-h-24 flex-col justify-between rounded-xl border border-slate-100 p-4 transition-colors hover:bg-[#f4ecfd]/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/30 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:hover:bg-[color:var(--color-bg-card-soft)]"
          >
            <div>
              <h3 className="text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                {report.title}
              </h3>
              <p className="mt-1 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                {report.description}
              </p>
            </div>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-accent">
              Abrir relatório
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DataCoverage() {
  return (
    <aside
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-slate-50/70 p-5 shadow-none alusa-dark:bg-[color:var(--color-bg-card-soft)]`}
      aria-labelledby="data-coverage-title"
    >
      <div className="flex items-start gap-3">
        <InfoCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-accent" aria-hidden="true" />
        <div>
          <h2
            id="data-coverage-title"
            className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]"
          >
            Lucro e prejuízo dependem do cadastro completo de despesas
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            Este painel mede cobranças, recebimentos, inadimplência, taxas e estornos. Folha,
            aluguel, fornecedores, impostos e demais custos operacionais ainda não compõem este
            relatório; por isso, o valor líquido exibido não deve ser interpretado como lucro.
          </p>
        </div>
      </div>
    </aside>
  );
}

function DashboardCardHeader({
  id,
  title,
  description,
  end,
}: {
  id: string;
  title: string;
  description: string;
  end?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-[76px] items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/40 px-5 py-4 alusa-dark:border-[color:var(--color-border-subtle)] alusa-dark:bg-[color:var(--color-bg-card-soft)]">
      <div className="min-w-0">
        <h2
          id={id}
          className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]"
        >
          {title}
        </h2>
        <p className="mt-1 text-xs leading-4 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      {end ? <div className="shrink-0">{end}</div> : null}
    </header>
  );
}

function SectionHeading({
  id,
  title,
  description,
  compact,
}: {
  id: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <header>
      <h2
        id={id}
        className={cn(
          'font-semibold tracking-tight text-gray-950 alusa-dark:text-[color:var(--color-text-primary)]',
          compact ? 'text-base' : 'text-lg',
        )}
      >
        {title}
      </h2>
      <p className="mt-1 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
        {description}
      </p>
    </header>
  );
}
