'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';
import { type EventCostumeAssignmentStatus } from '@alusa/shared';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';

import { updateCostumeAssignment, type CostumeAssignmentDTO, type CostumeDTO, type EventScopedResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EditAssignmentFormDialog } from './EditAssignmentFormDialog';

export function AssignmentActions({
  assignment,
  eventId,
  costumes,
  scopedResources,
}: {
  assignment: CostumeAssignmentDTO;
  eventId: string;
  costumes: CostumeDTO[];
  scopedResources?: EventScopedResources;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const isTerminal = ['CANCELLED', 'RETURNED', 'DAMAGED', 'LOST'].includes(assignment.status);
  const hasAvailableActions = !['CANCELLED', 'DAMAGED', 'LOST'].includes(assignment.status);

  const mutation = useMutation({
    mutationFn: (status: EventCostumeAssignmentStatus) => updateCostumeAssignment(assignment.id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] }),
      ]);
      toast.success({ title: 'Status atualizado', description: 'O status do figurino foi atualizado com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar status', description: (error as Error).message }),
  });

  const unlinkMutation = useMutation({
    mutationFn: () => updateCostumeAssignment(assignment.id, { status: 'CANCELLED', alunoId: null, turmaId: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
        queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] }),
      ]);
      toast.success({ title: 'Figurino desvinculado', description: 'O vínculo foi removido deste participante.' });
      setUnlinkOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao desvincular figurino', description: (error as Error).message }),
  });

  if (!hasAvailableActions) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!isTerminal && <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>}

          {assignment.status === 'PENDING' && <DropdownMenuItem onClick={() => mutation.mutate('ORDERED')}>Encomendar</DropdownMenuItem>}
          {assignment.status === 'ORDERED' && <DropdownMenuItem onClick={() => mutation.mutate('RECEIVED')}>Marcar como recebido</DropdownMenuItem>}
          {assignment.status === 'RECEIVED' && <DropdownMenuItem onClick={() => mutation.mutate('DELIVERED')}>Entregar</DropdownMenuItem>}
          {assignment.status === 'RETURNED' && <DropdownMenuItem onClick={() => mutation.mutate('PENDING')}>Reabrir vínculo</DropdownMenuItem>}

          {assignment.status === 'DELIVERED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('RETURNED')}>
              Devolver
            </DropdownMenuItem>
          )}

          {assignment.status === 'ORDERED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('PENDING')}>Marcar como Pendente</DropdownMenuItem>
          )}

          {!isTerminal && <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            onClick={() => setUnlinkOpen(true)}
          >
            Desvincular
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAssignmentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        assignment={assignment}
        costumes={costumes}
        scopedResources={scopedResources}
      />

      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Cancelar vínculo de figurino?"
        description="O vínculo será cancelado e deixará de reservar uma unidade. Vínculos com recebimentos registrados não podem ser cancelados."
        confirmText="Desvincular"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => unlinkMutation.mutate()}
        loading={unlinkMutation.isPending}
      />

    </>
  );
}
