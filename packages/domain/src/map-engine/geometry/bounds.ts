import type { LevelBounds } from '../guides/snap-guides.js';

export type BoundsRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeBoundsRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): BoundsRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function intersectsRect(a: BoundsRect, b: BoundsRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function unionBounds(boxes: BoundsRect[]): BoundsRect | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function expandRect(rect: BoundsRect, padding: number): BoundsRect {
  const pad = Math.max(0, padding);
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

export function clampRectToLevel(rect: BoundsRect, levelBounds: LevelBounds): BoundsRect {
  const x = Math.max(0, Math.min(rect.x, levelBounds.width - rect.width));
  const y = Math.max(0, Math.min(rect.y, levelBounds.height - rect.height));

  return {
    x,
    y,
    width: Math.min(rect.width, levelBounds.width),
    height: Math.min(rect.height, levelBounds.height),
  };
}

export function boundsFromPoints(points: Array<{ x: number; y: number }>): BoundsRect | null {
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function centerOf(bounds: BoundsRect) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function getSeatBounds(seat: { x: number; y: number; size?: number | null }) {
  const size = seat.size ?? 24;
  return {
    x: seat.x - size / 2,
    y: seat.y - size / 2,
    width: size,
    height: size,
  };
}
