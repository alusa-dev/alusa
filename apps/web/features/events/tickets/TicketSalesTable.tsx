'use client';

import { formatCurrency, formatDate, type EventScopedResources, type TicketLotDTO, type TicketSaleDTO } from '../events-service';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventPaginatedDataTable } from '../shared/EventPaginatedDataTable';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';
import { EventWhatsAppStatusIndicator } from '../shared/EventWhatsAppStatusIndicator';
import { TicketActions } from './TicketActions';
import { EXTENDED_TICKET_SALE_STATUS_LABELS, getTicketSaleFinancialSummary, getTicketSaleTone } from './ticket-sale-ui';

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
        {
          id: 'buyer',
          header: 'Comprador',
          width: 'w-[19%]',
          cellClassName: 'min-w-0',
          align: 'left',
          render: (sale: TicketSaleDTO) => (
            <div className="w-full min-w-0 overflow-hidden">
              <span className="block truncate font-medium text-slate-950" title={sale.buyerName}>
                {sale.buyerName}
              </span>
            </div>
          ),
        },
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
        { id: 'total', header: 'Total', width: 'w-[12%]', align: 'right', render: (sale: TicketSaleDTO) => {
          const financial = getTicketSaleFinancialSummary(sale);
          return financial.hasRefund ? (
            <div className="space-y-0.5 text-right tabular-nums">
              <span className="block text-xs text-slate-500">Bruto {formatCurrency(financial.grossAmount)}</span>
              <span className="block text-xs text-violet-700">Estornado {formatCurrency(financial.refundedAmount)}</span>
              <strong className="block font-semibold text-slate-900">Líquido {formatCurrency(financial.netAmount)}</strong>
            </div>
          ) : formatCurrency(financial.grossAmount);
        } },
        { id: 'status', header: 'Status', width: 'w-[12%]', align: 'center', render: (sale: TicketSaleDTO) => {
          const financial = getTicketSaleFinancialSummary(sale);
          return <SoftBadge tone={financial.label ? financial.tone : getTicketSaleTone(sale.status)}>{financial.label ?? EXTENDED_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge>;
        } },
        { id: 'whatsapp', header: 'WhatsApp', width: 'w-[13%]', align: 'center', render: (sale: TicketSaleDTO) => {
          return <EventWhatsAppStatusIndicator status={sale.whatsappStatus} />;
        } },
        { id: 'date', header: 'Venda', width: 'w-[10%]', align: 'left', render: (sale: TicketSaleDTO) => formatDate(sale.soldAt) },
        { id: 'actions', header: 'Ações', width: 'w-[11%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} lots={lots} scopedResources={scopedResources} /> },
      ]}
      data={sales}
      rowKey={(sale) => sale.id}
      loading={loading}
      emptyMessage={<EmptyState title="Nenhuma venda registrada." description="Registre vendas manuais vinculadas a um lote deste evento." />}
    />
  );
}
