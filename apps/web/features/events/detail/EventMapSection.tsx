'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { EventMapPanel } from '../map/components/EventMapPanel';
import { type SchoolEventDTO } from '../events-service';

export function EventMapSection({ event }: { event: SchoolEventDTO }) {
  return (
    <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <CardHeader className="p-0 pb-4">
        <CardTitle className="text-base font-semibold text-slate-800">Mapa do Evento</CardTitle>
        <p className="text-xs text-slate-500 mt-1">Organize setores, fileiras e assentos para a bilheteria.</p>
      </CardHeader>
      <CardContent className="p-0">
        <EventMapPanel event={event} />
      </CardContent>
    </Card>
  );
}
