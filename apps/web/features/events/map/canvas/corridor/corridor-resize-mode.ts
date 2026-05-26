import { getMovingEdgesFromAnchor } from '@alusa/domain';

const CORRIDOR_CORNER_ANCHORS = new Set([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

const CORRIDOR_EDGE_ANCHORS = new Set([
  'middle-left',
  'middle-right',
  'top-center',
  'bottom-center',
]);

export type CorridorResizeMode = 'edge' | 'corner';

export function corridorIsCornerResizeAnchor(anchor: string): boolean {
  return CORRIDOR_CORNER_ANCHORS.has(anchor);
}

export function corridorIsEdgeResizeAnchor(anchor: string): boolean {
  return CORRIDOR_EDGE_ANCHORS.has(anchor);
}

export function resolveCorridorResizeMode(anchor: string): CorridorResizeMode {
  if (corridorIsEdgeResizeAnchor(anchor)) return 'edge';
  if (corridorIsCornerResizeAnchor(anchor)) return 'corner';
  return 'corner';
}

/** Multi-select: corners → uniform proportional scale; edges → single-axis group resize. */
export function shouldUseUniformGroupScale(anchor: string, corridorCount: number): boolean {
  if (corridorCount < 2) return false;
  return resolveCorridorResizeMode(anchor) === 'corner';
}

export function anchorMovesSingleAxis(anchor: string): boolean {
  const moving = getMovingEdgesFromAnchor(anchor);
  const axes = Number(Boolean(moving.vertical)) + Number(Boolean(moving.horizontal));
  return axes === 1;
}
