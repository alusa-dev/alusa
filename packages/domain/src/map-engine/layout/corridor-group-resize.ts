import {
  clampUniformScale,
  constrainAabbScaleForAnchor,
  getFixedPointFromAnchor,
  localDimensionsFromAabbSize,
  mapLocalScaleToAabbScale,
  MIN_CORRIDOR_SIZE,
  MIN_UNIFORM_SCALE,
  type ResizeScale,
} from '../geometry/scale.js';
import { corridorWorldCenterToTopLeft } from './corridor-rotation.js';
import { eventMapObjectToCorridorPolygon, polygonBounds } from './corridor-geometry.js';
import type { CorridorTransformGeometry } from './corridor-rotation.js';
import type {
  CorridorGroupBounds,
  CorridorTransformSnapshot,
} from './corridor-group-transform.js';

export type CorridorGroupFixedPoint = {
  x: number;
  y: number;
};

export type CorridorResizeScale = ResizeScale;

export function snapshotToAabbBounds(snapshot: CorridorTransformSnapshot): CorridorGroupBounds {
  const topLeft = corridorWorldCenterToTopLeft(
    snapshot.centerX,
    snapshot.centerY,
    snapshot.width,
    snapshot.height,
    snapshot.rotation,
    { snap: false },
  );

  return polygonBounds(
    eventMapObjectToCorridorPolygon({
      id: snapshot.id,
      levelId: '',
      sectionId: null,
      type: 'CORRIDOR',
      data: {},
      x: topLeft.x,
      y: topLeft.y,
      width: snapshot.width,
      height: snapshot.height,
      rotation: snapshot.rotation,
      locked: false,
      hidden: false,
      sortOrder: 0,
    }),
  );
}

/** Resize with anchor fixed point on the world AABB (matches Konva Transformer). */
export function computeCorridorResizeGeometry(
  snapshot: CorridorTransformSnapshot,
  bounds: CorridorGroupBounds,
  anchor: string,
  localScale: CorridorResizeScale,
  itemBounds: CorridorGroupBounds = bounds,
): CorridorTransformGeometry {
  const aabbScale = constrainAabbScaleForAnchor(
    anchor,
    mapLocalScaleToAabbScale(snapshot.rotation, localScale.scaleX, localScale.scaleY),
  );

  const scaleAabbX = Math.max(
    aabbScale.scaleX,
    MIN_CORRIDOR_SIZE / Math.max(itemBounds.width, MIN_CORRIDOR_SIZE),
  );
  const scaleAabbY = Math.max(
    aabbScale.scaleY,
    MIN_CORRIDOR_SIZE / Math.max(itemBounds.height, MIN_CORRIDOR_SIZE),
  );

  const targetAabbWidth = Math.max(MIN_CORRIDOR_SIZE, itemBounds.width * scaleAabbX);
  const targetAabbHeight = Math.max(MIN_CORRIDOR_SIZE, itemBounds.height * scaleAabbY);
  const { width, height } = localDimensionsFromAabbSize(targetAabbWidth, targetAabbHeight, snapshot.rotation);

  const fixedPoint = getFixedPointFromAnchor(bounds, anchor);
  const dx = snapshot.centerX - fixedPoint.x;
  const dy = snapshot.centerY - fixedPoint.y;
  const newCenterX = fixedPoint.x + dx * scaleAabbX;
  const newCenterY = fixedPoint.y + dy * scaleAabbY;
  const topLeft = corridorWorldCenterToTopLeft(
    newCenterX,
    newCenterY,
    width,
    height,
    snapshot.rotation,
    { snap: false },
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(MIN_CORRIDOR_SIZE, width),
    height: Math.max(MIN_CORRIDOR_SIZE, height),
    rotation: snapshot.rotation,
  };
}

/** @deprecated Prefer passing Konva local scaleX/scaleY directly. */
export function resolveCorridorResizeScale(
  snapshot: CorridorTransformSnapshot,
  proposedWidth: number,
  proposedHeight: number,
): CorridorResizeScale {
  return {
    scaleX: proposedWidth / snapshot.width,
    scaleY: proposedHeight / snapshot.height,
  };
}

export function resolveLiveCorridorGroupScale(
  snapshots: CorridorTransformSnapshot[],
  getNodeScale: (objectId: string) => { scaleX: number; scaleY: number } | null,
) {
  let maxScale = 1;

  for (const snapshot of snapshots) {
    const scale = getNodeScale(snapshot.id);
    if (!scale) continue;
    const sx = Math.abs(scale.scaleX);
    const sy = Math.abs(scale.scaleY);
    if (sx > MIN_UNIFORM_SCALE || sy > MIN_UNIFORM_SCALE) {
      maxScale = Math.max(maxScale, clampUniformScale(Math.max(sx, sy)));
    }
  }

  return maxScale;
}

export function getCorridorGroupFixedPoint(
  bounds: CorridorGroupBounds,
  anchor: string,
): CorridorGroupFixedPoint {
  return getFixedPointFromAnchor(bounds, anchor);
}

export function buildCorridorGroupResizeUpdates(
  snapshots: CorridorTransformSnapshot[],
  bounds: CorridorGroupBounds,
  anchor: string,
  scale: number,
) {
  const clampedScale = clampUniformScale(scale);

  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    geometry: computeCorridorResizeGeometry(
      snapshot,
      bounds,
      anchor,
      {
        scaleX: clampedScale,
        scaleY: clampedScale,
      },
      snapshotToAabbBounds(snapshot),
    ),
  }));
}

export {
  clampUniformScale,
  constrainAabbScaleForAnchor,
  localDimensionsFromAabbSize,
  mapLocalScaleToAabbScale,
};
