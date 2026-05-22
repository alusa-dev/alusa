import type { EventMapObjectDTO } from '../api/event-map-service';

import { getObjectBounds } from './selection-utils';
import {
  clampFontSizeValue,
  getLegacyUniformTextMode,
  getTextMode,
  MIN_FONT_SIZE,
} from './text-object';

export { isMultilineTextObject } from './text-object';

export const MIN_OBJECT_SIZE = 8;
export const MIN_UNIFORM_SCALE = 0.05;
export const MAX_UNIFORM_SCALE = 20;

export function clampObjectSize(value: number) {
  return Math.max(MIN_OBJECT_SIZE, value);
}

export function clampFontSize(value: number) {
  return clampFontSizeValue(value);
}

export function clampUniformScale(value: number) {
  return Math.max(MIN_UNIFORM_SCALE, Math.min(MAX_UNIFORM_SCALE, value));
}

export type ObjectTransformSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fontSize?: number;
  textMode?: 'single-line' | 'multiline';
  type: string;
};

export type BoundsRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export function getObjectTransformSnapshot(object: EventMapObjectDTO): ObjectTransformSnapshot {
  const bounds = getObjectBounds(object);
  const textMode = object.type === 'TEXT' ? getTextMode(object) : undefined;
  return {
    x: object.x,
    y: object.y,
    width: bounds.width,
    height: bounds.height,
    rotation: object.rotation ?? 0,
    fontSize: object.type === 'TEXT' ? Number(object.data.fontSize ?? 22) : undefined,
    textMode: textMode ? getLegacyUniformTextMode(textMode) : undefined,
    type: object.type,
  };
}

export function getSnapshotsUnionBounds(snapshots: ObjectTransformSnapshot[]): BoundsRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const snapshot of snapshots) {
    minX = Math.min(minX, snapshot.x);
    minY = Math.min(minY, snapshot.y);
    maxX = Math.max(maxX, snapshot.x + snapshot.width);
    maxY = Math.max(maxY, snapshot.y + snapshot.height);
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return {
    x: minX,
    y: minY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  };
}

export function computeUniformScale(initial: BoundsRect, next: BoundsRect) {
  if (initial.width <= 0) return 1;
  return clampUniformScale(next.width / initial.width);
}

export function computeUniformTransformPatch(
  snapshot: ObjectTransformSnapshot,
  anchorX: number,
  anchorY: number,
  scale: number,
  rotationDeltaDeg: number,
  options?: { clampDimensions?: boolean },
) {
  const clampDimensions = options?.clampDimensions ?? false;
  let dx = snapshot.x - anchorX;
  let dy = snapshot.y - anchorY;

  if (rotationDeltaDeg !== 0) {
    const rad = (rotationDeltaDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotatedX = dx * cos - dy * sin;
    const rotatedY = dx * sin + dy * cos;
    dx = rotatedX;
    dy = rotatedY;
  }

  const newX = anchorX + dx * scale;
  const newY = anchorY + dy * scale;
  const rawWidth = snapshot.width * scale;
  const rawHeight = snapshot.height * scale;
  const newWidth = clampDimensions ? clampObjectSize(rawWidth) : rawWidth;
  const newHeight = clampDimensions ? clampObjectSize(rawHeight) : rawHeight;
  const newRotation = snapshot.rotation + rotationDeltaDeg;

  if (snapshot.type === 'TEXT') {
    const nextFontSize = clampDimensions
      ? clampFontSize((snapshot.fontSize ?? 22) * scale)
      : Math.max(MIN_FONT_SIZE, (snapshot.fontSize ?? 22) * scale);
    if (snapshot.textMode === 'multiline') {
      return {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
        rotation: newRotation,
        data: { fontSize: nextFontSize },
      };
    }

    return {
      x: newX,
      y: newY,
      width: null as number | null,
      height: null as number | null,
      rotation: newRotation,
      data: { fontSize: nextFontSize },
    };
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
    rotation: newRotation,
  };
}

export function buildUniformTransformUpdates(
  snapshots: Map<string, ObjectTransformSnapshot>,
  anchorX: number,
  anchorY: number,
  scale: number,
  rotationDeltaDeg: number,
  options?: { clampDimensions?: boolean },
) {
  const updates: Array<{ id: string; patch: ReturnType<typeof computeUniformTransformPatch> }> = [];

  for (const [id, snapshot] of snapshots) {
    updates.push({
      id,
      patch: computeUniformTransformPatch(snapshot, anchorX, anchorY, scale, rotationDeltaDeg, options),
    });
  }

  return updates;
}

/** Read the live scale Konva applied to the dragged node (works for shrink and grow). */
export function resolveLiveUniformScale(
  snapshots: Map<string, ObjectTransformSnapshot>,
  getNodeScale: (objectId: string) => { scaleX: number; scaleY: number } | null,
) {
  for (const [objectId, snapshot] of snapshots) {
    if (snapshot.type === 'TEXT') continue;
    const scale = getNodeScale(objectId);
    if (!scale) continue;
    const sx = Math.abs(scale.scaleX);
    const sy = Math.abs(scale.scaleY);
    if (sx > 0.001 || sy > 0.001) {
      return clampUniformScale(Math.max(sx, sy));
    }
  }

  return 1;
}
