'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import TableLayout from '@/components/layout/TableLayout';

import { EventCostumesPanel } from '../costumes/EventCostumesPanel';
import { getEvent } from '../events-service';
import { EventFinancialPanel } from '../financial/EventFinancialPanel';
import { EventReportsPanel } from '../reports/EventReportsPanel';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';
import { EventSelector } from '../shared/EventSelector';
import { eventQueryKeys } from '../shared/event-query-keys';
import { useEventResources } from '../shared/useEventResources';
import { EventTicketsPanel } from '../tickets/EventTicketsPanel';

export function EventOperationsFeature({ section }: { section: 'tickets' | 'costumes' | 'financial' | 'reports' }) {
  const resources = useEventResources();
  const firstEventId = resources.data?.events[0]?.id;
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const selectedEventId = eventId || firstEventId;
  const event = useQuery({
    queryKey: selectedEventId ? eventQueryKeys.event(selectedEventId) : ['events', 'none'],
    queryFn: () => getEvent(selectedEventId!),
    enabled: Boolean(selectedEventId),
  });

  const title = {
    tickets: 'Ingressos',
    costumes: 'Figurinos',
    financial: 'Custos e receitas',
    reports: 'Relatórios',
  }[section];

  return (
    <TableLayout
      title={title}
      subtitle="Tudo nesta página permanece vinculado ao evento selecionado."
      filtersBar={<div className="flex justify-end"><EventSelector value={selectedEventId} onChange={setEventId} resources={resources.data} /></div>}
      className="pr-4 xl:pr-6"
    >
      {!selectedEventId ? (
        <EmptyState title="Nenhum evento criado ainda." description="Crie um evento antes de configurar ingressos, figurinos ou financeiro." />
      ) : section === 'tickets' ? (
        <EventTicketsPanel eventId={selectedEventId} resources={resources.data} />
      ) : section === 'costumes' ? (
        <EventCostumesPanel eventId={selectedEventId} resources={resources.data} />
      ) : section === 'financial' ? (
        <EventFinancialPanel eventId={selectedEventId} event={event.data} />
      ) : (
        <EventReportsPanel eventId={selectedEventId} />
      )}
    </TableLayout>
  );
}
