import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';

export type PolygonPoint = { x: number; y: number };

function pointsToRing(points: PolygonPoint[]): Ring {
  return points.map((p): Pair => [p.x, p.y]);
}

function ringToPoints(ring: Ring): PolygonPoint[] {
  return ring.map(([x, y]) => ({ x, y }));
}

function polygonToMultiPolygon(polygon: PolygonPoint[]): MultiPolygon {
  return [[pointsToRing(polygon)]];
}

export function polygonsIntersect(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
}

function hasSeparatingAxis(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const next = (i + 1) % a.length;
    const edge = { x: a[next]!.x - a[i]!.x, y: a[next]!.y - a[i]!.y };
    const axis = { x: -edge.y, y: edge.x };

    const [minA, maxA] = projectPolygon(a, axis);
    const [minB, maxB] = projectPolygon(b, axis);

    if (maxA < minB || maxB < minA) return true;
  }
  return false;
}

function projectPolygon(polygon: PolygonPoint[], axis: PolygonPoint): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    const dot = p.x * axis.x + p.y * axis.y;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return [min, max];
}

export function pointInPolygon(point: PolygonPoint, polygon: PolygonPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function mergePolygons(polygons: PolygonPoint[][]): PolygonPoint[][] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return [polygons[0]!];

  const [first, ...rest] = polygons.map(polygonToMultiPolygon);
  const result = polygonClipping.union(first!, ...rest);

  return result.map((poly) => ringToPoints(poly[0]!));
}

export function clippingPolygonsIntersect(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  return polygonClipping.intersection(polygonToMultiPolygon(a), polygonToMultiPolygon(b)).length > 0;
}
