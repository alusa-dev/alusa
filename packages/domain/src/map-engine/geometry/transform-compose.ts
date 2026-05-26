import type { Point2D } from './rotation.js';
import { rotatePoint, toGlobal, toLocal } from './rotation.js';
import { translatePoint } from './translation.js';

export type Transform2D = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

export const IDENTITY_TRANSFORM: Transform2D = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

/** Compose nested 2D transforms: parent * local (Konva-style group nesting). */
export function composeTransform(parent: Transform2D, local: Transform2D): Transform2D {
  const scaledLocal = {
    x: local.x * parent.scaleX,
    y: local.y * parent.scaleY,
  };
  const rotatedLocal = rotatePoint(scaledLocal, { x: 0, y: 0 }, parent.rotation);
  const worldPos = translatePoint(rotatedLocal, { x: parent.x, y: parent.y });

  return {
    x: worldPos.x,
    y: worldPos.y,
    rotation: parent.rotation + local.rotation,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
  };
}

/** Map a world-space point into a parent group's local space. */
export function worldToParentLocal(
  worldPoint: Point2D,
  parent: Pick<Transform2D, 'x' | 'y' | 'rotation'>,
): Point2D {
  return toLocal(worldPoint, { x: parent.x, y: parent.y }, parent.rotation);
}

/** Map a parent-local point into world space. */
export function parentLocalToWorld(
  localPoint: Point2D,
  parent: Pick<Transform2D, 'x' | 'y' | 'rotation'>,
): Point2D {
  return toGlobal(localPoint, { x: parent.x, y: parent.y }, parent.rotation);
}

/** Apply translate → rotate → scale around the origin, then translate by transform.x/y. */
export function applyTransform2DToPoint(point: Point2D, transform: Transform2D): Point2D {
  const scaled = { x: point.x * transform.scaleX, y: point.y * transform.scaleY };
  const rotated = toGlobal(scaled, { x: 0, y: 0 }, transform.rotation);
  return translatePoint(rotated, { x: transform.x, y: transform.y });
}

export function transform2DFromKonvaNode(node: {
  x: () => number;
  y: () => number;
  rotation: () => number;
  scaleX: () => number;
  scaleY: () => number;
}): Transform2D {
  return {
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
  };
}
