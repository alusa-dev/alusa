'use client';

import { BarChart3, CalendarDays, CircleDollarSign, ClipboardList, WalletCards } from 'lucide-react';

import { formatCurrency, type EventListResult, type SchoolEventDTO } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';

export function EventsKpis({ events, summary }: { events: SchoolEventDTO[]; summary?: EventListResult['summary'] }) {
  const active = summary?.active ?? events.filter((event) => event.status === 'ACTIVE').length;
  const planning = summary?.planning ?? events.filter((event) => event.status === 'PLANNING').length;
  const revenue = summary?.receitaRealizada ?? events.reduce((sum, event) => sum + event.metrics.receitaRealizada, 0);
  const cost = summary?.custoRealizado ?? events.reduce((sum, event) => sum + event.metrics.custoRealizado, 0);
  const result = events.reduce((sum, event) => sum + event.metrics.resultadoRealizado, 0);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Eventos ativos" value={active} icon={CalendarDays} tone="success" />
      <MetricCard label="Em planejamento" value={planning} icon={ClipboardList} tone="info" />
      <MetricCard label="Receita realizada" value={formatCurrency(revenue)} icon={CircleDollarSign} tone="success" />
      <MetricCard label="Custos pagos" value={formatCurrency(cost)} icon={WalletCards} tone="warning" />
      <MetricCard label="Resultado realizado" value={formatCurrency(result)} icon={BarChart3} tone={result >= 0 ? 'success' : 'danger'} />
    </div>
  );
}
