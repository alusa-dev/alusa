'use client';

import { EVENT_TYPE_LABELS } from '@alusa/shared';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, type EventReportsDTO } from '../events-service';

export function EventCompareReport({ data, loading }: { data?: EventReportsDTO; loading: boolean }) {
  return (
    <DataTable
      columns={[
        { id: 'name', header: 'Evento', render: (event: EventReportsDTO['events'][number]) => event.name },
        { id: 'type', header: 'Tipo', render: (event: EventReportsDTO['events'][number]) => EVENT_TYPE_LABELS[event.type] },
        { id: 'revenue', header: 'Receita', align: 'right', render: (event: EventReportsDTO['events'][number]) => formatCurrency(event.metrics.receitaRealizada) },
        { id: 'result', header: 'Resultado', align: 'right', render: (event: EventReportsDTO['events'][number]) => formatCurrency(event.metrics.resultadoRealizado) },
      ]}
      data={data?.events ?? []}
      rowKey={(event) => event.id}
      loading={loading}
    />
  );
}
