'use client';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, formatDate, type EventResources, type TicketLotDTO, type TicketSaleDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { TicketActions } from './TicketActions';
import { EXTENDED_TICKET_SALE_STATUS_LABELS, getTicketSaleTone } from './ticket-sale-ui';

export function TicketSalesTable({
  sales,
  eventId,
  lots,
  resources,
  loading,
}: {
  sales: TicketSaleDTO[];
  eventId: string;
  lots: TicketLotDTO[];
  resources?: EventResources;
  loading: boolean;
}) {
  return (
    <TablePanel>
      <DataTable
        paginate={true}
        pageSize={5}
        columns={[
          { id: 'buyer', header: 'Comprador', width: 'w-[22%]', align: 'left', render: (sale: TicketSaleDTO) => <span className="font-medium text-slate-950">{sale.buyerName}</span> },
          { id: 'lot', header: 'Lote', width: 'w-[16%]', align: 'left', render: (sale: TicketSaleDTO) => sale.lot.name },
          { id: 'qty', header: 'Qtd.', width: 'w-[9%]', align: 'right', render: (sale: TicketSaleDTO) => sale.quantity },
          { id: 'total', header: 'Total', width: 'w-[14%]', align: 'right', render: (sale: TicketSaleDTO) => formatCurrency(sale.totalAmount) },
          { id: 'status', header: 'Status', width: 'w-[14%]', align: 'center', render: (sale: TicketSaleDTO) => <SoftBadge tone={getTicketSaleTone(sale.status)}>{EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge> },
          { id: 'date', header: 'Data', width: 'w-[13%]', align: 'left', render: (sale: TicketSaleDTO) => formatDate(sale.soldAt) },
          { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} lots={lots} resources={resources} /> },
        ]}
        data={sales}
        rowKey={(sale) => sale.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhuma venda registrada." description="Registre vendas manuais vinculadas a um lote deste evento." />}
      />
    </TablePanel>
  );
}
