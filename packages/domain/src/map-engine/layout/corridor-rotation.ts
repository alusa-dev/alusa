import type { EventMapObjectDTO } from '../types/event-map-types.js';
import { normalizeRotation, snapSmartCorridorRotation } from '../geometry/rotation.js';

export type CorridorTransformGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export const DEFAULT_CORRIDOR_BODY_HEIGHT = 280;

/** World-space center of the corridor body (top-left anchor + rotation). */
export function getCorridorWorldCenter(
  corridor: Pick<EventMapObjectDTO, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  defaultThickness = 32,
) {
  const width = corridor.width ?? defaultThickness;
  const height = corridor.height ?? DEFAULT_CORRIDOR_BODY_HEIGHT;
  const rotation = corridor.rotation ?? 0;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = width / 2;
  const halfH = height / 2;

  return {
    x: corridor.x + halfW * cos - halfH * sin,
    y: corridor.y + halfW * sin + halfH * cos,
  };
}

/** Top-left model anchor from a fixed world center and rotation. */
export function corridorWorldCenterToTopLeft(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotationDegrees: number,
  options?: { snap?: boolean },
) {
  const rotation =
    options?.snap === true
      ? snapSmartCorridorRotation(rotationDegrees)
      : normalizeRotation(rotationDegrees);
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = width / 2;
  const halfH = height / 2;

  return {
    x: centerX - halfW * cos + halfH * sin,
    y: centerY - halfW * sin - halfH * cos,
  };
}

export function corridorModelFromCenterTransform(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  rotation: number,
): CorridorTransformGeometry {
  const normalized = normalizeRotation(rotation);
  const topLeft = corridorWorldCenterToTopLeft(centerX, centerY, width, height, normalized, { snap: false });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width,
    height,
    rotation: normalized,
  };
}

export function corridorCenterTransformFromModel(
  corridor: Pick<EventMapObjectDTO, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  defaultThickness = 32,
) {
  const width = corridor.width ?? defaultThickness;
  const height = corridor.height ?? DEFAULT_CORRIDOR_BODY_HEIGHT;
  const center = getCorridorWorldCenter(corridor, defaultThickness);

  return {
    centerX: center.x,
    centerY: center.y,
    offsetX: width / 2,
    offsetY: height / 2,
    rotation: corridor.rotation ?? 0,
    width,
    height,
  };
}

/** Rotate in place around the corridor world center. */
export function applyCorridorRotationPreservingCenter(
  corridor: EventMapObjectDTO,
  nextRotation: number,
  previous?: EventMapObjectDTO,
  options?: { snap?: boolean },
  defaultThickness = 32,
) {
  const ref = previous ?? corridor;
  const width = corridor.width ?? ref.width ?? defaultThickness;
  const height = corridor.height ?? ref.height ?? DEFAULT_CORRIDOR_BODY_HEIGHT;
  const center = getCorridorWorldCenter(
    {
      x: ref.x,
      y: ref.y,
      width,
      height,
      rotation: ref.rotation ?? 0,
    },
    defaultThickness,
  );
  const normalized =
    options?.snap === true
      ? snapSmartCorridorRotation(nextRotation)
      : normalizeRotation(nextRotation);
  const topLeft = corridorWorldCenterToTopLeft(center.x, center.y, width, height, normalized, options);

  corridor.width = width;
  corridor.height = height;
  corridor.x = topLeft.x;
  corridor.y = topLeft.y;
  corridor.rotation = normalized;
}

export function isCorridorRotationOnlyTransform(
  patch: Partial<EventMapObjectDTO>,
  previous: EventMapObjectDTO,
) {
  if (typeof patch.rotation !== 'number') return false;

  const nextRotation = normalizeRotation(patch.rotation);
  if (nextRotation === normalizeRotation(previous.rotation ?? 0)) return false;

  const widthSame =
    patch.width === undefined ||
    patch.width == null ||
    previous.width == null ||
    Math.abs(patch.width - previous.width) < 0.001;
  const heightSame =
    patch.height === undefined ||
    patch.height == null ||
    previous.height == null ||
    Math.abs(patch.height - previous.height) < 0.001;
  const xSame =
    patch.x === undefined || Math.abs(patch.x - previous.x) < 0.001;
  const ySame =
    patch.y === undefined || Math.abs(patch.y - previous.y) < 0.001;

  return widthSame && heightSame && xSame && ySame;
}

export function effectiveCorridorAxisAtRotation(
  storedAxis: 'vertical' | 'horizontal',
  rotationDegrees: number,
): 'vertical' | 'horizontal' {
  const normalized = normalizeRotation(rotationDegrees);
  const nearestQuarter = Math.round(normalized / 90) % 4;
  if (nearestQuarter === 1 || nearestQuarter === 3) {
    return storedAxis === 'vertical' ? 'horizontal' : 'vertical';
  }
  return storedAxis;
}

export { normalizeRotation, snapSmartCorridorRotation };
