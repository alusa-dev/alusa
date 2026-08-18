'use client';

import { Ban, Eye, MoreVertical, Trash2 } from 'lucide-react';

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
  canPermanentlyDelete,
  onView,
  onCancel,
  onPermanentDelete,
}: {
  isCancelled: boolean;
  canPermanentlyDelete: boolean;
  onView: () => void;
  onCancel: () => void;
  onPermanentDelete: () => void;
}) {
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
              {canPermanentlyDelete && (
                <DropdownMenuItem
                  className="text-rose-800 focus:text-rose-800"
                  onClick={onPermanentDelete}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir Inscrito
                </DropdownMenuItem>
              )}
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
