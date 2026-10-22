'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { type SchoolEventStatus } from '@alusa/shared';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, XAxis, YAxis } from 'recharts';

import TableLayout from '@/components/layout/TableLayout';
import { ArrowLeft } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EventEmptyState } from '../shared/EventEmptyState';
import { formatCurrency, formatDate, getEventReportDetail } from '../events-service';
import { shouldRetryEventReportQuery } from './event-report-query';
import { buildEventReportRevenueRows, formatEventReportDateKey } from './event-report-view-model';
import { EventReportSection } from './EventReportSection';

type CategoryReportRow = { category: string; type: 'Receita' | 'Custo'; expected: number; realized: number };

const currency = (value: number) => formatCurrency(value);
const compactCurrency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
}).format(value);
const formatReportDay = formatEventReportDateKey;
const quantity = (value: number) => value.toLocaleString('pt-BR');
const quantityAxis = (maximum: number) => {
  const targetStep = Math.max(1, maximum / 5);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const multiplier = [1, 2, 5, 10].find((value) => value * magnitude >= targetStep) ?? 10;
  const step = multiplier * magnitude;
  const max = Math.max(step, Math.ceil(maximum / step) * step + step);
  return { max, ticks: Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => index * step) };
};
export const getEventTimelineCurrencyAxis = (maximum: number) => {
  const targetStep = Math.max(1, maximum / 5);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const multiplier = [1, 2, 5, 10].find((value) => value * magnitude >= targetStep) ?? 10;
  const step = multiplier * magnitude;
  const max = Math.max(step, Math.ceil(maximum / step) * step);
  return { max, ticks: Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => index * step) };
};
const sectorChartColors = ['#5c2f91', '#8053aa', '#a17ac4', '#43236e', '#70429b', '#ba9bd4', '#633a8e', '#9270b4'];
function CategoryAxisTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: unknown } }) {
  const [session, sector] = String(payload?.value ?? '').split('\n');
  const shorten = (value: string, maxLength: number) => value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="end" fill="#71717a" fontSize={10}>
        <tspan x={-8} dy="-0.2em">{shorten(session, 24)}</tspan>
        {sector ? <tspan x={-8} dy="1.25em" fill="#27272a" fontSize={11} fontWeight={500}>{shorten(sector, 24)}</tspan> : null}
      </text>
    </g>
  );
}
const salesChartConfig = {
  amount: { label: 'Receita líquida', color: '#5c2f91' },
} satisfies ChartConfig;
const ticketChartConfig = {
  quantity: { label: 'Ingressos pagos', color: 'var(--brand-accent)' },
} satisfies ChartConfig;
const occupancyChartConfig = {
  occupancy: { label: 'Inscrições', color: '#5c2f91' },
} satisfies ChartConfig;

type EventLifecycleGroup = 'ongoing' | 'closed' | 'cancelled';

function getEventLifecycleGroup(status: SchoolEventStatus): EventLifecycleGroup {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'FINISHED' || status === 'ARCHIVED') return 'closed';
  return 'ongoing';
}

function getEventStatusLabel(status: SchoolEventStatus) {
  switch (status) {
    case 'DRAFT': return 'Rascunho';
    case 'PLANNING': return 'Em planejamento';
    case 'ACTIVE': return 'Em andamento';
    case 'FINISHED': return 'Finalizado';
    case 'CANCELLED': return 'Cancelado';
    case 'ARCHIVED': return 'Arquivado';
  }
}

