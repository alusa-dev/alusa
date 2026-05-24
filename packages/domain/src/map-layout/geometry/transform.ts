import type { Bounds, Matrix2D, Point, Transform2D } from './types.js';

const DEG_TO_RAD = Math.PI / 180;

export function toRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

export function toDegrees(radians: number): number {
  return radians / DEG_TO_RAD;
}

export function createMatrix(transform: Transform2D): Matrix2D {
  const rad = toRadians(transform.rotation);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    cos * transform.scaleX,
    sin * transform.scaleX,
    -sin * transform.scaleY,
    cos * transform.scaleY,
    transform.x,
    transform.y,
  ];
}

export function multiplyPoint(matrix: Matrix2D, point: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
  };
}

export function rectToPolygon(bounds: Bounds, matrix: Matrix2D): Point[] {
  const corners: Point[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
  return corners.map((p) => multiplyPoint(matrix, p));
}

/** Converte delta world-space para local-space de um objeto com rotação em graus. */
export function worldDeltaToLocalDelta(delta: Point, parentRotationDeg: number): Point {
  const rad = toRadians(-parentRotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: delta.x * cos - delta.y * sin,
    y: delta.x * sin + delta.y * cos,
  };
}

export function rotatePointAroundCenter(input: {
  point: Point;
  center: Point;
  angleDeg: number;
}): Point {
  const rad = toRadians(input.angleDeg);
  const dx = input.point.x - input.center.x;
  const dy = input.point.y - input.center.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: input.center.x + dx * cos - dy * sin,
    y: input.center.y + dx * sin + dy * cos,
  };
}

export function getSelectionCenter(bounds: Bounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function scalePointFromBounds(input: {
  point: Point;
  from: Bounds;
  to: Bounds;
}): Point {
  const scaleX = input.to.width / input.from.width;
  const scaleY = input.to.height / input.from.height;
  return {
    x: input.to.x + (input.point.x - input.from.x) * scaleX,
    y: input.to.y + (input.point.y - input.from.y) * scaleY,
  };
}

export function polygonToBounds(polygon: Point[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
