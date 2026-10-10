'use client';

import { EVENT_FINANCIAL_STATUS_LABELS } from '@alusa/shared';

import { formatCurrency, type FinancialEntryDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventPaginatedDataTable } from '../shared/EventPaginatedDataTable';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { FinanceActions } from './FinanceActions';
import { FINANCIAL_STATUS_TONES, getFinancialOriginLabel } from './financial-entry-ui';

export function FinancialEntriesTable({ entries, eventId, loading, type }: { entries: FinancialEntryDTO[]; eventId: string; loading: boolean; type: FinancialEntryDTO['type'] }) {
  const isCostList = type === 'COST';

  return (
    <EventPaginatedDataTable
      columns={[
        {
          id: 'desc',
          header: 'Descrição',
          width: isCostList ? 'w-[24%]' : 'w-[23%]',
          align: 'left',
          noWrap: false,
          cellClassName: 'min-w-0',
          render: (entry: FinancialEntryDTO) => <span className="line-clamp-2 font-medium text-slate-950">{entry.description}</span>,
        },
        { id: 'category', header: 'Categoria', width: isCostList ? 'w-[14%]' : 'w-[13%]', align: 'left', render: (entry: FinancialEntryDTO) => <span className="text-slate-700">{entry.category}</span> },
        ...(!isCostList ? [
          { id: 'expected', header: 'Previsto', width: 'w-[12%]', align: 'right' as const, render: (entry: FinancialEntryDTO) => formatCurrency(entry.expectedAmount) },
          { id: 'discount', header: 'Desconto', width: 'w-[10%]', align: 'right' as const, render: (entry: FinancialEntryDTO) => entry.discountAmount ? formatCurrency(entry.discountAmount) : '-' },
        ] : []),
        {
          id: 'actual', header: isCostList ? 'Pago / Restante' : 'Realizado', width: isCostList ? 'w-[28%]' : 'w-[12%]', align: isCostList ? 'left' : 'right', noWrap: false,
          render: (entry: FinancialEntryDTO) => {
            const paid = entry.netAmount ?? entry.actualAmount ?? 0;
            if (!isCostList) return formatCurrency(paid);
            const percent = entry.expectedAmount > 0 ? Math.min(100, Math.round((paid / entry.expectedAmount) * 100)) : 0;
            const remaining = Math.max(0, entry.expectedAmount - paid);
            return (
              <div className="w-full max-w-[180px] space-y-1" aria-label={`${formatCurrency(paid)} pagos. Restam ${formatCurrency(remaining)}.`}>
                <div className="text-xs">
                  <span className="font-medium text-slate-900">{formatCurrency(paid)} <span className="font-normal text-slate-500">/ {formatCurrency(remaining)}</span></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Percentual do custo pago" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[#A94DFF] transition-[width] duration-300" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          },
        },
        { id: 'status', header: 'Status', width: isCostList ? 'w-[14%]' : 'w-[12%]', align: 'center', render: (entry: FinancialEntryDTO) => <SoftBadge tone={FINANCIAL_STATUS_TONES[entry.status]}>{EVENT_FINANCIAL_STATUS_LABELS[entry.status]}</SoftBadge> },
        { id: 'origin', header: 'Origem', width: isCostList ? 'w-[11%]' : 'w-[10%]', align: 'center', render: (entry: FinancialEntryDTO) => getFinancialOriginLabel(entry) },
        { id: 'actions', header: 'Ações', width: isCostList ? 'w-[9%]' : 'w-[8%]', align: 'right', render: (entry: FinancialEntryDTO) => <FinanceActions entry={entry} eventId={eventId} /> },
      ]}
      data={entries}
      rowKey={(entry) => entry.id}
      loading={loading}
      tableClassName={isCostList ? 'min-w-[900px]' : 'min-w-[1040px]'}
      emptyMessage={<EmptyState title="Nenhum lançamento registrado." description="Lance custos e receitas para acompanhar o resultado do evento." />}
    />
  );
}