function getEventReportCopy(status: SchoolEventStatus) {
  const group = getEventLifecycleGroup(status);
  const isPreEvent = status === 'DRAFT' || status === 'PLANNING';
  if (group === 'cancelled') {
    return {
      participationTitle: 'Como ficaram as inscrições dos alunos?',
      noActiveParticipants: 'O cadastro atual não registra alunos com inscrição ativa para este evento cancelado.',
      revenueTitle: 'Registros financeiros do evento cancelado',
      revenueIntro: 'Este evento cancelado registra',
      revenueExpectation: 'em receitas previstas.',
      revenueStillPending: 'permanecem pendentes de pagamento.',
      revenueNoRefunds: 'Não há valores estornados registrados.',
      revenueSourceTitle: 'Origem das receitas registradas',
      ticketTitle: 'Ingressos do evento cancelado',
      ticketStatusTitle: 'Vendas registradas no evento cancelado',
      noTicketPayments: 'Não há pagamentos de ingressos registrados para este evento cancelado.',
      noPaidTicketsBySession: 'Não há ingressos pagos por sessão ou setor registrados para este evento cancelado.',
      noPaidTicketOrigins: 'Não há ingressos pagos para comparar as origens neste evento cancelado.',
      lotsTitle: 'Vendas registradas e lotes',
      noLots: 'O evento cancelado não tem lotes cadastrados.',
      checkInTitle: 'Check-ins registrados no evento cancelado',
      noCheckIns: 'Nenhum check-in foi registrado para ingressos válidos.',
      noCategories: 'Não há lançamentos categorizados registrados para este evento cancelado.',
      timelineTitle: 'Como as vendas ocorreram?',
    };
  }
  if (group === 'closed') {
    return {
      participationTitle: 'Como ficaram as inscrições dos alunos?',
      noActiveParticipants: 'O cadastro atual não registra alunos com inscrição ativa para este evento.',
      revenueTitle: 'Receitas e resultado do evento encerrado',
      revenueIntro: 'O relatório do evento encerrado registra',
      revenueExpectation: 'em receitas previstas.',
      revenueStillPending: 'seguem pendentes de pagamento.',
      revenueNoRefunds: 'Não há valores estornados registrados.',
      revenueSourceTitle: 'Origem das receitas registradas',
      ticketTitle: 'Ingressos registrados',
      ticketStatusTitle: 'Vendas registradas no evento',
      noTicketPayments: 'Não foram registrados pagamentos de ingressos neste evento.',
      noPaidTicketsBySession: 'Não foram registrados ingressos pagos por sessão ou setor.',
      noPaidTicketOrigins: 'Não foram registrados ingressos pagos para comparar as origens.',
      lotsTitle: 'Vendas registradas e lotes',
      noLots: 'Este evento foi encerrado sem lotes cadastrados.',
      checkInTitle: 'Check-ins registrados no evento',
      noCheckIns: 'Nenhum check-in foi registrado para ingressos válidos.',
      noCategories: 'Não há lançamentos categorizados registrados para este evento encerrado.',
      timelineTitle: 'Como as vendas ocorreram?',
    };
  }
  return {
    participationTitle: 'Como estão as inscrições dos alunos?',
    noActiveParticipants: 'Ainda não há alunos com inscrição ativa registrada neste evento.',
    revenueTitle: isPreEvent ? 'Previsão de receitas e resultado' : 'Receitas e resultado',
    revenueIntro: isPreEvent ? 'O planejamento registra' : 'O evento tem',
    revenueExpectation: 'em receitas previstas.',
    revenueStillPending: 'ainda aguardam pagamento.',
    revenueNoRefunds: 'Até agora, não há valores estornados.',
    revenueSourceTitle: 'De onde vêm as receitas?',
    ticketTitle: isPreEvent ? 'Ingressos e lotes planejados' : 'Bilheteria e ingressos',
    ticketStatusTitle: isPreEvent ? 'Ingressos registrados no planejamento' : 'Ingressos vendidos e disponíveis',
    noTicketPayments: 'Ainda não há pagamentos de ingressos para mostrar a evolução das vendas.',
    noPaidTicketsBySession: 'Ainda não há ingressos pagos por sessão ou setor.',
    noPaidTicketOrigins: 'Ainda não há ingressos pagos para comparar as origens.',
    lotsTitle: isPreEvent ? 'Sessões, mapas e lotes planejados' : 'Ritmo de vendas de ingressos e lotes',
    noLots: 'Este evento ainda não possui lotes cadastrados.',
    checkInTitle: 'Check-ins registrados',
    noCheckIns: 'Nenhum check-in foi registrado para ingressos válidos.',
    noCategories: 'Ainda não há lançamentos categorizados para este evento.',
    timelineTitle: isPreEvent ? 'Vendas registradas até agora' : 'Como as vendas evoluem?',
  };
}

