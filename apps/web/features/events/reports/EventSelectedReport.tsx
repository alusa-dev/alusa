'use client';

import { type SchoolEventDTO } from '../events-service';
import { EventSummary } from '../detail/EventSummary';
import { EventEmptyState as EmptyState } from '../shared/EventEmptyState';

export function EventSelectedReport({ event }: { event?: SchoolEventDTO | null }) {
  return event ? <EventSummary event={event} /> : <EmptyState title="Nenhum evento selecionado." description="Selecione um evento para ver o relatório detalhado." />;
}
