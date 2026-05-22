import type { EventMapObjectDTO } from '../api/event-map-service';
import { getObjectBounds, intersectsRect, type BoundsRect } from './selection-utils';

export type CorridorUnionGroup = {
  id: string;
  objectIds: string[];
  members: Array<{ objectId: string; rect: BoundsRect }>;
  rects: BoundsRect[];
  bounds: BoundsRect;
  segments: Array<{ points: [number, number, number, number] }>;
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
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: normalizeNumber(minX),
    y: normalizeNumber(minY),
    width: normalizeNumber(maxX - minX),
    height: normalizeNumber(maxY - minY),
  };
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, radians: number) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function getCorridorBounds(object: EventMapObjectDTO): BoundsRect {
  const bounds = getObjectBounds(object);
  const rotation = Number(object.rotation ?? 0);
  if (!Number.isFinite(rotation) || Math.abs(rotation % 360) < 0.001) return bounds;

  const origin = { x: object.x, y: object.y };
  const radians = (rotation * Math.PI) / 180;
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => rotatePoint(point, origin, radians));

  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));

  return {
    x: normalizeNumber(minX),
    y: normalizeNumber(minY),
    width: normalizeNumber(maxX - minX),
    height: normalizeNumber(maxY - minY),
  };
}

function pointInRect(x: number, y: number, rect: BoundsRect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function normalizeNumber(value: number) {
  return Number(value.toFixed(4));
}

function getBoundarySegments(rects: BoundsRect[]) {
  if (rects.length === 0) return [];

  const xs = [...new Set(rects.flatMap((rect) => [normalizeNumber(rect.x), normalizeNumber(rect.x + rect.width)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((rect) => [normalizeNumber(rect.y), normalizeNumber(rect.y + rect.height)]))].sort((a, b) => a - b);
  const filled = new Set<string>();

  for (let yi = 0; yi < ys.length - 1; yi += 1) {
    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      const centerX = (xs[xi]! + xs[xi + 1]!) / 2;
      const centerY = (ys[yi]! + ys[yi + 1]!) / 2;
      if (rects.some((rect) => pointInRect(centerX, centerY, rect))) {
        filled.add(`${xi}:${yi}`);
      }
    }
  }

  const segments: Array<{ points: [number, number, number, number] }> = [];
  for (let yi = 0; yi < ys.length - 1; yi += 1) {
    for (let xi = 0; xi < xs.length - 1; xi += 1) {
      if (!filled.has(`${xi}:${yi}`)) continue;

      const x1 = xs[xi]!;
      const x2 = xs[xi + 1]!;
      const y1 = ys[yi]!;
      const y2 = ys[yi + 1]!;

      if (!filled.has(`${xi}:${yi - 1}`)) segments.push({ points: [x1, y1, x2, y1] });
      if (!filled.has(`${xi + 1}:${yi}`)) segments.push({ points: [x2, y1, x2, y2] });
      if (!filled.has(`${xi}:${yi + 1}`)) segments.push({ points: [x2, y2, x1, y2] });
      if (!filled.has(`${xi - 1}:${yi}`)) segments.push({ points: [x1, y2, x1, y1] });
    }
  }

  return segments;
}

export function getCorridorUnionGroups(corridors: EventMapObjectDTO[], mergePadding = 1): CorridorUnionGroup[] {
  const entries = corridors
    .filter((object) => object.type === 'CORRIDOR' && !object.hidden)
    .map((object) => ({ object, bounds: getCorridorBounds(object) }));
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
        const connected = groupEntries.some((member) =>
          intersectsRect(padded(member.bounds, mergePadding), padded(candidate.bounds, mergePadding)),
        );
        if (!connected) continue;

        visited.add(candidate.object.id);
        queue.push(candidate);
      }
    }

    const members = groupEntries.map((member) => ({ objectId: member.object.id, rect: member.bounds }));
    const rects = members.map((member) => member.rect);
    groups.push({
      id: groupEntries.map((member) => member.object.id).sort().join(':'),
      objectIds: groupEntries.map((member) => member.object.id),
      members,
      rects,
      bounds: unionBounds(rects),
      segments: getBoundarySegments(rects),
    });
  }

  return groups;
}
