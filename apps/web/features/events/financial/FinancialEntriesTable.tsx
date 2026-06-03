'use client';

import { EVENT_FINANCIAL_STATUS_LABELS } from '@alusa/shared';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, type FinancialEntryDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { FinanceActions } from './FinanceActions';
import { FINANCIAL_STATUS_TONES } from './financial-entry-ui';

export function FinancialEntriesTable({ entries, eventId, loading }: { entries: FinancialEntryDTO[]; eventId: string; loading: boolean }) {
  return (
    <TablePanel>
      <DataTable
        paginate={true}
        pageSize={5}
        columns={[
          {
            id: 'desc',
            header: 'Descrição',
            width: 'w-[27%]',
            align: 'left',
            noWrap: false,
            cellClassName: 'min-w-0',
            render: (entry: FinancialEntryDTO) => <span className="line-clamp-2 font-medium text-slate-950">{entry.description}</span>,
          },
          { id: 'category', header: 'Categoria', width: 'w-[15%]', align: 'left', render: (entry: FinancialEntryDTO) => <span className="text-slate-700">{entry.category}</span> },
          { id: 'expected', header: 'Previsto', width: 'w-[13%]', align: 'right', render: (entry: FinancialEntryDTO) => formatCurrency(entry.expectedAmount) },
          { id: 'actual', header: 'Realizado', width: 'w-[13%]', align: 'right', render: (entry: FinancialEntryDTO) => formatCurrency(entry.actualAmount ?? 0) },
          { id: 'status', header: 'Status', width: 'w-[12%]', align: 'center', render: (entry: FinancialEntryDTO) => <SoftBadge tone={FINANCIAL_STATUS_TONES[entry.status]}>{EVENT_FINANCIAL_STATUS_LABELS[entry.status]}</SoftBadge> },
          { id: 'origin', header: 'Origem', width: 'w-[10%]', align: 'center', render: (entry: FinancialEntryDTO) => entry.originType === 'MANUAL' ? 'Manual' : 'Automática' },
          { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (entry: FinancialEntryDTO) => <FinanceActions entry={entry} eventId={eventId} /> },
        ]}
        data={entries}
        rowKey={(entry) => entry.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhum lançamento registrado." description="Lance custos e receitas para acompanhar o resultado do evento." />}
      />
    </TablePanel>
  );
}
