'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CreatorIcon } from '@/components/icons/hugeicons';
import type { SeatCreationMode } from '../canvas/render/map-creation-draft';

export type { SeatCreationMode } from '../canvas/render/map-creation-draft';

type SeatCreationToolbarProps = {
  mode: SeatCreationMode;
  onModeChange: (mode: SeatCreationMode) => void;
};

const modes: Array<{
  id: SeatCreationMode;
  label: string;
  description: string;
  icon: 'block';
}> = [
  {
    id: 'RECTANGULAR',
    label: 'Bloco de fileiras',
    description: 'Cria um bloco paramétrico de fileiras e assentos.',
    icon: 'block',
  },
];

export function SeatCreationToolbar({ mode, onModeChange }: SeatCreationToolbarProps) {
  return (
    <div
      data-testid="seat-creation-toolbar"
      role="toolbar"
      aria-label="Ferramentas de criação de assentos"
      className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-300/30 backdrop-blur"
    >
      {modes.map(({ id, label, description, icon }) => {
        const active = mode === id;
        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            aria-pressed={active}
            aria-label={label}
            data-testid={`seat-creation-${id.toLowerCase()}`}
            title={description}
            onClick={() => onModeChange(id)}
            className={cn(
              'h-9 gap-2 rounded-lg px-3 text-xs font-medium text-slate-600 transition-all',
              'hover:bg-slate-100 hover:text-slate-950',
              active && 'bg-brand-accent text-white shadow-sm hover:bg-brand-accent hover:text-white',
            )}
          >
            <CreatorIcon name={icon} size={16} />
            <span>{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
