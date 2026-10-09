'use client';

import type { getCostumeReportMetrics } from '../costumes/costume-report-metrics';
import type { getTicketReportMetrics } from '../tickets/ticket-report-metrics';
import { formatCurrency, type SchoolEventDTO } from '../events-service';

type ValueTone = 'neutral' | 'positive' | 'negative';

const VALUE_TONE_CLASSES: Record<ValueTone, string> = {
  neutral: 'text-slate-800',
  positive: 'text-green-700',
  negative: 'text-red-700',
};

type ReportRow = { label: string; value: string | number; emphasis?: boolean; tone?: ValueTone };
type PublicOrdersSummary = {
  ordersTotal: number;
  waitingPayment: number;
  expired: number;
  issuing: number;
  issuanceFailed: number;
  completed: number;
  refunding: number;
  ticketsIssued: number;
  checkedIn: number;
};

function getResultTone(value: number | null): ValueTone {
  if (value == null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function ReportSection({ title, rows, tone = 'neutral' }: { title: string; rows: ReportRow[]; tone?: ValueTone }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase leading-5 tracking-[0.08em] text-slate-500">{title}</h3>
      <dl className="divide-y divide-dashed divide-slate-200 border-y border-dashed border-slate-200">
        {rows.map((row) => (
          <div key={row.label} className={`flex min-h-[44px] items-baseline justify-between gap-4 py-3 sm:gap-8 ${row.emphasis ? 'font-semibold text-slate-950' : ''}`}>
            <dt className={`min-w-0 text-sm leading-5 ${row.emphasis ? 'text-slate-900' : 'text-slate-600'}`}>{row.label}</dt>
            <dd className={`shrink-0 text-right text-sm leading-5 tabular-nums ${row.emphasis ? 'font-semibold' : 'font-medium'} ${VALUE_TONE_CLASSES[row.tone ?? tone]}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatPercent(value: number | null) {
  return value == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

export function EventReportSummary({
  event,
  participantsCount,
  costumeSummary,
  costumeSummaryLoading,
  costumeSummaryError,
  ticketSummary,
  ticketSummaryLoading,
  ticketSummaryError,
  publicOrdersSummary,
  publicOrdersSummaryLoading,
  publicOrdersSummaryError,
}: {
  event: SchoolEventDTO;
  participantsCount: number;
  costumeSummary: ReturnType<typeof getCostumeReportMetrics> | null;
  costumeSummaryLoading: boolean;
  costumeSummaryError: boolean;
  ticketSummary: ReturnType<typeof getTicketReportMetrics> | null;
  ticketSummaryLoading: boolean;
  ticketSummaryError: boolean;
  publicOrdersSummary: PublicOrdersSummary | null;
  publicOrdersSummaryLoading: boolean;
  publicOrdersSummaryError: boolean;
}) {
  const { metrics } = event;

  return (
    <div className="w-full space-y-8">
      <ReportSection
        title={event.hasTickets ? 'Público e capacidade' : 'Participação'}
        rows={[
          { label: 'Alunos inscritos', value: participantsCount },
          ...(event.hasTickets ? [
            { label: 'Ingressos disponíveis', value: metrics.ingressosDisponiveis },
            { label: 'Taxa de ocupação', value: formatPercent(metrics.taxaOcupacao) },
          ] : []),
        ]}
      />

      {event.hasTickets && (
        <div className="space-y-2">
          <ReportSection
            title="Pedidos online"
            rows={[
              { label: 'Pedidos registrados', value: publicOrdersSummary?.ordersTotal ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Aguardando pagamento', value: publicOrdersSummary?.waitingPayment ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Ingressos emitidos', value: publicOrdersSummary?.ticketsIssued ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Check-ins realizados', value: publicOrdersSummary?.checkedIn ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Emissão em andamento', value: publicOrdersSummary?.issuing ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Falha na emissão', value: publicOrdersSummary?.issuanceFailed ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…'), tone: publicOrdersSummary?.issuanceFailed ? 'negative' : 'neutral' },
              { label: 'Reservas expiradas', value: publicOrdersSummary?.expired ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Estornos em andamento', value: publicOrdersSummary?.refunding ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
              { label: 'Pedidos concluídos', value: publicOrdersSummary?.completed ?? (publicOrdersSummaryError ? 'Indisponível' : 'Carregando…') },
            ]}
          />
          {publicOrdersSummaryLoading && <p role="status" className="text-xs text-slate-500">Carregando resumo dos pedidos online…</p>}
          {publicOrdersSummaryError && <p role="alert" className="text-xs text-rose-700">Não foi possível carregar o resumo dos pedidos online.</p>}
          <ReportSection
            title="Bilheteria"
            rows={[
              { label: 'Ingressos vendidos', value: ticketSummary ? ticketSummary.sold : ticketSummaryError ? 'Indisponível' : 'Carregando…' },
              { label: 'Cortesias', value: ticketSummary ? ticketSummary.complimentary : ticketSummaryError ? 'Indisponível' : 'Carregando…' },
              { label: 'Ticket médio', value: metrics.ticketMedio == null ? '—' : formatCurrency(metrics.ticketMedio) },
              { label: 'Receita recebida', value: ticketSummary ? formatCurrency(ticketSummary.revenue) : ticketSummaryError ? 'Indisponível' : 'Carregando…', tone: ticketSummary ? getResultTone(ticketSummary.revenue) : 'neutral' },
              { label: 'Receita pendente', value: ticketSummary ? formatCurrency(ticketSummary.pending) : ticketSummaryError ? 'Indisponível' : 'Carregando…', tone: ticketSummary ? getResultTone(ticketSummary.pending) : 'neutral' },
            ]}
          />
          {ticketSummaryLoading && <p role="status" className="text-xs text-slate-500">Carregando indicadores da bilheteria…</p>}
          {ticketSummaryError && <p role="alert" className="text-xs text-rose-700">Não foi possível carregar os indicadores da bilheteria.</p>}
        </div>
      )}

      {event.hasCostumes && (
        <div className="space-y-2">
          <ReportSection
            title="Figurinos"
            rows={[
              { label: 'Inclusos na inscrição', value: costumeSummary ? costumeSummary.includedAssignmentsCount : costumeSummaryError ? 'Indisponível' : 'Carregando…' },
              { label: 'Pendentes', value: metrics.figurinosPendentes },
              { label: 'Entregues', value: metrics.figurinosEntregues },
              { label: 'Devolvidos', value: metrics.figurinosDevolvidos },
              { label: 'Custo dos figurinos', value: costumeSummary ? formatCurrency(costumeSummary.costumeCost) : costumeSummaryError ? 'Indisponível' : 'Carregando…', tone: costumeSummary ? 'negative' : 'neutral' },
              { label: 'Receita própria prevista', value: costumeSummary ? formatCurrency(costumeSummary.separateExpectedRevenue) : costumeSummaryError ? 'Indisponível' : 'Carregando…', tone: costumeSummary ? getResultTone(costumeSummary.separateExpectedRevenue) : 'neutral' },
              { label: 'Receita própria recebida', value: costumeSummary ? formatCurrency(costumeSummary.separateReceivedRevenue) : costumeSummaryError ? 'Indisponível' : 'Carregando…', tone: costumeSummary ? getResultTone(costumeSummary.separateReceivedRevenue) : 'neutral' },
            ]}
          />
          {costumeSummaryLoading && <p role="status" className="text-xs text-slate-500">Carregando indicadores de figurinos…</p>}
          {costumeSummaryError && <p role="alert" className="text-xs text-rose-700">Não foi possível carregar os indicadores financeiros de figurinos.</p>}
        </div>
      )}

      <ReportSection
        title="Receitas"
        tone="positive"
        rows={[
          { label: 'Receita bruta prevista', value: formatCurrency(metrics.receitaBrutaPrevista) },
          { label: 'Descontos previstos', value: formatCurrency(metrics.descontosPrevistos), tone: 'negative' },
          { label: 'Receita líquida prevista', value: formatCurrency(metrics.receitaPrevista) },
          { label: 'Recebido antes de estornos', value: formatCurrency(metrics.receitaRecebidaBruta) },
          { label: 'Valores estornados', value: formatCurrency(metrics.receitaEstornada), tone: 'negative' },
          { label: 'Receita recebida líquida', value: formatCurrency(metrics.receitaRecebidaLiquida), tone: getResultTone(metrics.receitaRecebidaLiquida) },
          { label: 'Saldo a receber', value: formatCurrency(metrics.saldoAReceber), tone: getResultTone(metrics.saldoAReceber) },
        ]}
      />

      <ReportSection
        title="Custos"
        tone="negative"
        rows={[
          { label: 'Custos diretos previstos', value: formatCurrency(metrics.custoDiretoPrevisto) },
          { label: 'Custos indiretos previstos', value: formatCurrency(metrics.custoIndiretoPrevisto) },
          { label: 'Taxas financeiras previstas', value: formatCurrency(metrics.taxasFinanceirasPrevistas) },
          { label: 'Impostos previstos', value: formatCurrency(metrics.impostosPrevistos) },
          { label: 'Custo total previsto', value: formatCurrency(metrics.custoPrevisto), emphasis: true },
          { label: 'Custos diretos realizados', value: formatCurrency(metrics.custoDiretoRealizado) },
          { label: 'Custos indiretos realizados', value: formatCurrency(metrics.custoIndiretoRealizado) },
          { label: 'Taxas financeiras realizadas', value: formatCurrency(metrics.taxasFinanceirasRealizadas) },
          { label: 'Impostos realizados', value: formatCurrency(metrics.impostosRealizados) },
          { label: 'Custo total realizado', value: formatCurrency(metrics.custoRealizado), emphasis: true },
        ]}
      />

      <ReportSection
        title="Resultado financeiro"
        rows={[
          { label: 'Lucro bruto previsto', value: formatCurrency(metrics.lucroBrutoPrevisto), tone: getResultTone(metrics.lucroBrutoPrevisto) },
          { label: 'Lucro líquido previsto', value: formatCurrency(metrics.lucroLiquidoPrevisto), tone: getResultTone(metrics.lucroLiquidoPrevisto) },
          { label: 'Lucro bruto realizado', value: formatCurrency(metrics.lucroBrutoRealizado), tone: getResultTone(metrics.lucroBrutoRealizado) },
          { label: 'Lucro líquido realizado', value: formatCurrency(metrics.lucroLiquidoRealizado), tone: getResultTone(metrics.lucroLiquidoRealizado) },
          { label: 'Margem realizada', value: formatPercent(metrics.margemRealizada), tone: getResultTone(metrics.margemRealizada) },
        ]}
      />

      <ReportSection
        title="Fechamento financeiro"
        rows={[
          { label: 'Receita recebida líquida', value: formatCurrency(metrics.receitaRecebidaLiquida), tone: getResultTone(metrics.receitaRecebidaLiquida) },
          { label: 'Custos realizados', value: formatCurrency(metrics.custoRealizado), tone: 'negative' },
          { label: 'Saldo a receber', value: formatCurrency(metrics.saldoAReceber), tone: getResultTone(metrics.saldoAReceber) },
          { label: 'Resultado líquido realizado', value: formatCurrency(metrics.resultadoRealizado), emphasis: true, tone: getResultTone(metrics.resultadoRealizado) },
        ]}
      />
    </div>
  );
}
