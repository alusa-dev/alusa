import type { BoundsRect } from './bounds.js';

export type Point2D = { x: number; y: number };

export function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

/** Normalize to [0, 360), treating near-zero as exactly 0. */
export function normalizeRotation(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.abs(normalized) < 0.001 ? 0 : normalized;
}

/** Alias for normalizeRotation — angle in degrees. */
export const normalizeAngle = normalizeRotation;

/** Snap angle to the nearest step (default quarter-turn). */
export function snapAngleToStep(rotation: number, stepDegrees = 90) {
  const normalized = normalizeRotation(rotation);
  return Math.round(normalized / stepDegrees) * stepDegrees % 360;
}

/** Quarter-turn snap for corridor rotation gestures. */
export function snapSmartCorridorRotation(rotation: number) {
  return snapAngleToStep(rotation, 90);
}

export function shortestRotationDelta(fromDegrees: number, toDegrees: number) {
  let delta = normalizeRotation(toDegrees) - normalizeRotation(fromDegrees);
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function deltaRotation(baseDegrees: number, nextDegrees: number) {
  return shortestRotationDelta(baseDegrees, nextDegrees);
}

export function rotatePoint(point: Point2D, pivot: Point2D, rotationDegrees: number): Point2D {
  const rad = degreesToRadians(rotationDegrees);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/** Orbit a point around a pivot by a delta angle (degrees). */
export function orbitPointAroundPivot(point: Point2D, pivot: Point2D, deltaDegrees: number): Point2D {
  return rotatePoint(point, pivot, deltaDegrees);
}

export function rotatePoints(points: Point2D[], pivot: Point2D, rotationDegrees: number): Point2D[] {
  return points.map((point) => rotatePoint(point, pivot, rotationDegrees));
}

/** Transform world point into pivot-local space (inverse rotation, pivot-relative). */
export function toLocal(point: Point2D, pivot: Point2D, rotationDegrees: number): Point2D {
  return rotatePoint(
    { x: point.x - pivot.x, y: point.y - pivot.y },
    { x: 0, y: 0 },
    -rotationDegrees,
  );
}

/** Transform pivot-local point into world space. */
export function toGlobal(point: Point2D, pivot: Point2D, rotationDegrees: number): Point2D {
  const rotated = rotatePoint(point, { x: 0, y: 0 }, rotationDegrees);
  return { x: pivot.x + rotated.x, y: pivot.y + rotated.y };
}

/** World-space corners of an axis-aligned rect rotated around a pivot. */
export function rotateRectCorners(rect: BoundsRect, pivot: Point2D, rotationDegrees: number): Point2D[] {
  return [
    rotatePoint({ x: rect.x, y: rect.y }, pivot, rotationDegrees),
    rotatePoint({ x: rect.x + rect.width, y: rect.y }, pivot, rotationDegrees),
    rotatePoint({ x: rect.x + rect.width, y: rect.y + rect.height }, pivot, rotationDegrees),
    rotatePoint({ x: rect.x, y: rect.y + rect.height }, pivot, rotationDegrees),
  ];
}
