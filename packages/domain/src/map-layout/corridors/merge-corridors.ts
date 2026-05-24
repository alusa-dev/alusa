import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Pair, Ring } from 'polygon-clipping';
import type { Point } from '../geometry/types.js';
import type { SmartCorridor } from './types.js';
import { corridorToPolygon } from './corridor-to-polygon.js';

function pointsToRing(points: Point[]): Ring {
  return points.map((p): Pair => [p.x, p.y]);
}

function ringToPoints(ring: Ring): Point[] {
  return ring.map(([x, y]) => ({ x, y }));
}

function polygonToMultiPolygon(polygon: Point[]): MultiPolygon {
  return [[pointsToRing(polygon)]];
}

/**
 * Une polígonos em regiões disjuntas (polygon-clipping).
 */
export function mergePolygons(polygons: Point[][]): Point[][] {
  if (polygons.length === 0) return [];
  if (polygons.length === 1) return [polygons[0]];

  const [first, ...rest] = polygons.map(polygonToMultiPolygon);
  const result = polygonClipping.union(first, ...rest);

  return result.map((poly) => {
    const outerRing = poly[0];
    return ringToPoints(outerRing);
  });
}

/** Interseção com área > 0 (polygon-clipping). */
export function clippingPolygonsIntersect(a: Point[], b: Point[]): boolean {
  const result = polygonClipping.intersection(polygonToMultiPolygon(a), polygonToMultiPolygon(b));
  return result.length > 0;
}

function corridorToMultiPolygon(corridor: SmartCorridor): MultiPolygon {
  return [[pointsToRing(corridorToPolygon(corridor))]];
}

/**
 * Une os polígonos de múltiplos corredores em uma lista de regiões disjuntas.
 * Retorna lista de polígonos externos (sem furos para corredores simples).
 */
export function mergeCorridorPolygons(corridors: SmartCorridor[]): Point[][] {
  if (corridors.length === 0) return [];
  if (corridors.length === 1) return [corridorToPolygon(corridors[0])];

  const [first, ...rest] = corridors.map(corridorToMultiPolygon);
  const result = polygonClipping.union(first, ...rest);

  return result.map((poly) => {
    const outerRing = poly[0];
    return ringToPoints(outerRing);
  });
}

/**
 * Retorna true se corredor A sobrepõe geometricamente corredor B.
 */
export function corridorPolygonsIntersect(
  a: SmartCorridor,
  b: SmartCorridor,
): boolean {
  const result = polygonClipping.intersection(
    corridorToMultiPolygon(a),
    corridorToMultiPolygon(b),
  );
  return result.length > 0;
}
