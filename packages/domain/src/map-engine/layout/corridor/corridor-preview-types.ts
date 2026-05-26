import type { EventMapDTO } from '../../types/event-map-types.js';

export type CorridorDragMode = 'reflow' | 'rigid';

export type CorridorDragSession = {
  origin: Map<string, { x: number; y: number }>;
  delta: { x: number; y: number };
};

export type SmartCorridorDragPreviewOptions = {
  previewMap?: EventMapDTO;
  maxIterations?: number;
  activeCorridorIds?: string[];
  mode?: CorridorDragMode;
};
