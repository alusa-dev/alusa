'use client';

import { Eye, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ParticipantActions({ onView, onRemove }: { onView: () => void; onRemove: () => void }) {
  return (
    <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 text-slate-500 hover:text-[#A94DFF] hover:bg-slate-50/50"
        onClick={onView}
        title="Ver detalhes"
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50/50"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
