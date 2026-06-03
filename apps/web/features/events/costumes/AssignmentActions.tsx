'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical, RotateCcw } from 'lucide-react';
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

import { updateCostumeAssignment, type CostumeAssignmentDTO, type CostumeDTO, type EventResources } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EditAssignmentFormDialog } from './EditAssignmentFormDialog';

export function AssignmentActions({
  assignment,
  eventId,
  costumes,
  resources,
}: {
  assignment: CostumeAssignmentDTO;
  eventId: string;
  costumes: CostumeDTO[];
  resources?: EventResources;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const isSeparatePaid = assignment.billingMode === 'SEPARATE_CHARGE' && assignment.isPaid;

  const mutation = useMutation({
    mutationFn: (status: EventCostumeAssignmentStatus) => updateCostumeAssignment(assignment.id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Status atualizado', description: 'O status do figurino foi atualizado com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar status', description: (error as Error).message }),
  });

  const refundMutation = useMutation({
    mutationFn: () => updateCostumeAssignment(assignment.id, { isPaid: false }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Pagamento estornado', description: 'O pagamento próprio do figurino voltou para pendente.' });
      setRefundOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao estornar pagamento', description: (error as Error).message }),
  });

  const unlinkMutation = useMutation({
    mutationFn: () => updateCostumeAssignment(assignment.id, { status: 'CANCELLED', alunoId: null, turmaId: null }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Figurino desvinculado', description: 'O vínculo foi removido deste participante.' });
      setUnlinkOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao desvincular figurino', description: (error as Error).message }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          {assignment.status !== 'DELIVERED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('DELIVERED')}>
              Entregar
            </DropdownMenuItem>
          )}

          {assignment.status !== 'RETURNED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('RETURNED')}>
              Devolver
            </DropdownMenuItem>
          )}

          {assignment.status !== 'PENDING' && (
            <DropdownMenuItem onClick={() => mutation.mutate('PENDING')}>
              Marcar como Pendente
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {isSeparatePaid ? (
            <DropdownMenuItem
              className="text-rose-700 focus:text-rose-700"
              onClick={() => setRefundOpen(true)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Estornar pagamento
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={isSeparatePaid}
            onClick={() => setUnlinkOpen(true)}
          >
            Desvincular
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAssignmentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        assignment={assignment}
        costumes={costumes}
        resources={resources}
      />

      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title="Desvincular figurino?"
        description="O vínculo será cancelado e deixará de aparecer para este aluno ou turma. Pagamentos próprios precisam ser estornados antes."
        confirmText="Desvincular"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => unlinkMutation.mutate()}
        loading={unlinkMutation.isPending}
      />

      <ConfirmDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        title="Estornar pagamento do figurino?"
        description="O pagamento próprio deste figurino voltará para pendente. Depois disso, o vínculo poderá ser desvinculado."
        confirmText="Estornar pagamento"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => refundMutation.mutate()}
        loading={refundMutation.isPending}
      />
    </>
  );
}
