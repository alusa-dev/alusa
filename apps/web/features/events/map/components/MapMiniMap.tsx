'use client';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

import { useMemo } from 'react';

export function MapMiniMap() {
  const map = useEventMapEditorStore((state) => state.map);
  const activeLevelId = useEventMapEditorStore((state) => state.activeLevelId);
  const level = useMemo(() => map?.levels.find((item) => item.id === activeLevelId) ?? map?.levels[0], [map, activeLevelId]);

  if (!map || !level) return null;

  const scale = 180 / Math.max(level.widthPx, level.heightPx);
  const width = level.widthPx * scale;
  const height = level.heightPx * scale;

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="mb-2 text-[11px] font-medium text-slate-500">{level.name}</div>
      <div className="relative rounded-md bg-slate-100" style={{ width, height }}>
        {map.sections
          .filter((section) => section.levelId === level.id)
          .map((section, index) => (
            <span
              key={section.id}
              className="absolute rounded-sm opacity-80"
              style={{
                backgroundColor: section.color,
                left: 8 + (index % 4) * 28,
                top: 8 + Math.floor(index / 4) * 20,
                width: 22,
                height: 14,
              }}
            />
          ))}
        <span className="absolute left-1/4 top-1/4 h-1/2 w-1/2 rounded border border-brand-accent bg-brand-accent/10" />
      </div>
    </div>
  );
}
