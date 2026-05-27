import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';

export type PolygonPoint = { x: number; y: number };

const POLYGON_EPSILON = 0.000001;

function pointsEqual(a: PolygonPoint, b: PolygonPoint) {
  return Math.abs(a.x - b.x) <= POLYGON_EPSILON && Math.abs(a.y - b.y) <= POLYGON_EPSILON;
}

function polygonArea(points: PolygonPoint[]) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum / 2);
}

function sanitizePolygon(points: PolygonPoint[]): PolygonPoint[] {
  const sanitized: PolygonPoint[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (sanitized.length > 0 && pointsEqual(sanitized[sanitized.length - 1]!, point)) continue;
    sanitized.push({ x: point.x, y: point.y });
  }

  if (sanitized.length > 1 && pointsEqual(sanitized[0]!, sanitized[sanitized.length - 1]!)) {
    sanitized.pop();
  }

  return sanitized.length >= 3 && polygonArea(sanitized) > POLYGON_EPSILON ? sanitized : [];
}

function pointsToRing(points: PolygonPoint[]): Ring | null {
  const sanitized = sanitizePolygon(points);
  if (sanitized.length < 3) return null;

  const closed = [...sanitized, sanitized[0]!];
  return closed.map((p): Pair => [p.x, p.y]);
}

function ringToPoints(ring: Ring): PolygonPoint[] {
  const points = ring.map(([x, y]) => ({ x, y }));
  if (points.length > 1 && pointsEqual(points[0]!, points[points.length - 1]!)) {
    points.pop();
  }
  return points;
}

function polygonToMultiPolygon(polygon: PolygonPoint[]): MultiPolygon | null {
  const ring = pointsToRing(polygon);
  return ring ? [[ring]] : null;
}

export function polygonsIntersect(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  const polygonA = sanitizePolygon(a);
  const polygonB = sanitizePolygon(b);
  if (polygonA.length < 3 || polygonB.length < 3) return false;
  return !hasSeparatingAxis(polygonA, polygonB) && !hasSeparatingAxis(polygonB, polygonA);
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
  const validPolygons = polygons.map(sanitizePolygon).filter((polygon) => polygon.length >= 3);
  if (validPolygons.length === 0) return [];
  if (validPolygons.length === 1) return [validPolygons[0]!];

  const multipolygons = validPolygons
    .map(polygonToMultiPolygon)
    .filter((polygon): polygon is MultiPolygon => Boolean(polygon));
  const [first, ...rest] = multipolygons;
  if (!first) return [];

  try {
    const result = polygonClipping.union(first, ...rest);
    return result.map((poly) => ringToPoints(poly[0]!)).filter((polygon) => polygon.length >= 3);
  } catch {
    return validPolygons;
  }
}

export function clippingPolygonsIntersect(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  const polygonA = polygonToMultiPolygon(a);
  const polygonB = polygonToMultiPolygon(b);
  if (!polygonA || !polygonB) return false;

  try {
    return polygonClipping.intersection(polygonA, polygonB).length > 0;
  } catch {
    return polygonsIntersect(a, b);
  }
}
