'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Plus } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { listEventMaps } from '../map/api/event-map-service';
import type { EventMapDTO } from '../map/api/event-map-service';
import { getEvent, listEventCheckIns, listTicketLots, listTicketSales, type EventScopedResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { LotFormDialog } from './LotFormDialog';
import { SaleFormDialog } from './SaleFormDialog';
import { TicketLotsTable } from './TicketLotsTable';
import { TicketReservationsTable } from './TicketReservationsTable';
import { TicketSalesTable } from './TicketSalesTable';
import { EventCheckInsTable } from './EventCheckInsTable';

export function EventTicketsPanel({ eventId, scopedResources }: { eventId: string; scopedResources?: EventScopedResources }) {
  const [activeTab, setActiveTab] = useState('sales');
  const [checkInsPage, setCheckInsPage] = useState(1);
  const checkInsPageSize = 20;
  const eventQuery = useQuery({ queryKey: eventQueryKeys.event(eventId), queryFn: () => getEvent(eventId) });
  const lots = useQuery({ queryKey: eventQueryKeys.lots(eventId), queryFn: () => listTicketLots(eventId) });
  const sales = useQuery({ queryKey: eventQueryKeys.sales(eventId), queryFn: () => listTicketSales(eventId) });
  const checkIns = useQuery({
    queryKey: ['events', 'check-ins', eventId, checkInsPage, checkInsPageSize],
    queryFn: () => listEventCheckIns(eventId, checkInsPage, checkInsPageSize),
    enabled: activeTab === 'check-ins',
  });
  const mapsQuery = useQuery({
    queryKey: ['events', 'maps', eventId],
    queryFn: () => listEventMaps(eventId),
    enabled: (eventQuery.data?.ticketMode ?? 'SIMPLE') === 'NUMBERED_SEATS',
  });

  const event = eventQuery.data;
  const lotRows = lots.data ?? [];
  const saleRows = sales.data ?? [];
  const publishedMaps = (mapsQuery.data ?? []).filter((map) => map.status === 'PUBLISHED');
  const manualSaleRows = saleRows.filter((sale) => sale.status !== 'RESERVED');
  const reservedRows = saleRows.filter((sale) => sale.status === 'RESERVED');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="reserved">Reservados</TabsTrigger>
          <TabsTrigger value="lots">Lotes</TabsTrigger>
          <TabsTrigger value="check-ins">Check-ins</TabsTrigger>
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
              publishedMaps={publishedMaps.map((map: EventMapDTO) => ({
                id: map.id,
                name: map.name,
                startsAt: map.startsAt ?? map.event.startsAt,
              }))}
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
      <TabsContent value="check-ins">
        <EventCheckInsTable
          checkIns={checkIns.data?.items ?? []}
          total={checkIns.data?.total ?? 0}
          page={checkInsPage}
          pageSize={checkInsPageSize}
          onPageChange={setCheckInsPage}
          loading={checkIns.isLoading}
        />
      </TabsContent>
    </Tabs>
  );
}
