import type { Point } from './types.js';

/**
 * SAT (Separating Axis Theorem) para polígonos convexos.
 * Suficiente para retângulos (com ou sem rotação).
 * Para formas compostas (L, T, +), usar polygon-clipping.
 */
export function polygonsIntersect(a: Point[], b: Point[]): boolean {
  return !hasSeparatingAxis(a, b) && !hasSeparatingAxis(b, a);
}

function hasSeparatingAxis(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const next = (i + 1) % a.length;
    const edge = { x: a[next].x - a[i].x, y: a[next].y - a[i].y };
    // normal do eixo
    const axis = { x: -edge.y, y: edge.x };

    const [minA, maxA] = projectPolygon(a, axis);
    const [minB, maxB] = projectPolygon(b, axis);

    if (maxA < minB || maxB < minA) return true;
  }
  return false;
}

function projectPolygon(polygon: Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of polygon) {
    const dot = p.x * axis.x + p.y * axis.y;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return [min, max];
}

/** Retorna true se o ponto estiver dentro do polígono (ray casting). */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
