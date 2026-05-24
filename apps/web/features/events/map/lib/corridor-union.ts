import type { EventMapObjectDTO } from '../api/event-map-service';
import {
  corridorEditorPolygonsIntersect,
  eventMapObjectToCorridorPolygon,
  mergeCorridorEditorPolygons,
  polygonBounds,
  type CorridorPolygonPoint,
} from './corridor-domain-bridge';
import { intersectsRect, type BoundsRect } from './selection-utils';

export type CorridorUnionMember = {
  objectId: string;
  polygon: CorridorPolygonPoint[];
  bounds: BoundsRect;
};

export type CorridorUnionGroup = {
  id: string;
  objectIds: string[];
  members: CorridorUnionMember[];
  /** True geometric union (polygon-clipping). */
  mergedPolygons: CorridorPolygonPoint[][];
  bounds: BoundsRect;
};

function padded(bounds: BoundsRect, padding: number): BoundsRect {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function unionBounds(rects: BoundsRect[]): BoundsRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

  return {
    x: Number(minX.toFixed(4)),
    y: Number(minY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
  };
}

function corridorsConnected(
  left: { object: EventMapObjectDTO; bounds: BoundsRect; polygon: CorridorPolygonPoint[] },
  right: { object: EventMapObjectDTO; bounds: BoundsRect; polygon: CorridorPolygonPoint[] },
  mergePadding: number,
) {
  if (corridorEditorPolygonsIntersect(left.object, right.object)) {
    return true;
  }

  return intersectsRect(padded(left.bounds, mergePadding), padded(right.bounds, mergePadding));
}

/** Rotated polygon bounds — delegates to domain polygon projection. */
export function getCorridorBounds(object: EventMapObjectDTO): BoundsRect {
  return polygonBounds(eventMapObjectToCorridorPolygon(object));
}

export function getCorridorUnionGroups(
  corridors: EventMapObjectDTO[],
  mergePadding = 1,
): CorridorUnionGroup[] {
  const entries = corridors
    .filter((object) => object.type === 'CORRIDOR' && !object.hidden)
    .map((object) => {
      const polygon = eventMapObjectToCorridorPolygon(object);
      return {
        object,
        polygon,
        bounds: polygonBounds(polygon),
      };
    });

  const visited = new Set<string>();
  const groups: CorridorUnionGroup[] = [];

  for (const entry of entries) {
    if (visited.has(entry.object.id)) continue;

    const queue = [entry];
    const groupEntries: typeof entries = [];
    visited.add(entry.object.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      groupEntries.push(current);

      for (const candidate of entries) {
        if (visited.has(candidate.object.id)) continue;
        const connected = groupEntries.some((member) => corridorsConnected(member, candidate, mergePadding));
        if (!connected) continue;

        visited.add(candidate.object.id);
        queue.push(candidate);
      }
    }

    const members = groupEntries.map((member) => ({
      objectId: member.object.id,
      polygon: member.polygon,
      bounds: member.bounds,
    }));

    const mergedPolygons =
      groupEntries.length === 1
        ? [members[0]!.polygon]
        : mergeCorridorEditorPolygons(groupEntries.map((member) => member.object));

    groups.push({
      id: groupEntries
        .map((member) => member.object.id)
        .sort()
        .join(':'),
      objectIds: groupEntries.map((member) => member.object.id),
      members,
      mergedPolygons,
      bounds: unionBounds(members.map((member) => member.bounds)),
    });
  }

  return groups;
}

export function getCorridorUnionGroupByObjectId(
  groups: CorridorUnionGroup[],
  objectId: string,
): CorridorUnionGroup | undefined {
  return groups.find((group) => group.objectIds.includes(objectId));
}

export function isCorridorInCompositeUnion(groups: CorridorUnionGroup[], objectId: string) {
  const group = getCorridorUnionGroupByObjectId(groups, objectId);
  return Boolean(group && group.objectIds.length >= 2);
}

/** Union members defer body rendering to the merged overlay unless selected/dragged. */
export function shouldRenderIndividualCorridorBody(options: {
  objectId: string;
  selected: boolean;
  dragging: boolean;
  groups: CorridorUnionGroup[];
}) {
  if (options.selected || options.dragging) return true;
  return !isCorridorInCompositeUnion(options.groups, options.objectId);
}

export function buildCorridorUnionGroupLookup(groups: CorridorUnionGroup[]) {
  const byObjectId = new Map<string, string>();
  for (const group of groups) {
    if (group.objectIds.length < 2) continue;
    for (const objectId of group.objectIds) {
      byObjectId.set(objectId, group.id);
    }
  }
  return byObjectId;
}
