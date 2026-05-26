import type { BoundingBox } from './snap-guides.js';
import type { TextMode } from '../doc/text-object.js';
import type { EventMapObjectDTO } from '../types/event-map-types.js';

export type ResizeAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type MovingResizeEdges = {
  vertical?: 'start' | 'end';
  horizontal?: 'start' | 'end';
};

export type MovingAxes = {
  horizontal: boolean;
  vertical: boolean;
};

export const TEXT_CORNER_ANCHORS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;

export const TEXT_FIXED_WIDTH_ANCHORS = [
  ...TEXT_CORNER_ANCHORS,
  'middle-left',
  'middle-right',
] as const;

export const TEXT_AREA_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

const CORNER_ANCHORS = new Set<string>(TEXT_CORNER_ANCHORS);
const HORIZONTAL_EDGE_ANCHORS = new Set(['middle-left', 'middle-right']);
const VERTICAL_EDGE_ANCHORS = new Set(['top-center', 'bottom-center']);

export function getTextResizeAnchors(mode: TextMode): readonly string[] {
  if (mode === 'auto') return TEXT_CORNER_ANCHORS;
  if (mode === 'fixed-width') return TEXT_FIXED_WIDTH_ANCHORS;
  return TEXT_AREA_ANCHORS;
}

export function isCornerAnchor(anchor: string) {
  return CORNER_ANCHORS.has(anchor);
}

export function isHorizontalEdgeAnchor(anchor: string) {
  return HORIZONTAL_EDGE_ANCHORS.has(anchor);
}

export function isVerticalEdgeAnchor(anchor: string) {
  return VERTICAL_EDGE_ANCHORS.has(anchor);
}

export function isEdgeAnchor(anchor: string) {
  return isHorizontalEdgeAnchor(anchor) || isVerticalEdgeAnchor(anchor);
}

export function getMovingAxes(anchor: string): MovingAxes {
  const moving = getMovingEdgesFromAnchor(anchor);
  return {
    horizontal: moving.horizontal !== undefined,
    vertical: moving.vertical !== undefined,
  };
}

export function getMovingEdgesFromAnchor(anchor: string): MovingResizeEdges {
  switch (anchor) {
    case 'top-left':
      return { vertical: 'start', horizontal: 'start' };
    case 'top-center':
      return { horizontal: 'start' };
    case 'top-right':
      return { vertical: 'end', horizontal: 'start' };
    case 'middle-left':
      return { vertical: 'start' };
    case 'middle-right':
      return { vertical: 'end' };
    case 'bottom-left':
      return { vertical: 'start', horizontal: 'end' };
    case 'bottom-center':
      return { horizontal: 'end' };
    case 'bottom-right':
      return { vertical: 'end', horizontal: 'end' };
    default:
      return {};
  }
}

export function getFixedPointFromAnchor(box: BoundingBox, anchor: string) {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  switch (anchor) {
    case 'top-left':
      return { x: right, y: bottom };
    case 'top-center':
      return { x: centerX, y: bottom };
    case 'top-right':
      return { x: box.x, y: bottom };
    case 'middle-left':
      return { x: right, y: centerY };
    case 'middle-right':
      return { x: box.x, y: centerY };
    case 'bottom-left':
      return { x: right, y: box.y };
    case 'bottom-center':
      return { x: centerX, y: box.y };
    case 'bottom-right':
      return { x: box.x, y: box.y };
    default:
      return { x: right, y: bottom };
  }
}

export function resolveAnchorMode(
  _anchor: string,
  objectType: EventMapObjectDTO['type'],
  textMode?: TextMode,
): readonly string[] {
  if (objectType === 'TEXT' && textMode) {
    return getTextResizeAnchors(textMode);
  }
  if (objectType === 'TEXT') {
    return TEXT_AREA_ANCHORS;
  }
  if (objectType === 'CORRIDOR') {
    return TEXT_AREA_ANCHORS;
  }
  return TEXT_AREA_ANCHORS;
}

export function isAnchorAllowedForTextMode(mode: TextMode, anchor: string) {
  const allowed = getTextResizeAnchors(mode);
  return allowed.includes(anchor);
}
