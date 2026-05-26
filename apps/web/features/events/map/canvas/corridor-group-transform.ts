import { corridorWorldCenterToTopLeft, getCorridorWorldCenter, normalizeRotation, snapSmartCorridorRotation } from '@alusa/domain';
import type { CorridorTransformGeometry } from '@alusa/domain';
import type { EventMapObjectDTO } from '../api/event-map-service';
import { eventMapObjectToCorridorPolygon, polygonBounds } from './corridor-domain-bridge';

export type CorridorTransformSnapshot = {
  id: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
};

export type CorridorGroupPivot = {
  centerX: number;
  centerY: number;
};

export function buildCorridorTransformSnapshot(object: EventMapObjectDTO): CorridorTransformSnapshot {
  const width = object.width ?? 32;
  const height = object.height ?? 280;
  const center = getCorridorWorldCenter(object);

  return {
    id: object.id,
    centerX: center.x,
    centerY: center.y,
    width,
    height,
    rotation: object.rotation ?? 0,
  };
}

/** Pivot at the center of the union AABB of all corridor body polygons. */
export function getCorridorGroupPivot(objects: EventMapObjectDTO[]): CorridorGroupPivot {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const object of objects) {
    const bounds = polygonBounds(eventMapObjectToCorridorPolygon(object));
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (!Number.isFinite(minX)) {
    return { centerX: 0, centerY: 0 };
  }

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/** Optional quarter-turn snap for modifier-driven corridor rotation. */
export function resolveSnappedCorridorGroupRotation(
  baseRotation: number,
  rotationDeltaDeg: number,
): { rotation: number; effectiveDeltaDeg: number } {
  const base = snapSmartCorridorRotation(baseRotation);
  const rotation = snapSmartCorridorRotation(baseRotation + rotationDeltaDeg);
  let effectiveDeltaDeg = rotation - base;
  while (effectiveDeltaDeg > 180) effectiveDeltaDeg -= 360;
  while (effectiveDeltaDeg < -180) effectiveDeltaDeg += 360;
  return { rotation, effectiveDeltaDeg };
}

export function computeCorridorGroupRotationGeometry(
  snapshot: CorridorTransformSnapshot,
  pivot: CorridorGroupPivot,
  rotationDeltaDeg: number,
  options?: { snap?: boolean },
): CorridorTransformGeometry {
  const resolved =
    options?.snap === true
      ? resolveSnappedCorridorGroupRotation(snapshot.rotation, rotationDeltaDeg)
      : {
          rotation: normalizeRotation(snapshot.rotation + rotationDeltaDeg),
          effectiveDeltaDeg: rotationDeltaDeg,
        };
  const rotation = resolved.rotation;
  const orbitDeltaDeg = resolved.effectiveDeltaDeg;

  const rad = (orbitDeltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = snapshot.centerX - pivot.centerX;
  const dy = snapshot.centerY - pivot.centerY;
  const newCenterX = pivot.centerX + dx * cos - dy * sin;
  const newCenterY = pivot.centerY + dx * sin + dy * cos;
  const topLeft = corridorWorldCenterToTopLeft(
    newCenterX,
    newCenterY,
    snapshot.width,
    snapshot.height,
    rotation,
    { snap: false },
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: snapshot.width,
    height: snapshot.height,
    rotation,
  };
}

export function buildCorridorGroupRotationUpdates(
  snapshots: CorridorTransformSnapshot[],
  pivot: CorridorGroupPivot,
  rotationDeltaDeg: number,
  options?: { snap?: boolean },
) {
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    geometry: computeCorridorGroupRotationGeometry(snapshot, pivot, rotationDeltaDeg, options),
  }));
}

export type CorridorGroupBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CorridorGroupTransformSession = {
  snapshots: CorridorTransformSnapshot[];
  pivot: CorridorGroupPivot;
  initialBounds: CorridorGroupBounds;
  initialRotation: number;
  anchor: string;
};

/** Union AABB of corridor body polygons in world space. */
export function getCorridorGroupBounds(objects: EventMapObjectDTO[]): CorridorGroupBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const object of objects) {
    const bounds = polygonBounds(eventMapObjectToCorridorPolygon(object));
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

export function createCorridorGroupTransformSession(
  objects: EventMapObjectDTO[],
  initialRotation: number,
  anchor: string,
  initialBounds?: CorridorGroupBounds,
): CorridorGroupTransformSession | null {
  const corridors = objects.filter((object) => object.type === 'CORRIDOR');
  if (corridors.length < 2) return null;

  return {
    snapshots: corridors.map((object) => buildCorridorTransformSnapshot(object)),
    pivot: getCorridorGroupPivot(corridors),
    initialBounds: initialBounds ?? getCorridorGroupBounds(corridors),
    initialRotation,
    anchor,
  };
}