function Money({ value, tone }: { value: number; tone?: 'default' | 'positive' | 'negative' | 'cost' | 'revenue' | 'aggregate' | 'received' | 'pending' }) {
  const toneClass = tone === 'negative' || tone === 'cost' || value < 0
      ? 'text-rose-700 alusa-dark:text-rose-400'
      : tone === 'positive' || tone === 'received'
        ? 'text-emerald-700 alusa-dark:text-emerald-400'
        : tone === 'pending'
        ? 'text-amber-700 alusa-dark:text-amber-400'
          : tone === 'revenue' || tone === 'aggregate'
            ? 'text-blue-700 alusa-dark:text-blue-400'
            : 'text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]';

  return <strong className={`font-semibold tabular-nums ${toneClass}`}>{currency(value)}</strong>;
}

function OccupancyRing({ participants, capacity }: { participants: number; capacity: number }) {
  const percentage = (participants / capacity) * 100;
  const percentageLabel = percentage > 0 && percentage < 0.1
    ? '<0,1%'
    : `${percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

  return (
    <figure className="flex shrink-0 flex-col items-center gap-2 text-center md:items-end md:text-right">
      <div className="relative h-32 w-32 rounded-full">
        <ChartContainer
          config={occupancyChartConfig}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full aspect-square [&_.recharts-radial-bar-background-sector]:!fill-gray-200 alusa-dark:[&_.recharts-radial-bar-background-sector]:!fill-gray-700"
        >
          <RadialBarChart
            data={[{ occupancy: Math.min(percentage, 100) }]}
            startAngle={90}
            endAngle={-270}
            innerRadius="78%"
            outerRadius="96%"
          >
            <PolarAngleAxis type="number" domain={[0, 100]} dataKey="occupancy" tick={false} />
            <RadialBar dataKey="occupancy" background={{ fill: '#e5e7eb' }} fill="var(--color-occupancy)" cornerRadius={8} />
          </RadialBarChart>
        </ChartContainer>
        <OccupancyPercentage percentageLabel={percentageLabel} />
      </div>
    </figure>
  );
}

function OccupancyPercentage({ percentageLabel }: { percentageLabel: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Ocupação: ${percentageLabel}`}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-transparent px-0 text-xl font-semibold tabular-nums text-gray-900 outline-none alusa-dark:text-[color:var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:ring-offset-2"
          >
                {percentageLabel}
          </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left leading-relaxed">
            Ocupação calculada dividindo as inscrições ativas pela capacidade estimada.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
  );
}

function EstimatedCapacityValue({ capacity }: { capacity: number }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:ring-offset-1">
            {quantity(capacity)} participantes
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-left leading-relaxed">
          Capacidade estimada do evento, usada como base para calcular a ocupação.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ReportFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-3 first:pt-0 last:pb-0">
      <p className="text-xs font-medium text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 text-sm leading-6 text-gray-800 alusa-dark:text-[color:var(--color-text-primary)]">{children}</p>
    </div>
  );
}

function EventReportLoading() {
  return (
    <TableLayout title="Relatório do evento" subtitle="Carregando as informações do evento." className="mx-auto w-full max-w-5xl pt-6 sm:pt-8">
      <div className="space-y-5">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="space-y-3 rounded-2xl bg-gray-50 p-6 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </TableLayout>
  );
}

