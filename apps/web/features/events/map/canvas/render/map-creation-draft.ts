import type { MapTool, SeatGridConfig } from '@alusa/domain';

export type CreationDraft = {
  tool: MapTool;
  start: { x: number; y: number };
  current: { x: number; y: number };
};

export type SeatGridDraft = {
  origin: { x: number; y: number };
  config: SeatGridConfig;
};

export type MarqueeDraft = {
  start: { x: number; y: number };
  current: { x: number; y: number };
};

export function isCreationTool(tool: MapTool) {
  return !['select', 'pan', 'zoom', 'row'].includes(tool);
}

export function isPlacementTool(tool: MapTool) {
  return isCreationTool(tool) || tool === 'row';
}

export function isProportionalTool(tool: MapTool) {
  return tool === 'shape-square' || tool === 'shape-circle';
}

export function getCreationBox(draft: CreationDraft) {
  const rawWidth = draft.current.x - draft.start.x;
  const rawHeight = draft.current.y - draft.start.y;

  if (isProportionalTool(draft.tool)) {
    const size = Math.max(Math.abs(rawWidth), Math.abs(rawHeight));
    const width = rawWidth < 0 ? -size : size;
    const height = rawHeight < 0 ? -size : size;
    return {
      x: width < 0 ? draft.start.x + width : draft.start.x,
      y: height < 0 ? draft.start.y + height : draft.start.y,
      width: Math.abs(width),
      height: Math.abs(height),
    };
  }

  return {
    x: Math.min(draft.start.x, draft.current.x),
    y: Math.min(draft.start.y, draft.current.y),
    width: Math.abs(rawWidth),
    height: Math.abs(rawHeight),
  };
}

export function getCreationShape(tool: MapTool) {
  if (tool === 'shape-circle') return 'circle';
  if (tool === 'shape-ellipse') return 'ellipse';
  if (tool === 'shape-triangle') return 'triangle';
  return null;
}
