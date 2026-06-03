'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, Plus, Shirt, WalletCards } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { formatCurrency, listCostumeAssignments, listCostumes, type EventResources } from '../events-service';
import { EventMetricCard as MetricCard } from '../shared/EventMetricCard';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { AssignmentFormDialog } from './AssignmentFormDialog';
import { CostumeAssignmentsTable } from './CostumeAssignmentsTable';
import { CostumeFormDialog } from './CostumeFormDialog';
import { CostumesTable } from './CostumesTable';

export function EventCostumesPanel({ eventId, resources }: { eventId: string; resources?: EventResources }) {
  const costumes = useQuery({ queryKey: eventQueryKeys.costumes(eventId), queryFn: () => listCostumes(eventId) });
  const assignments = useQuery({ queryKey: eventQueryKeys.assignments(eventId), queryFn: () => listCostumeAssignments(eventId) });
  const costumeRows = costumes.data ?? [];
  const assignmentRows = assignments.data ?? [];
  const costumeCost = costumeRows.reduce((sum, item) => sum + (item.schoolCost ?? 0) * item.quantity, 0);
  const separateAssignments = assignmentRows.filter((item) => item.status !== 'CANCELLED' && item.billingMode === 'SEPARATE_CHARGE');
  const separateExpectedRevenue = separateAssignments.reduce((sum, item) => sum + (item.chargedValue ?? 0), 0);
  const separateReceivedRevenue = separateAssignments
    .filter((item) => item.isPaid)
    .reduce((sum, item) => sum + (item.chargedValue ?? 0), 0);
  const includedAssignments = assignmentRows.filter((item) => item.status !== 'CANCELLED' && item.billingMode === 'INCLUDED_IN_REGISTRATION_FEE');

  return (
    <Tabs defaultValue="costumes" variant="line" className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Custo dos figurinos" value={formatCurrency(costumeCost)} icon={WalletCards} tone="warning" />
        <MetricCard label="Receita própria prevista" value={formatCurrency(separateExpectedRevenue)} icon={CircleDollarSign} tone="info" />
        <MetricCard label="Receita própria recebida" value={formatCurrency(separateReceivedRevenue)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Inclusos na inscrição" value={includedAssignments.length} icon={Shirt} tone="info" />
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costumes">Figurinos</TabsTrigger><TabsTrigger value="assignments">Entregas</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <CostumeFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Figurino</Button>} />
          <AssignmentFormDialog eventId={eventId} costumes={costumeRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Vínculo</Button>} />
        </div>
      </div>
      <TabsContent value="costumes">
        <CostumesTable costumes={costumeRows} assignments={assignmentRows} eventId={eventId} loading={costumes.isLoading} />
      </TabsContent>
      <TabsContent value="assignments">
        <CostumeAssignmentsTable assignments={assignmentRows} costumes={costumeRows} eventId={eventId} resources={resources} loading={assignments.isLoading} />
      </TabsContent>
    </Tabs>
  );
}
