'use client';

import type { PublicMapLevelView } from './public-map-level-view';

import { cn } from '@/lib/utils';

type PublicMapLevelTabsProps = {
  levels: PublicMapLevelView[];
  activeLevelId: string;
  onLevelChange: (levelId: string) => void;
};

export function PublicMapLevelTabs({ levels, activeLevelId, onLevelChange }: PublicMapLevelTabsProps) {
  if (levels.length <= 1) return null;

  return (
    <nav
      data-testid="public-map-level-tabs"
      aria-label="Ambientes do mapa"
      className="flex w-full gap-1 overflow-x-auto pb-0.5 sm:w-auto sm:justify-end"
      role="tablist"
    >
      {levels.map((level) => {
        const active = level.id === activeLevelId;
        return (
          <button
            key={level.id}
            type="button"
            data-testid={`public-map-level-tab-${level.id}`}
            aria-selected={active}
            role="tab"
            onClick={() => onLevelChange(level.id)}
            className={cn(
              'shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'border-slate-300 bg-slate-100 text-slate-950 shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {level.name}
          </button>
        );
      })}
    </nav>
  );
}
