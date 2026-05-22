'use client';

import { Map, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { isPlateiaBaseLevel, sortLevelsForPanel } from '../lib/level-utils';
import { replaceSelection } from '../lib/selection-utils';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

export function MapAreasPanel() {
  const map = useEventMapEditorStore((state) => state.map);
  const activeLevelId = useEventMapEditorStore((state) => state.activeLevelId);
  const setActiveLevelId = useEventMapEditorStore((state) => state.setActiveLevelId);
  const setSelection = useEventMapEditorStore((state) => state.setSelection);
  const addLevel = useEventMapEditorStore((state) => state.addLevel);
  const deleteLevel = useEventMapEditorStore((state) => state.deleteLevel);
  const disabled = map?.status !== 'DRAFT';

  if (!map) return null;

  const levels = sortLevelsForPanel(map.levels);

  function selectLevel(levelId: string) {
    setActiveLevelId(levelId);
    setSelection(replaceSelection({ type: 'level', id: levelId }));
  }

  return (
    <aside className="flex max-h-[13.5rem] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-brand-accent" />
            <h2 className="text-sm font-semibold text-slate-950">Áreas do Mapa</h2>
          </div>
          <p className="text-xs text-slate-500">Andares, setores e ambientes</p>
        </div>
        <button
          type="button"
          aria-label="Adicionar área do mapa"
          disabled={disabled}
          onClick={() => addLevel()}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {levels.map((level) => {
            const active = level.id === activeLevelId;
            const locked = isPlateiaBaseLevel(level);

            return (
              <div
                key={level.id}
                className={cn(
                  'flex h-11 items-center gap-2 rounded-lg border px-3 transition-colors',
                  active
                    ? 'border-slate-300 bg-slate-100 text-slate-950 shadow-sm'
                    : 'border-slate-200/90 bg-slate-50/90 text-slate-600 hover:border-slate-300 hover:bg-slate-100/80',
                )}
              >
                <button
                  type="button"
                  onClick={() => selectLevel(level.id)}
                  className={cn('flex min-w-0 flex-1 items-center gap-2.5 text-left', active && 'font-medium')}
                >
                  <span className="inline-flex h-[22px] w-[34px] shrink-0 rounded-[3px] border border-slate-300 bg-white" />
                  <span className="truncate">{level.name}</span>
                </button>

                {!locked ? (
                  <button
                    type="button"
                    aria-label="Excluir área do mapa"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteLevel(level.id);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
