'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { resolveActivePublishedEventMap } from '@alusa/domain/events';

import { listEventMaps } from '../map/api/event-map-service';
import { getEvent, listTicketLots, listTicketSales, type EventScopedResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { LotFormDialog } from './LotFormDialog';
import { SaleFormDialog } from './SaleFormDialog';
import { TicketLotsTable } from './TicketLotsTable';
import { TicketMetricsPanel } from './TicketMetricsPanel';
import { TicketReservationsTable } from './TicketReservationsTable';
import { TicketSalesTable } from './TicketSalesTable';

export function EventTicketsPanel({ eventId, scopedResources }: { eventId: string; scopedResources?: EventScopedResources }) {
  const eventQuery = useQuery({ queryKey: eventQueryKeys.event(eventId), queryFn: () => getEvent(eventId) });
  const lots = useQuery({ queryKey: eventQueryKeys.lots(eventId), queryFn: () => listTicketLots(eventId) });
  const sales = useQuery({ queryKey: eventQueryKeys.sales(eventId), queryFn: () => listTicketSales(eventId) });
  const mapsQuery = useQuery({
    queryKey: ['events', 'maps', eventId],
    queryFn: () => listEventMaps(eventId),
    enabled: (eventQuery.data?.ticketMode ?? 'SIMPLE') === 'NUMBERED_SEATS',
  });

  const event = eventQuery.data;
  const lotRows = lots.data ?? [];
  const saleRows = sales.data ?? [];
  const publishedMapId = resolveActivePublishedEventMap(mapsQuery.data ?? [])?.id ?? null;
  const manualSaleRows = saleRows.filter((sale) => sale.status !== 'RESERVED');
  const reservedRows = saleRows.filter((sale) => sale.status === 'RESERVED');
  const revenue = manualSaleRows.filter((sale) => sale.status === 'PAID').reduce((sum, sale) => sum + sale.totalAmount, 0);
  const pending = saleRows.filter((sale) => sale.status === 'PENDING' || sale.status === 'RESERVED').reduce((sum, sale) => sum + sale.totalAmount, 0);
  const complimentary = manualSaleRows.filter((sale) => sale.status === 'COMPLIMENTARY').reduce((sum, sale) => sum + sale.quantity, 0);

  return (
    <Tabs defaultValue="sales" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="reserved">Reservados</TabsTrigger>
          <TabsTrigger value="lots">Lotes</TabsTrigger>
          <TabsTrigger value="metrics">Métricas</TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <LotFormDialog
            eventId={eventId}
            ticketMode={event?.ticketMode ?? 'SIMPLE'}
            trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Lote</Button>}
          />
          {event ? (
            <SaleFormDialog
              eventId={eventId}
              event={event}
              lots={lotRows}
              scopedResources={scopedResources}
              publishedMapId={publishedMapId}
              trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Venda</Button>}
            />
          ) : null}
        </div>
      </div>
      <TabsContent value="sales">
        <TicketSalesTable sales={manualSaleRows} eventId={eventId} lots={lotRows} scopedResources={scopedResources} loading={sales.isLoading} />
      </TabsContent>
      <TabsContent value="reserved">
        <TicketReservationsTable reservations={reservedRows} eventId={eventId} lots={lotRows} scopedResources={scopedResources} loading={sales.isLoading} />
      </TabsContent>
      <TabsContent value="lots">
        <TicketLotsTable
          lots={lotRows}
          eventId={eventId}
          ticketMode={event?.ticketMode ?? 'SIMPLE'}
          loading={lots.isLoading}
        />
      </TabsContent>
      <TabsContent value="metrics">
        <TicketMetricsPanel revenue={revenue} pending={pending} sold={manualSaleRows.reduce((sum, sale) => sum + sale.quantity, 0)} complimentary={complimentary} />
      </TabsContent>
    </Tabs>
  );
}
