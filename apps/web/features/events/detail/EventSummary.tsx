'use client';

import { BarChart3, CircleDollarSign, Shirt, Ticket, WalletCards } from 'lucide-react';

import { formatCurrency, type SchoolEventDTO } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';

export function EventSummary({ event }: { event: SchoolEventDTO }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Receita prevista" value={formatCurrency(event.metrics.receitaPrevista)} icon={CircleDollarSign} tone="info" />
        <MetricCard label="Receita recebida" value={formatCurrency(event.metrics.receitaRealizada)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Custos previstos" value={formatCurrency(event.metrics.custoPrevisto)} icon={WalletCards} tone="warning" />
        <MetricCard label="Resultado realizado" value={formatCurrency(event.metrics.resultadoRealizado)} icon={BarChart3} tone={event.metrics.resultadoRealizado >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Lucro estimado" value={formatCurrency(event.metrics.resultadoPrevisto)} icon={BarChart3} tone={event.metrics.resultadoPrevisto >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Ingressos vendidos" value={event.metrics.ingressosVendidos} icon={Ticket} />
        <MetricCard label="Figurinos pendentes" value={event.metrics.figurinosPendentes} icon={Shirt} tone="warning" />
        <MetricCard label="Ticket médio" value={event.metrics.ticketMedio == null ? '-' : formatCurrency(event.metrics.ticketMedio)} icon={Ticket} />
        <MetricCard label="Taxa de ocupação" value={event.metrics.taxaOcupacao == null ? '-' : `${Math.round(event.metrics.taxaOcupacao * 100)}%`} icon={BarChart3} />
      </div>
    </div>
  );
}
