'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { EventCostumesPanel } from './costumes/EventCostumesPanel';
import { EventDangerZone } from './detail/EventDangerZone';
import { EventDetailKpis } from './detail/EventDetailKpis';
import { EventHeader } from './detail/EventHeader';
import { EventMapSection } from './detail/EventMapSection';
import { getEvent, listEventParticipants } from './events-service';
import { EventFinancialPanel } from './financial/EventFinancialPanel';
import { EventParticipantsPanel } from './participants/EventParticipantsPanel';
import { EventEmptyState as EmptyState } from './shared/EventEmptyState';
import { eventQueryKeys } from './shared/event-query-keys';
import { useEventResources } from './shared/useEventResources';
import { EventTicketsPanel } from './tickets/EventTicketsPanel';

export function EventDetailFeature({ eventId }: { eventId: string }) {
  const resources = useEventResources();
  const eventQuery = useQuery({ queryKey: eventQueryKeys.event(eventId), queryFn: () => getEvent(eventId) });
  const participantsQuery = useQuery({
    queryKey: ['events', 'participants', eventId],
    queryFn: () => listEventParticipants(eventId),
  });
  const event = eventQuery.data;
  const participants = participantsQuery.data ?? [];

  if (eventQuery.isLoading) {
    return <div className="h-80 animate-pulse rounded-xl bg-slate-100" />;
  }

  if (!event) {
    return <EmptyState title="Evento não encontrado." description="Verifique se o evento existe e pertence à conta atual." />;
  }

  return (
    <div className="space-y-8 pb-16">
      <EventHeader event={event} />
      <EventDetailKpis event={event} participantsCount={participants.length} />
      <EventParticipantsPanel eventId={eventId} event={event} participants={participants} loading={participantsQuery.isLoading} />

      {event.hasCostumes && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Controle de Figurinos</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Gestão de entregas, tamanhos definidos e status de pagamentos.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventCostumesPanel eventId={eventId} resources={resources.data} />
          </CardContent>
        </Card>
      )}

      {event.hasTickets && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Ingressos & Bilheteria</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Acompanhe lotes ativos, vendas realizadas e cortesias emitidas.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventTicketsPanel eventId={eventId} resources={resources.data} />
          </CardContent>
        </Card>
      )}

      {event.hasFinancialControl && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Fluxo de Caixa Operacional</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Controle detalhado de receitas de bilheteria/taxas e despesas com fornecedores.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventFinancialPanel eventId={eventId} event={event} />
          </CardContent>
        </Card>
      )}

      {event.hasTickets && event.ticketMode !== 'SIMPLE' && <EventMapSection event={event} />}

      <EventDangerZone event={event} />
    </div>
  );
}
