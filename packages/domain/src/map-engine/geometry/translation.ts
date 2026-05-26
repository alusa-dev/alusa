import type { BoundsRect } from './bounds.js';

import type { Point2D } from './rotation.js';

export function translatePoint(point: Point2D, delta: Point2D): Point2D {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}

export function applyDelta(point: Point2D, dx: number, dy: number): Point2D {
  return translatePoint(point, { x: dx, y: dy });
}

export function translateBounds(bounds: BoundsRect, delta: Point2D): BoundsRect {
  return {
    x: bounds.x + delta.x,
    y: bounds.y + delta.y,
    width: bounds.width,
    height: bounds.height,
  };
}
