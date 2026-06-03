'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { listTicketLots, listTicketSales, type EventResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { LotFormDialog } from './LotFormDialog';
import { SaleFormDialog } from './SaleFormDialog';
import { TicketLotsTable } from './TicketLotsTable';
import { TicketMetricsPanel } from './TicketMetricsPanel';
import { TicketReservationsTable } from './TicketReservationsTable';
import { TicketSalesTable } from './TicketSalesTable';

export function EventTicketsPanel({ eventId, resources }: { eventId: string; resources?: EventResources }) {
  const lots = useQuery({ queryKey: eventQueryKeys.lots(eventId), queryFn: () => listTicketLots(eventId) });
  const sales = useQuery({ queryKey: eventQueryKeys.sales(eventId), queryFn: () => listTicketSales(eventId) });
  const lotRows = lots.data ?? [];
  const saleRows = sales.data ?? [];
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
          <LotFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Lote</Button>} />
          <SaleFormDialog eventId={eventId} lots={lotRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Venda</Button>} />
        </div>
      </div>
      <TabsContent value="sales">
        <TicketSalesTable sales={manualSaleRows} eventId={eventId} lots={lotRows} resources={resources} loading={sales.isLoading} />
      </TabsContent>
      <TabsContent value="reserved">
        <TicketReservationsTable reservations={reservedRows} eventId={eventId} lots={lotRows} resources={resources} loading={sales.isLoading} />
      </TabsContent>
      <TabsContent value="lots">
        <TicketLotsTable lots={lotRows} eventId={eventId} loading={lots.isLoading} />
      </TabsContent>
      <TabsContent value="metrics">
        <TicketMetricsPanel revenue={revenue} pending={pending} sold={manualSaleRows.reduce((sum, sale) => sum + sale.quantity, 0)} complimentary={complimentary} />
      </TabsContent>
    </Tabs>
  );
}
