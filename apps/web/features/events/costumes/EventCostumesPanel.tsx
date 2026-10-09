'use client';

import { useQuery } from '@tanstack/react-query';

import { Plus } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { listCostumeAssignments, listCostumes, type EventScopedResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { OUTLINE_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from '../shared/event-form-utils';
import { AssignmentFormDialog } from './AssignmentFormDialog';
import { CostumeAssignmentsTable } from './CostumeAssignmentsTable';
import { CostumeFormDialog } from './CostumeFormDialog';
import { CostumesTable } from './CostumesTable';

export function EventCostumesPanel({ eventId, scopedResources }: { eventId: string; scopedResources?: EventScopedResources }) {
  const costumes = useQuery({ queryKey: eventQueryKeys.costumes(eventId), queryFn: () => listCostumes(eventId) });
  const assignments = useQuery({ queryKey: eventQueryKeys.assignments(eventId), queryFn: () => listCostumeAssignments(eventId) });
  const costumeRows = costumes.data ?? [];
  const assignmentRows = assignments.data ?? [];

  return (
    <Tabs defaultValue="costumes" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costumes">Figurinos</TabsTrigger><TabsTrigger value="assignments">Entregas</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <CostumeFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Figurino</Button>} />
          <AssignmentFormDialog eventId={eventId} costumes={costumeRows} scopedResources={scopedResources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Vínculo</Button>} />
        </div>
      </div>
      <TabsContent value="costumes">
        <CostumesTable costumes={costumeRows} assignments={assignmentRows} eventId={eventId} loading={costumes.isLoading} />
      </TabsContent>
      <TabsContent value="assignments">
        <CostumeAssignmentsTable assignments={assignmentRows} costumes={costumeRows} eventId={eventId} scopedResources={scopedResources} loading={assignments.isLoading} />
      </TabsContent>
    </Tabs>
  );
}
