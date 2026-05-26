import { getMovingEdgesFromAnchor } from './anchor.js';
import { snapSmartCorridorRotation } from './rotation.js';

export const MIN_UNIFORM_SCALE = 0.05;
export const MAX_UNIFORM_SCALE = 20;
export const MIN_CORRIDOR_SIZE = 8;

export function clampUniformScale(value: number) {
  return Math.max(MIN_UNIFORM_SCALE, Math.min(MAX_UNIFORM_SCALE, value));
}

export type ResizeScale = {
  scaleX: number;
  scaleY: number;
};

/** Map Konva local scale factors to world AABB scale based on quarter-turn rotation. */
export function mapLocalScaleToAabbScale(
  rotation: number,
  localScaleX: number,
  localScaleY: number,
): ResizeScale {
  const snapped = snapSmartCorridorRotation(rotation);

  if (snapped === 90 || snapped === 270) {
    return { scaleX: localScaleY, scaleY: localScaleX };
  }

  return { scaleX: localScaleX, scaleY: localScaleY };
}

/** Keep only the AABB axes that the active resize anchor moves (Transformer semantics). */
export function constrainAabbScaleForAnchor(anchor: string, aabbScale: ResizeScale): ResizeScale {
  const moving = getMovingEdgesFromAnchor(anchor);

  return {
    scaleX: moving.vertical ? aabbScale.scaleX : 1,
    scaleY: moving.horizontal ? aabbScale.scaleY : 1,
  };
}

export function localDimensionsFromAabbSize(
  aabbWidth: number,
  aabbHeight: number,
  rotation: number,
): { width: number; height: number } {
  const snapped = snapSmartCorridorRotation(rotation);

  if (snapped === 90 || snapped === 270) {
    return { width: aabbHeight, height: aabbWidth };
  }

  return { width: aabbWidth, height: aabbHeight };
}

export { getFixedPointFromAnchor, getMovingEdgesFromAnchor } from './anchor.js';
