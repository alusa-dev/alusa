'use client';

import { useRouter } from 'next/navigation';
import { CalendarDays, MapPin, Tag } from 'lucide-react';
import { EVENT_TYPE_LABELS } from '@alusa/shared';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { formatCurrency, formatDate, type SchoolEventDTO } from '../events-service';
import { EventStatusBadge as StatusBadge } from '../shared/EventStatusBadge';

export function EventsTable({ events, loading }: { events: SchoolEventDTO[]; loading: boolean }) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="animate-pulse h-48 bg-slate-50 border border-slate-100 rounded-xl" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
        <p className="text-slate-500">Nenhum evento encontrado.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event) => (
        <Card
          key={event.id}
          className="cursor-pointer transition-shadow hover:shadow-md rounded-xl border border-slate-200"
          onClick={() => router.push('/events/' + event.id)}
        >
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start gap-2">
              <CardTitle className="text-lg font-semibold text-slate-800 line-clamp-1" title={event.name}>
                {event.name}
              </CardTitle>
              <StatusBadge status={event.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="truncate">{event.locationName || 'Local não definido'}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{formatDate(event.startsAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{EVENT_TYPE_LABELS[event.type]}</span>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                <span className="block text-slate-500">Ingressos</span>
                <strong className="block text-slate-900 font-semibold">{event.metrics.ingressosVendidos}</strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                <span className="block text-slate-500">Receita</span>
                <strong className="block text-slate-900 font-semibold">{formatCurrency(event.metrics.receitaRealizada)}</strong>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
