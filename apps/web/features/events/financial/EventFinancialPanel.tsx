'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { listFinancialEntries, type SchoolEventDTO } from '../events-service';
import { EventSummary } from '../detail/EventSummary';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { FinancialEntriesTable } from './FinancialEntriesTable';
import { FinancialFormDialog } from './FinancialFormDialog';

export function EventFinancialPanel({ eventId, event }: { eventId: string; event?: SchoolEventDTO }) {
  const entries = useQuery({ queryKey: eventQueryKeys.finance(eventId), queryFn: () => listFinancialEntries(eventId) });
  const rows = entries.data ?? [];
  const costs = rows.filter((entry) => entry.type === 'COST');
  const revenues = rows.filter((entry) => entry.type === 'REVENUE');

  return (
    <Tabs defaultValue="costs" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costs">Custos</TabsTrigger><TabsTrigger value="revenues">Receitas</TabsTrigger><TabsTrigger value="result">Resultado</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <FinancialFormDialog eventId={eventId} type="COST" trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Custo</Button>} />
          <FinancialFormDialog eventId={eventId} type="REVENUE" trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Receita</Button>} />
        </div>
      </div>
      <TabsContent value="costs"><FinancialEntriesTable entries={costs} eventId={eventId} loading={entries.isLoading} /></TabsContent>
      <TabsContent value="revenues"><FinancialEntriesTable entries={revenues} eventId={eventId} loading={entries.isLoading} /></TabsContent>
      <TabsContent value="result">
        {event ? <EventSummary event={event} /> : null}
      </TabsContent>
    </Tabs>
  );
}
