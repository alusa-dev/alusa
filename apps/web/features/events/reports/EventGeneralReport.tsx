'use client';

import Link from 'next/link';
import { BarChart3, CircleDollarSign, Ticket, WalletCards } from 'lucide-react';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, type EventReportsDTO, type SchoolEventDTO } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';

export function EventGeneralReport({ data, loading }: { data?: EventReportsDTO; loading: boolean }) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Receita total" value={formatCurrency(data?.general.receita ?? 0)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Custo total" value={formatCurrency(data?.general.custo ?? 0)} icon={WalletCards} tone="warning" />
        <MetricCard label="Lucro total" value={formatCurrency(data?.general.resultado ?? 0)} icon={BarChart3} tone={(data?.general.resultado ?? 0) >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Ingressos vendidos" value={data?.general.ingressos ?? 0} icon={Ticket} />
      </div>
      <div className="mt-5">
        <DataTable
          columns={[
            { id: 'event', header: 'Evento', render: (event: SchoolEventDTO) => <Link href={'/events/' + event.id} className="font-medium text-slate-950 hover:text-brand-accent">{event.name}</Link> },
            { id: 'revenue', header: 'Receita', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.receitaRealizada) },
            { id: 'cost', header: 'Custo', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.custoRealizado) },
            { id: 'result', header: 'Resultado', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.resultadoRealizado) },
          ]}
          data={data?.general.ranking ?? []}
          rowKey={(event) => event.id}
          loading={loading}
        />
      </div>
    </>
  );
}