export function EventReportDetail({ eventId }: { eventId: string }) {
  const { data: session, status: sessionStatus } = useSession();
  const contaId = session?.user?.contaId;
  const query = useQuery({
    queryKey: ['events', 'report-detail', contaId ?? null, eventId],
    queryFn: () => getEventReportDetail(eventId),
    enabled: sessionStatus === 'authenticated' && Boolean(contaId),
    retry: shouldRetryEventReportQuery,
  });

  if (sessionStatus === 'loading' || (sessionStatus === 'authenticated' && !contaId) || query.isLoading) return <EventReportLoading />;

  if (query.isError) {
    return (
      <TableLayout title="Relatório do evento" subtitle="Não foi possível consultar os dados deste evento." className="mx-auto w-full max-w-5xl pt-6 sm:pt-8">
        <EventReportSection id="report-error" title="Não foi possível abrir o relatório">
          <p role="alert" className="text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            Tente novamente. Se o problema continuar, volte à lista de relatórios e abra o evento outra vez.
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} className="mt-4">
            Tentar novamente
          </Button>
        </EventReportSection>
      </TableLayout>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <TableLayout title="Relatório do evento" subtitle="O evento não está disponível para esta conta." className="mx-auto w-full max-w-5xl pt-6 sm:pt-8">
        <EventEmptyState
          title="Evento não encontrado."
          description="Este evento pode ter sido removido ou não estar disponível para sua conta."
        />
      </TableLayout>
    );
  }

  const { event, totals } = data;
  const copy = getEventReportCopy(event.status);
  const statusLabel = getEventStatusLabel(event.status);
  const salesAreOpen = event.status === 'ACTIVE';
  const revenueRows = buildEventReportRevenueRows(totals);
  const categoryTotals = new Map<string, CategoryReportRow>();
  for (const item of data.categories) {
    const key = `${item.type}-${item.category}`;
    const current = categoryTotals.get(key) ?? {
      category: item.category,
      type: item.type === 'REVENUE' ? 'Receita' : 'Custo',
      expected: 0,
      realized: 0,
    };
    current.expected += item.expected;
    current.realized += item.realized;
    categoryTotals.set(key, current);
  }
  const categoryRows = [...categoryTotals.values()];

  const lotsBySession = [...data.lots.reduce((sessions, lot) => {
    const key = `${lot.mapId ?? lot.mapName ?? 'sem-mapa'}:${lot.mapStartsAt ?? ''}`;
    const session = sessions.get(key) ?? {
      key,
      label: `${lot.mapName ?? 'Sem mapa ou sessão'}${lot.mapStartsAt ? ` · ${formatDate(lot.mapStartsAt)}` : ''}`,
      lots: [],
    };
    session.lots.push(lot);
    sessions.set(key, session);
    return sessions;
  }, new Map<string, { key: string; label: string; lots: typeof data.lots }>()).values()];
  const salesOriginChartData = data.salesByOrigin.map((item) => ({
    label: item.source === 'MANUAL' ? 'Venda manual' : 'Mapa público',
    fullLabel: item.source === 'MANUAL' ? 'Venda manual' : 'Mapa público',
    quantity: item.quantity,
    share: item.share,
  }));
  const salesSectorChartData = data.salesBySessionSector.map((item) => ({
    ...item,
    label: [item.mapName ?? 'Sem sessão ou mapa', item.sectorName.replace(/^Sem setor · /, 'Lote · ')].join('\n'),
    fullLabel: [
      item.mapName ?? 'Sem sessão ou mapa',
      item.mapStartsAt ? formatDate(item.mapStartsAt) : null,
      item.sectorName,
    ].filter(Boolean).join(' · '),
  }));
  const salesSectorChartHeight = Math.max(200, salesSectorChartData.length * 52 + 56);
  const salesSectorAxis = quantityAxis(Math.max(0, ...salesSectorChartData.map((item) => item.quantity)));
  const salesOriginAxis = quantityAxis(Math.max(0, ...salesOriginChartData.map((item) => item.quantity)));
  const timelineAxis = getEventTimelineCurrencyAxis(Math.max(0, ...data.timeline.map((item) => item.amount)));

  return (
    <div className="mx-auto w-full max-w-5xl pt-6 sm:pt-8">
      <Link
        href="/events/reports"
        className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:text-[color:var(--color-text-primary)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Relatórios de eventos
      </Link>
      <TableLayout
        title={event.name}
        subtitle={[statusLabel, formatDate(event.startsAt), event.locationName].filter(Boolean).join(' · ')}
        className="w-full"
      >
        <div className="space-y-5">
      <EventReportSection
        id="report-participation"
        title={copy.participationTitle}
        className="!p-4 sm:!p-5"
        headerClassName="!mb-3"
      >
        <div className={`grid gap-4 ${event.estimatedCapacity && event.estimatedCapacity > 0 ? 'sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-stretch' : ''}`}>
          <div className={`flex min-w-0 max-w-xl flex-col gap-3 text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)] ${event.estimatedCapacity && event.estimatedCapacity > 0 ? 'sm:min-h-32 sm:justify-between' : ''}`}>
            {totals.activeStudentParticipants === 0 ? (
              <p>
                {copy.noActiveParticipants}
                {event.estimatedCapacity != null && event.estimatedCapacity > 0
                  ? <> A capacidade estimada é de <strong><EstimatedCapacityValue capacity={event.estimatedCapacity} /></strong>; a ocupação é calculada com base nessas inscrições.</>
                  : ' Sem capacidade estimada válida, não é possível calcular a proporção de inscrições.'}
              </p>
            ) : (
              <>
                <p>
                  Há <strong>{quantity(totals.activeStudentParticipants)}</strong> {totals.activeStudentParticipants === 1 ? 'aluno com inscrição ativa.' : 'alunos com inscrição ativa.'}
                  {event.estimatedCapacity != null && event.estimatedCapacity > 0
                    ? <> A capacidade estimada é de <strong><EstimatedCapacityValue capacity={event.estimatedCapacity} /></strong>; a ocupação é calculada com base nessas inscrições.</>
                    : ' Sem capacidade estimada válida, não é possível calcular a ocupação.'}
                </p>
                <div className="flex flex-wrap items-center justify-start gap-2 text-left" role="group" aria-label="Situação das inscrições">
                  <Badge variant="success" size="sm" className="gap-1.5 px-2.5 py-1.5 text-xs">
                    Quitadas <strong className="font-semibold">{quantity(totals.paidStudentParticipants)}</strong>
                  </Badge>
                  <Badge variant="warning" size="sm" title="No prazo ou sem vencimento informado" className="gap-1.5 px-2.5 py-1.5 text-xs">
                    Aguardando pagamento <strong className="font-semibold">{quantity(totals.pendingStudentParticipants)}</strong>
                  </Badge>
                  <Badge variant="destructive" size="sm" className="gap-1.5 px-2.5 py-1.5 text-xs">
                    Em atraso <strong className="font-semibold">{quantity(totals.overdueStudentParticipants)}</strong>
                  </Badge>
                  {totals.exemptStudentParticipants > 0 ? (
                    <Badge variant="neutral" size="sm" className="gap-1.5 px-2.5 py-1.5 text-xs">
                      Isentas ou sem cobrança <strong className="font-semibold">{quantity(totals.exemptStudentParticipants)}</strong>
                    </Badge>
                  ) : null}
                  {totals.closedStudentParticipants > 0 ? (
                    <Badge variant="neutral" size="sm" className="gap-1.5 px-2.5 py-1.5 text-xs">
                      Cobranças canceladas ou estornadas <strong className="font-semibold">{quantity(totals.closedStudentParticipants)}</strong>
                    </Badge>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {event.estimatedCapacity != null && event.estimatedCapacity > 0 ? (
            <div className="sm:-translate-y-5 sm:self-center">
              <OccupancyRing participants={totals.activeStudentParticipants} capacity={event.estimatedCapacity} />
            </div>
          ) : null}
        </div>
      </EventReportSection>
      <EventReportSection id="report-revenue" title={copy.revenueTitle}>
        <p className="mb-5 max-w-4xl text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
          {copy.revenueIntro} <Money value={totals.committedRevenue} tone="aggregate" /> {copy.revenueExpectation}{' '}
          <Money value={totals.receivedRevenue} tone="received" /> já foram recebidos e <Money value={totals.pendingCommittedRevenue} tone="pending" /> {copy.revenueStillPending}
          {totals.registrationRefunded + totals.ticketRefunded + totals.otherRevenueRefunded > 0
            ? <> Os estornos somam <Money value={totals.registrationRefunded + totals.ticketRefunded + totals.otherRevenueRefunded} tone="negative" />.</>
            : ` ${copy.revenueNoRefunds}`}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{copy.revenueSourceTitle}</h3>
            <div className="mt-3 space-y-3">
              {revenueRows.map((row) => (
                <ReportFact key={row.id} label={row.source}>
                  <span className="block space-y-0.5">
                    <span className="block"><Money value={row.planned} tone="revenue" /> previstos</span>
                    <span className="block"><Money value={row.received} tone="received" /> recebidos</span>
                    <span className="block"><Money value={row.pending} tone="pending" /> pendentes</span>
                    {row.id === 'registrations' ? (
                      <>
                        <span className="block">Valor original: <Money value={totals.registrationGross} tone="revenue" /></span>
                        <span className="block">Descontos: <Money value={totals.registrationDiscount} tone="negative" /></span>
                      </>
                    ) : null}
                    {row.refunded > 0 ? <span className="block"><Money value={row.refunded} tone="negative" /> estornados</span> : null}
                  </span>
                </ReportFact>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              O previsto da Bilheteria soma as vendas registradas ao valor potencial da venda de todos os ingressos disponíveis.
            </p>
          </div>

          <div className="rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Resultado após os custos</h3>
            <div className="mt-3 space-y-3">
              <ReportFact label="Custos previstos"><><Money value={totals.costsExpected} tone="cost" /> em compromissos válidos para o evento.</></ReportFact>
              <ReportFact label="Custos já pagos"><><Money value={totals.costsRealized} tone="cost" /> pagos, já considerando devoluções.</></ReportFact>
              <ReportFact label="Resultado previsto">
                <><Money value={totals.resultCommitted} tone={totals.resultCommitted >= 0 ? 'positive' : 'negative'} /> após receitas e custos previstos.</>
              </ReportFact>
              <ReportFact label="Resultado até agora">
                <><Money value={totals.resultRealized} tone={totals.resultRealized >= 0 ? 'positive' : 'negative'} /> considerando recebimentos líquidos e custos pagos.</>
              </ReportFact>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white/70 p-5 alusa-dark:bg-[color:var(--color-bg-card)]">
          <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Receitas e custos por categoria</h3>
          {categoryRows.length ? (
            <div className="mt-4">
              <div className="overflow-x-auto rounded-lg border border-gray-200 alusa-dark:border-[color:var(--color-border-default)]">
                <table className="w-full min-w-[620px] text-sm" aria-label="Receitas e despesas por categoria">
                  <thead className="bg-gray-50/80 text-xs font-medium text-gray-500 alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left">Nome</th>
                      <th scope="col" className="px-4 py-3 text-left">Categoria</th>
                      <th scope="col" className="px-4 py-3 text-right">Previsto</th>
                      <th scope="col" className="px-4 py-3 text-right">Realizado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/70 alusa-dark:divide-[color:var(--color-border-subtle)]">
                    {categoryRows.map((row) => (
                      <tr key={`${row.type}-${row.category}`}>
                        <th scope="row" className="px-4 py-3 text-left font-medium text-gray-800 alusa-dark:text-[color:var(--color-text-primary)]">{row.category}</th>
                        <td className="px-4 py-3">
                          <Badge
                            variant={row.type === 'Custo' ? 'destructive' : 'info'}
                            size="sm"
                            className={row.type === 'Custo'
                              ? '!border-0 !bg-rose-50 !text-rose-700 alusa-dark:!bg-rose-950/40 alusa-dark:!text-rose-300'
                              : undefined}
                          >
                            {row.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums"><Money value={row.expected} tone={row.type === 'Custo' ? 'cost' : 'revenue'} /></td>
                        <td className="px-4 py-3 text-right tabular-nums"><Money value={row.realized} tone={row.type === 'Custo' ? 'cost' : 'received'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{copy.noCategories}</p>
          )}
        </div>
      </EventReportSection>

      <EventReportSection id="report-operations" title={copy.ticketTitle}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{copy.ticketStatusTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              {`${quantity(totals.ticketPaidQuantity)} ingressos pagos, ${quantity(totals.ticketPendingQuantity)} pendentes e ${quantity(totals.ticketComplimentaryQuantity)} cortesias.`}
            </p>
            {salesAreOpen ? (
              <p className="mt-2 text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
                Restam {quantity(totals.availableTicketQuantity)} ingressos disponíveis.
              </p>
            ) : null}
          </div>
          <article
            id="report-presence"
            aria-labelledby="report-presence-title"
            className="min-w-0 rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]"
          >
            <h3 id="report-presence-title" className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
              {copy.checkInTitle}
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-700 alusa-dark:text-[color:var(--color-text-secondary)]">
              {totals.checkIns > 0
                ? `${quantity(totals.checkIns)} check-ins foram registrados para ingressos válidos.`
                : copy.noCheckIns}
            </p>
          </article>
        </div>
      </EventReportSection>

      <EventReportSection id="report-lots" title={copy.lotsTitle}>
        <div className="space-y-5">
          <div className="rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{copy.timelineTitle}</h3>
            {data.timeline.length ? (
              <>
                <p className="mt-1 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Receita líquida de ingressos por dia de pagamento.</p>
                <ChartContainer
                  config={salesChartConfig}
                  role="img"
                  aria-label={`Receita líquida diária de bilheteria para ${event.name}`}
                  className="mt-3 h-[240px] w-full aspect-auto rounded-lg bg-gray-100 px-3 py-3 text-gray-700 [&_.recharts-cartesian-axis-tick_text]:!fill-gray-600"
                >
                  <LineChart data={data.timeline} accessibilityLayer margin={{ top: 12, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#d1d5db" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                      tickFormatter={(value: string) => formatReportDay(value).slice(0, 5)}
                    />
                    <YAxis
                      width={58}
                      domain={[0, timelineAxis.max]}
                      ticks={timelineAxis.ticks}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={6}
                      tickFormatter={(value: number) => compactCurrency(value)}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          className="!border-[#c3a3eb] !bg-[#ebe3f4] !text-[#36274e] !opacity-100 [&_.text-muted-foreground]:!text-[#36274e]"
                          labelFormatter={(value) => formatReportDay(String(value))}
                          formatter={(value) => <span className="font-semibold tabular-nums text-[#36274e]">{currency(Number(value))}</span>}
                        />
                      }
                    />
                    <Line
                      dataKey="amount"
                      type="monotone"
                      stroke="var(--color-amount)"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: 'var(--color-amount)', strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#5c2f91' }}
                    />
                  </LineChart>
                </ChartContainer>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{copy.noTicketPayments}</p>
            )}
          </div>

          <div className="grid gap-4">
            <div className="min-w-0 rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
              <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Vendas por sessão e setor</h3>
                <p className="mt-1 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Cada barra mostra ingressos pagos registrados. A escala começa em zero e usa intervalos regulares para facilitar a comparação.</p>
              {salesSectorChartData.length ? (
                <div className="mt-3 max-h-[400px] overflow-y-auto">
                  <ChartContainer
                    config={ticketChartConfig}
                    role="img"
                    aria-label="Ingressos pagos por sessão e setor"
                    className="w-full aspect-auto rounded-lg bg-gray-100 p-3 text-gray-700 [&_.recharts-cartesian-axis-tick_text]:!fill-gray-600"
                    style={{ height: salesSectorChartHeight }}
                  >
                    <BarChart data={salesSectorChartData} layout="vertical" accessibilityLayer margin={{ top: 4, right: 36, left: 0, bottom: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#d9d4e0" strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        domain={[0, salesSectorAxis.max]}
                        ticks={salesSectorAxis.ticks}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        height={20}
                        tickMargin={4}
                        tick={{ fill: '#71717a', fontSize: 11 }}
                        tickFormatter={(value: number) => quantity(value)}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={180}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        tick={<CategoryAxisTick />}
                      />
                      <ChartTooltip
                        cursor={{ fill: 'rgba(92,47,145,0.08)' }}
                        content={
                          <ChartTooltipContent
                            className="!border-[#c3a3eb] !bg-[#ebe3f4] !text-[#36274e] !opacity-100 [&_.text-muted-foreground]:!text-[#36274e]"
                            labelFormatter={(_value, payload) => String(payload?.[0]?.payload?.fullLabel ?? _value)}
                            formatter={(value, _name, item) => (
                              <span className="font-semibold tabular-nums text-[#36274e]">
                                {quantity(Number(value))} ingressos · {Math.round(Number(item.payload?.share ?? 0) * 100)}% do total
                              </span>
                            )}
                          />
                        }
                      />
                      <Bar dataKey="quantity" fill="var(--color-quantity)" barSize={32} radius={4}>
                        {salesSectorChartData.map((item, index) => (
                          <Cell key={`${item.fullLabel}-${index}`} fill={sectorChartColors[index % sectorChartColors.length]} />
                        ))}
                        <LabelList dataKey="quantity" position="right" formatter={(value: number) => quantity(value)} fill="#36274e" fontSize={11} />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{copy.noPaidTicketsBySession}</p>
              )}
            </div>

            <div className="min-w-0 w-full rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
              <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Origem das vendas registradas</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Comparação por quantidade de ingressos pagos, sem pendências ou cortesias.</p>
              {totals.ticketPaidQuantity > 0 ? (
                <ChartContainer config={ticketChartConfig} role="img" aria-label="Ingressos pagos por venda manual e mapa público" className="mt-3 h-[180px] w-full aspect-auto rounded-lg bg-gray-100 px-3 py-0 text-gray-700 [&_.recharts-cartesian-axis-tick_text]:!fill-gray-600">
                  <BarChart data={salesOriginChartData} layout="vertical" accessibilityLayer margin={{ top: 4, right: 36, left: 0, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#d9d4e0" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      domain={[0, salesOriginAxis.max]}
                      ticks={salesOriginAxis.ticks}
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      height={20}
                      tickMargin={4}
                      tick={{ fill: '#71717a', fontSize: 11 }}
                      tickFormatter={(value: number) => quantity(value)}
                    />
                    <YAxis type="category" dataKey="label" width={116} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <ChartTooltip
                      cursor={{ fill: 'rgba(92,47,145,0.08)' }}
                      content={
                        <ChartTooltipContent
                            className="!border-[#c3a3eb] !bg-[#ebe3f4] !text-[#36274e] !opacity-100 [&_.text-muted-foreground]:!text-[#36274e]"
                          labelFormatter={(value) => String(value)}
                          formatter={(value, _name, item) => (
                            <span className="font-semibold tabular-nums text-[#36274e]">
                              {quantity(Number(value))} ingressos · {Math.round(Number(item.payload?.share ?? 0) * 100)}% do total
                            </span>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="quantity" fill="var(--color-quantity)" barSize={36} radius={4}>
                      {salesOriginChartData.map((item, index) => (
                        <Cell key={`${item.label}-${index}`} fill={index === 0 ? '#5c2f91' : '#a17ac4'} />
                      ))}
                      <LabelList dataKey="quantity" position="right" formatter={(value: number) => quantity(value)} fill="#36274e" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="mt-3 text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{copy.noPaidTicketOrigins}</p>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-white/70 p-4 alusa-dark:bg-[color:var(--color-bg-card)]">
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Sessões, mapas e lotes cadastrados</h3>
            {data.lots.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {lotsBySession.map((session) => (
                  <div key={session.key} className="min-w-0 rounded-lg bg-gray-100 p-4 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                    <h4 className="text-xs font-semibold text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">{session.label}</h4>
                    <div className="mt-2 divide-y divide-gray-100 alusa-dark:divide-[color:var(--color-border-subtle)]">
                      {session.lots.map((lot) => (
                        <div key={lot.id} className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{lot.name}</p>
                            <p className="mt-0.5 text-xs leading-5 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                              {salesAreOpen
                                ? `${quantity(lot.sold)} de ${quantity(lot.total)} vendidos · ${quantity(lot.available)} disponíveis`
                                : `${quantity(lot.sold)} de ${quantity(lot.total)} ingressos vendidos`}
                            </p>
                          </div>
                          {salesAreOpen && lot.available > 0 ? (
                            <p className="shrink-0 text-xs text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
                              Potencial <Money value={lot.available * lot.unitPrice} tone="aggregate" />
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">{copy.noLots}</p>
            )}
          </div>

        </div>
      </EventReportSection>
        </div>
      </TableLayout>
    </div>
  );
}
