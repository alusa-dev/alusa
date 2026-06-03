'use client';

import { BarChart3, CircleDollarSign, ClipboardList, WalletCards } from 'lucide-react';

import { formatCurrency, type SchoolEventDTO } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';

export function EventDetailKpis({ event, participantsCount }: { event: SchoolEventDTO; participantsCount: number }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <MetricCard label="Alunos inscritos" value={participantsCount} icon={ClipboardList} tone="info" />
      <MetricCard label="Lucro Bruto" value={formatCurrency(event.metrics.lucroBrutoRealizado)} icon={CircleDollarSign} tone="success" />
      <MetricCard label="Lucro Líquido" value={formatCurrency(event.metrics.lucroLiquidoRealizado)} icon={BarChart3} tone={event.metrics.lucroLiquidoRealizado >= 0 ? 'success' : 'danger'} />
      <MetricCard label="Lucro Estimado" value={formatCurrency(event.metrics.resultadoPrevisto)} icon={BarChart3} tone={event.metrics.resultadoPrevisto >= 0 ? 'success' : 'danger'} />
      <MetricCard label="Custo do Evento" value={formatCurrency(event.metrics.custoRealizado)} icon={WalletCards} tone="warning" />
    </div>
  );
}
