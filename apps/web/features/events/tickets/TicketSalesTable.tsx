'use client';

import { formatCurrency, formatDate, type EventScopedResources, type TicketLotDTO, type TicketSaleDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventPaginatedDataTable } from '../shared/EventPaginatedDataTable';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { TicketActions } from './TicketActions';
import { EXTENDED_TICKET_SALE_STATUS_LABELS, getTicketSaleTone } from './ticket-sale-ui';

function getWhatsAppStatus(status: TicketSaleDTO['whatsappStatus']) {
  switch (status) {
    case 'PENDING':
    case 'QUEUED': return { label: 'Na fila', tone: 'info' as const };
    case 'PROCESSING': return { label: 'Enviando', tone: 'warning' as const };
    case 'SENT': return { label: 'Enviado', tone: 'success' as const };
    case 'DELIVERED': return { label: 'Entregue', tone: 'success' as const };
    case 'READ': return { label: 'Lida', tone: 'success' as const };
    case 'FAILED':
    case 'DLQ': return { label: 'Não enviado', tone: 'danger' as const };
    case 'SKIPPED': return { label: 'Não enviado', tone: 'neutral' as const };
    default: return { label: 'Sem envio', tone: 'neutral' as const };
  }
}

export function TicketSalesTable({
  sales,
  eventId,
  lots,
  scopedResources,
  loading,
}: {
  sales: TicketSaleDTO[];
  eventId: string;
  lots: TicketLotDTO[];
  scopedResources?: EventScopedResources;
  loading: boolean;
}) {
  return (
    <EventPaginatedDataTable
      columns={[
        { id: 'buyer', header: 'Comprador', width: 'w-[19%]', align: 'left', render: (sale: TicketSaleDTO) => <span className="font-medium text-slate-950">{sale.buyerName}</span> },
        {
          id: 'lot',
          header: 'Mapa/Lote',
          width: 'w-[15%]',
          align: 'left',
          render: (sale: TicketSaleDTO) => (
            <div className="min-w-0">
              <strong className="block truncate font-medium text-slate-950" title={sale.sessionName ?? undefined}>
                {sale.sessionName || 'Sem mapa'}
              </strong>
              <span className="block truncate text-xs text-slate-500" title={sale.lot.name}>
                {sale.lot.name}
              </span>
            </div>
          ),
        },
        { id: 'qty', header: 'Qtd.', width: 'w-[8%]', align: 'right', render: (sale: TicketSaleDTO) => sale.quantity },
        { id: 'total', header: 'Total', width: 'w-[12%]', align: 'right', render: (sale: TicketSaleDTO) => formatCurrency(sale.totalAmount) },
        { id: 'status', header: 'Status', width: 'w-[12%]', align: 'center', render: (sale: TicketSaleDTO) => <SoftBadge tone={getTicketSaleTone(sale.status)}>{EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge> },
        { id: 'whatsapp', header: 'WhatsApp', width: 'w-[13%]', align: 'center', render: (sale: TicketSaleDTO) => {
          const whatsapp = getWhatsAppStatus(sale.whatsappStatus);
          return <SoftBadge tone={whatsapp.tone}>{whatsapp.label}</SoftBadge>;
        } },
        { id: 'date', header: 'Data', width: 'w-[10%]', align: 'left', render: (sale: TicketSaleDTO) => formatDate(sale.soldAt) },
        { id: 'actions', header: 'Ações', width: 'w-[11%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} lots={lots} scopedResources={scopedResources} /> },
      ]}
      data={sales}
      rowKey={(sale) => sale.id}
      loading={loading}
      emptyMessage={<EmptyState title="Nenhuma venda registrada." description="Registre vendas manuais vinculadas a um lote deste evento." />}
    />
  );
}
