'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreVertical } from 'lucide-react';

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

import { deleteCostume, type CostumeDTO } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { CostumeFormDialog } from './CostumeFormDialog';

export function CostumeActions({ costume, eventId }: { costume: CostumeDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.costumes(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: () => deleteCostume(costume.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Figurino excluído', description: 'O figurino foi removido com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir figurino', description: err.message }),
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

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={costume.assignmentsCount > 0}
            onClick={() => setDeleteOpen(true)}
            title={costume.assignmentsCount > 0 ? 'Não é possível excluir um figurino com alunos vinculados.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CostumeFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        costume={costume}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir figurino"
        description={`Tem certeza que deseja excluir permanentemente o figurino "${costume.name}"?\n\nEsta ação removerá o figurino do evento e não poderá ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
  );
}
