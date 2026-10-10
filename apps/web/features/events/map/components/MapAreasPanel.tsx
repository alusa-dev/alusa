'use client';
import { isPlateiaBaseLevel, replaceSelection, sortLevelsForPanel } from '@alusa/domain';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

import { cn } from '@/lib/utils';
import { CreatorIcon } from '@/components/icons/hugeicons';
import { useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';


export function MapAreasPanel() {
  const [levelToDelete, setLevelToDelete] = useState<string | null>(null);
  const map = useEventMapEditorStore((state) => state.map);
  const activeLevelId = useEventMapEditorStore((state) => state.activeLevelId);
  const setActiveLevelId = useEventMapEditorStore((state) => state.setActiveLevelId);
  const setSelection = useEventMapEditorStore((state) => state.setSelection);
  const addLevel = useEventMapEditorStore((state) => state.addLevel);
  const deleteLevel = useEventMapEditorStore((state) => state.deleteLevel);
  const disabled = map?.status === 'ARCHIVED';

  if (!map) return null;

  const levels = sortLevelsForPanel(map.levels);
  const pendingLevel = levels.find((level) => level.id === levelToDelete) ?? null;
  const pendingSections = pendingLevel ? map.sections.filter((section) => section.levelId === pendingLevel.id) : [];
  const pendingSeats = pendingLevel ? map.seats.filter((seat) => seat.levelId === pendingLevel.id).length : 0;
  const pendingObjects = pendingLevel ? map.objects.filter((object) => object.levelId === pendingLevel.id).length : 0;

  function selectLevel(levelId: string) {
    setActiveLevelId(levelId);
    setSelection(replaceSelection({ type: 'level', id: levelId }));
  }

  return (
    <aside className="flex max-h-[13.5rem] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreatorIcon name="map" size={16} className="text-brand-accent" />
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
          <CreatorIcon name="add" size={16} />
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
                  <span className="truncate">{level.name.trim() || 'Área sem nome'}</span>
                </button>

                {!locked ? (
                  <button
                    type="button"
                    aria-label="Excluir área do mapa"
                    disabled={disabled || levels.length <= 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      setLevelToDelete(level.id);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <CreatorIcon name="delete" size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <AlertDialog open={Boolean(pendingLevel)} onOpenChange={(open) => !open && setLevelToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir área “{pendingLevel?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSections.length === 0 && pendingSeats === 0 && pendingObjects === 0
                ? 'Esta área está vazia e será removida do mapa.'
                : `A exclusão removerá esta área e todo o seu conteúdo: ${pendingSections.length} setor(es), ${pendingSeats} assento(s) e ${pendingObjects} objeto(s).`}
              {' '}A ação pode ser desfeita pelo botão Desfazer enquanto permanecer no editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingLevel && levels.length > 1) deleteLevel(pendingLevel.id);
              setLevelToDelete(null);
            }}>Excluir área</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
