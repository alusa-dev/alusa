'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import TableLayout from '@/components/layout/TableLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { listEvents } from './events-service';
import { EventFormDialog } from './list/EventFormDialog';
import { EventsFilters } from './list/EventsFilters';
import { EventsTable } from './list/EventsTable';
import { eventQueryKeys } from './shared/event-query-keys';
import { PRIMARY_BUTTON_CLASS } from './shared/event-form-utils';

export { EventDetailFeature } from './EventDetailFeature';
export { EventOperationsFeature } from './EventOperationsFeature';

export function EventsFeature() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const query = useQuery({
    queryKey: [...eventQueryKeys.events, search, status, type],
    queryFn: () => listEvents({
      search,
      status: status === 'ALL' ? undefined : status,
      type: type === 'ALL' ? undefined : type,
      pageSize: 50,
    }),
  });

  const events = query.data?.data ?? [];

  return (
    <TableLayout
      title="Todos os Eventos"
      subtitle="Gerencie eventos escolares, ingressos, figurinos, custos, receitas e resultados em um só lugar."
      actions={
        <EventFormDialog
          trigger={
            <Button className={cn(PRIMARY_BUTTON_CLASS, 'w-full md:w-auto')}>
              <Plus className="mr-2 h-4 w-4 transition-none" />
              Novo evento
            </Button>
          }
          onSaved={(event) => router.push('/events/' + event.id)}
        />
      }
      filtersBar={
        <EventsFilters
          search={search}
          status={status}
          type={type}
          onSearchChange={setSearch}
          onStatusChange={setStatus}
          onTypeChange={setType}
        />
      }
    >
      <div className="space-y-5">
        <EventsTable events={events} loading={query.isLoading} />
      </div>
    </TableLayout>
  );
}

export function NewEventFeature() {
  const router = useRouter();

  return (
    <TableLayout
      title="Novo evento"
      subtitle="Crie a pasta operacional do evento e depois configure ingressos, figurinos, custos e receitas."
      className="pr-4 xl:pr-6"
    >
      <Card className="max-w-2xl rounded-xl border-slate-200 bg-white p-6 shadow-none">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">Dados básicos do evento</h2>
          <p className="text-sm text-slate-500">
            O evento nasce em planejamento para evitar lançamentos em eventos errados.
          </p>
        </div>
        <div className="mt-5">
          <EventFormDialog
            trigger={
              <Button className="rounded-xl">
                <Plus className="h-4 w-4" />
                Abrir formulário
              </Button>
            }
            onSaved={(event) => router.push('/events/' + event.id)}
          />
        </div>
      </Card>
    </TableLayout>
  );
}
