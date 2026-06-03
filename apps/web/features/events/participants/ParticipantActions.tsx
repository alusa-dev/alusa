'use client';

import { Ban, Eye, MoreVertical, RotateCcw, UserMinus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ParticipantActions({
  isCancelled,
  canRemove,
  canReactivate,
  removeReasons,
  onView,
  onCancel,
  onReactivate,
  onRemove,
}: {
  isCancelled: boolean;
  canRemove: boolean;
  canReactivate: boolean;
  removeReasons: string[];
  onView: () => void;
  onCancel: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  const removeTitle = canRemove
    ? 'Remover aluno do evento'
    : removeReasons[0] ?? 'Este participante possui histórico e não pode ser removido com segurança.';

  return (
    <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={onView}>
            <Eye className="mr-2 h-4 w-4" />
            Ver detalhes
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isCancelled ? (
            <>
              <DropdownMenuItem disabled={!canReactivate} onClick={onReactivate}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reinscrever aluno
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-rose-700 focus:text-rose-700"
                disabled={!canRemove}
                onClick={onRemove}
                title={removeTitle}
              >
                <UserMinus className="mr-2 h-4 w-4" />
                Remover aluno do evento
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onClick={onCancel}>
              <Ban className="mr-2 h-4 w-4" />
              Cancelar inscrição
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
