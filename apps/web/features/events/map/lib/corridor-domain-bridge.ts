import { clippingPolygonsIntersect, mergePolygons, polygonsIntersect } from '@alusa/domain';

import type { EventMapObjectDTO } from '../api/event-map-service';
import { DEFAULT_CORRIDOR_THICKNESS } from './smart-corridor-layout';
import type { BoundsRect } from './selection-utils';

export type CorridorPolygonPoint = { x: number; y: number };

/**
 * World-space polygon for a corridor body — matches Konva Group at (x,y) with a
 * child Rect from (0,0) to (width,height) and group rotation around the top-left anchor.
 */
export function eventMapObjectToCorridorPolygon(object: EventMapObjectDTO): CorridorPolygonPoint[] {
  const width = Math.max(8, object.width ?? DEFAULT_CORRIDOR_THICKNESS);
  const height = Math.max(8, object.height ?? 280);
  const radians = ((object.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const originX = object.x;
  const originY = object.y;

  const localCorners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  return localCorners.map(({ x: localX, y: localY }) => ({
    x: originX + localX * cos - localY * sin,
    y: originY + localX * sin + localY * cos,
  }));
}

export function corridorEditorPolygonsIntersect(left: EventMapObjectDTO, right: EventMapObjectDTO) {
  const leftPolygon = eventMapObjectToCorridorPolygon(left);
  const rightPolygon = eventMapObjectToCorridorPolygon(right);
  return (
    clippingPolygonsIntersect(leftPolygon, rightPolygon) ||
    polygonsIntersect(leftPolygon, rightPolygon)
  );
}

export function mergeCorridorEditorPolygons(objects: EventMapObjectDTO[]): CorridorPolygonPoint[][] {
  if (objects.length === 0) return [];
  return mergePolygons(objects.map((object) => eventMapObjectToCorridorPolygon(object)));
}

export function polygonBounds(polygon: CorridorPolygonPoint[]): BoundsRect {
  if (polygon.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...polygon.map((point) => point.x));
  const minY = Math.min(...polygon.map((point) => point.y));
  const maxX = Math.max(...polygon.map((point) => point.x));
  const maxY = Math.max(...polygon.map((point) => point.y));

  return {
    x: Number(minX.toFixed(4)),
    y: Number(minY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
  };
}

export function polygonToKonvaPoints(polygon: CorridorPolygonPoint[]): number[] {
  return polygon.flatMap((point) => [point.x, point.y]);
}
