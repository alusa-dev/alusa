'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { getEventReports } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EventCompareReport } from './EventCompareReport';
import { EventGeneralReport } from './EventGeneralReport';
import { EventSelectedReport } from './EventSelectedReport';

export function EventReportsPanel({ eventId }: { eventId?: string }) {
  const { data: session, status: sessionStatus } = useSession();
  const contaId = session?.user?.contaId;
  const reports = useQuery({
    queryKey: eventQueryKeys.reports(eventId, undefined, contaId),
    queryFn: () => getEventReports({ eventId }),
    enabled: sessionStatus === 'authenticated' && Boolean(contaId),
  });
  const data = reports.data;
  return (
    <Tabs defaultValue="general" variant="line" className="space-y-5">
      <TabsList><TabsTrigger value="general">Geral</TabsTrigger><TabsTrigger value="event">Por evento</TabsTrigger><TabsTrigger value="compare">Comparativo</TabsTrigger></TabsList>
      <TabsContent value="general"><EventGeneralReport data={data} loading={reports.isLoading} /></TabsContent>
      <TabsContent value="event"><EventSelectedReport event={data?.selected} /></TabsContent>
      <TabsContent value="compare"><EventCompareReport data={data} loading={reports.isLoading} /></TabsContent>
    </Tabs>
  );
}
