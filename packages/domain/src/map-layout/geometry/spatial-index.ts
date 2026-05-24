import RBush from 'rbush';
import type { Bounds, ID } from './types.js';

export type SpatialItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: ID;
  kind: 'SEAT' | 'CORRIDOR' | 'OBJECT';
};

export function buildSpatialIndex(items: SpatialItem[]): RBush<SpatialItem> {
  const index = new RBush<SpatialItem>();
  index.load(items);
  return index;
}

export function findCandidateItems(
  index: RBush<SpatialItem>,
  bounds: Bounds,
): SpatialItem[] {
  return index.search({
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  } as SpatialItem);
}

export function boundsToSpatialItem(bounds: Bounds, id: ID, kind: SpatialItem['kind']): SpatialItem {
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
    id,
    kind,
  };
}
