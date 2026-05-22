'use client';

import { Maximize2, Minus, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useEventMapEditorStore } from '../store/event-map-editor-store';

export function MapBottomBar() {
  const map = useEventMapEditorStore((state) => state.map);
  const zoom = useEventMapEditorStore((state) => state.zoom);
  const setZoom = useEventMapEditorStore((state) => state.setZoom);
  const fitArtboardToView = useEventMapEditorStore((state) => state.fitArtboardToView);

  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-1">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => setZoom(zoom - 0.1)}>
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-14 text-center text-xs font-medium text-slate-600">{Math.round(zoom * 100)}%</span>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => setZoom(zoom + 0.1)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-lg"
        onClick={fitArtboardToView}
        aria-label="Ajustar zoom para visualizar a prancheta inteira"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
      <span className="ml-2 border-l border-slate-200 pl-3 text-xs text-slate-500">
        {map?.counts.sections ?? 0} setores · {map?.counts.seats ?? 0} assentos
      </span>
    </div>
  );
}
