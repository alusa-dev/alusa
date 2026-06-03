'use client';

import DataTable from '@/components/layout/DataTable';

import { formatCurrency, formatDateTime, type EventResources, type TicketLotDTO, type TicketSaleDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { EventTablePanel as TablePanel } from '../shared/EventTablePanel';
import { TicketActions } from './TicketActions';
import { EXTENDED_TICKET_SALE_STATUS_LABELS, getTicketPaymentMethodLabel, getTicketSaleTone } from './ticket-sale-ui';

export function TicketReservationsTable({
  reservations,
  eventId,
  lots,
  resources,
  loading,
}: {
  reservations: TicketSaleDTO[];
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
          { id: 'buyer', header: 'Comprador', width: 'w-[24%]', align: 'left', render: (sale: TicketSaleDTO) => <span className="font-medium text-slate-950">{sale.buyerName}</span> },
          { id: 'lot', header: 'Lote', width: 'w-[18%]', align: 'left', render: (sale: TicketSaleDTO) => sale.lot.name },
          { id: 'qty', header: 'Qtd.', width: 'w-[10%]', align: 'right', render: (sale: TicketSaleDTO) => sale.quantity },
          { id: 'total', header: 'Total', width: 'w-[14%]', align: 'right', render: (sale: TicketSaleDTO) => formatCurrency(sale.totalAmount) },
          { id: 'method', header: 'Origem', width: 'w-[14%]', align: 'left', render: (sale: TicketSaleDTO) => getTicketPaymentMethodLabel(sale) },
          { id: 'status', header: 'Status', width: 'w-[10%]', align: 'center', render: (sale: TicketSaleDTO) => <SoftBadge tone={getTicketSaleTone(sale.status)}>{EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge> },
          { id: 'expires', header: 'Expira em', width: 'w-[12%]', align: 'left', render: (sale: TicketSaleDTO) => formatDateTime(sale.reservationExpiresAt ?? null) },
          { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} lots={lots} resources={resources} /> },
        ]}
        data={reservations}
        rowKey={(sale) => sale.id}
        loading={loading}
        emptyMessage={<EmptyState title="Nenhum ingresso reservado." description="As reservas aguardando pagamento aparecerão aqui." />}
      />
    </TablePanel>
  );
}
