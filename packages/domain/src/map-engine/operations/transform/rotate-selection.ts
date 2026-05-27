import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { resolveOperationSelection } from '../selection/selection-resolver.js';
import { getObjectBounds } from '../../layout/object-bounds.js';
import { getSeatBounds, unionBounds, type BoundsRect } from '../../geometry/bounds.js';
import { centerOf } from '../../geometry/bounds.js';
import {
  normalizeRotation,
  rotatePoint,
  shortestRotationDelta,
  snapAngleToStep,
  type Point2D,
} from '../../geometry/rotation.js';
import {
  applyCorridorRotationPreservingCenter,
  getCorridorWorldCenter,
} from '../../layout/corridor-rotation.js';
import { getSeatGroupWorldBounds } from '../../layout/seat-group-bounds.js';
import { parentLocalToWorld, worldToParentLocal } from '../../geometry/transform-compose.js';
import { emptyTransformPatchSet, hasTransformPatches, type TransformPatchSet } from './transform-types.js';
import { buildUndoTransformPatches } from './transform-patches.js';

export type RotateSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
  angleDelta: number;
  pivot?: Point2D | null;
  mode?: 'free' | 'snap';
  snapStepDegrees?: number;
};

export type RotateSelectionResult = {
  patches: TransformPatchSet;
  undoPatches: TransformPatchSet;
  selection: MapSelection;
  pivot: Point2D | null;
  angleDelta: number;
  warnings: string[];
};

type RotatableSelection = {
  selection: MapSelection;
  objectIds: string[];
  seatIds: string[];
  seatGroupIds: string[];
  warnings: string[];
  blocked: boolean;
};

const EPSILON = 0.001;

function isFinitePoint(point: Point2D | null | undefined): point is Point2D {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function roundValue(value: number) {
  return Number(value.toFixed(4));
}

function roundPoint(point: Point2D): Point2D {
  return { x: roundValue(point.x), y: roundValue(point.y) };
}

function normalizeDelta(delta: number, mode: 'free' | 'snap', snapStepDegrees: number) {
  if (!Number.isFinite(delta)) return 0;
  if (mode !== 'snap') return delta;
  return shortestRotationDelta(0, snapAngleToStep(delta, snapStepDegrees));
}

function resolveRotatableSelection(map: EventMapDTO, selection: MapSelection): RotatableSelection {
  return resolveOperationSelection(map, selection);
}

function rotatedRectWorldBounds(
  item: Pick<EventMapObjectDTO, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'type' | 'data'>,
): BoundsRect {
  const bounds = getObjectBounds(item);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((corner) => rotatePoint(corner, { x: item.x, y: item.y }, item.rotation ?? 0));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function objectWorldCenter(object: EventMapObjectDTO) {
  if (object.type === 'CORRIDOR') return getCorridorWorldCenter(object);
  return centerOf(rotatedRectWorldBounds(object));
}

function objectTopLeftForCenter(object: EventMapObjectDTO, center: Point2D, rotation: number) {
  const bounds = getObjectBounds(object);
  const localCenter = {
    x: bounds.x + bounds.width / 2 - object.x,
    y: bounds.y + bounds.height / 2 - object.y,
  };
  const rotatedLocalCenter = rotatePoint(localCenter, { x: 0, y: 0 }, rotation);
  return {
    x: center.x - rotatedLocalCenter.x,
    y: center.y - rotatedLocalCenter.y,
  };
}

function resolveSelectionBounds(map: EventMapDTO, rotatable: RotatableSelection): BoundsRect | null {
  const bounds: BoundsRect[] = [];

  for (const id of rotatable.objectIds) {
    const object = map.objects.find((entry) => entry.id === id);
    if (!object) continue;
    if (object.type === 'CORRIDOR') {
      const center = getCorridorWorldCenter(object);
      bounds.push({ x: center.x, y: center.y, width: 0, height: 0 });
    } else {
      bounds.push(rotatedRectWorldBounds(object));
    }
  }

  for (const id of rotatable.seatIds) {
    const seat = map.seats.find((entry) => entry.id === id);
    if (seat) bounds.push(getSeatBounds(seat));
  }

  for (const id of rotatable.seatGroupIds) {
    const group = map.seatGroups?.find((entry) => entry.id === id);
    if (group) bounds.push(getSeatGroupWorldBounds(group, map.seats));
  }

  return unionBounds(bounds);
}

function resolveRotationPivot(map: EventMapDTO, rotatable: RotatableSelection, explicitPivot?: Point2D | null) {
  if (isFinitePoint(explicitPivot)) return explicitPivot;
  const bounds = resolveSelectionBounds(map, rotatable);
  return bounds ? centerOf(bounds) : null;
}

function buildObjectRotationPatch(object: EventMapObjectDTO, pivot: Point2D, angleDelta: number) {
  const nextRotation = normalizeRotation((object.rotation ?? 0) + angleDelta);

  if (object.type === 'CORRIDOR') {
    const center = getCorridorWorldCenter(object);
    const nextCenter = rotatePoint(center, pivot, angleDelta);
    const next: EventMapObjectDTO = { ...object, data: { ...object.data } };
    const centerDelta = { x: nextCenter.x - center.x, y: nextCenter.y - center.y };
    next.x += centerDelta.x;
    next.y += centerDelta.y;
    applyCorridorRotationPreservingCenter(next, nextRotation, next, { snap: false });
    return { x: roundValue(next.x), y: roundValue(next.y), rotation: next.rotation };
  }

  const center = objectWorldCenter(object);
  const nextCenter = rotatePoint(center, pivot, angleDelta);
  const topLeft = objectTopLeftForCenter(object, nextCenter, nextRotation);
  return {
    x: roundValue(topLeft.x),
    y: roundValue(topLeft.y),
    rotation: nextRotation,
  };
}

function buildSeatRotationPatch(seat: EventSeatDTO, pivot: Point2D, angleDelta: number) {
  const nextPoint = rotatePoint({ x: seat.x, y: seat.y }, pivot, angleDelta);
  return {
    ...roundPoint(nextPoint),
    rotation: normalizeRotation((seat.rotation ?? 0) + angleDelta),
  };
}

function buildSeatGroupRotationPatch(
  group: EventSeatGroupDTO,
  seats: EventSeatDTO[],
  pivot: Point2D,
  angleDelta: number,
) {
  const bounds = getSeatGroupWorldBounds(group, seats);
  const center = centerOf(bounds);
  const nextCenter = rotatePoint(center, pivot, angleDelta);
  const localCenter = worldToParentLocal(center, group);
  const nextRotation = normalizeRotation((group.rotation ?? 0) + angleDelta);
  const rotatedLocalCenter = parentLocalToWorld(localCenter, {
    x: 0,
    y: 0,
    rotation: nextRotation,
  });

  return {
    x: roundValue(nextCenter.x - rotatedLocalCenter.x),
    y: roundValue(nextCenter.y - rotatedLocalCenter.y),
    rotation: nextRotation,
  };
}

function isNoopPatch(current: { x: number; y: number; rotation: number }, patch: { x: number; y: number; rotation: number }) {
  return (
    Math.abs(current.x - patch.x) < EPSILON &&
    Math.abs(current.y - patch.y) < EPSILON &&
    Math.abs(normalizeRotation(current.rotation) - normalizeRotation(patch.rotation)) < EPSILON
  );
}

export function rotateSelection(input: RotateSelectionInput): RotateSelectionResult {
  const mode = input.mode ?? 'free';
  const angleDelta = normalizeDelta(input.angleDelta, mode, input.snapStepDegrees ?? 15);
  const rotatable = resolveRotatableSelection(input.map, input.selection);
  const patches = emptyTransformPatchSet();

  if (rotatable.blocked || Math.abs(angleDelta) < EPSILON) {
    return {
      patches,
      undoPatches: emptyTransformPatchSet(),
      selection: input.selection,
      pivot: null,
      angleDelta: 0,
      warnings: rotatable.warnings,
    };
  }

  const pivot = resolveRotationPivot(input.map, rotatable, input.pivot);
  if (!pivot) {
    return {
      patches,
      undoPatches: emptyTransformPatchSet(),
      selection: input.selection,
      pivot: null,
      angleDelta: 0,
      warnings: rotatable.warnings,
    };
  }

  for (const id of rotatable.objectIds) {
    const object = input.map.objects.find((entry) => entry.id === id);
    if (!object) continue;
    const patch = buildObjectRotationPatch(object, pivot, angleDelta);
    if (!isNoopPatch(object, patch)) patches.objects.push({ id, patch });
  }

  for (const id of rotatable.seatIds) {
    const seat = input.map.seats.find((entry) => entry.id === id);
    if (!seat) continue;
    const patch = buildSeatRotationPatch(seat, pivot, angleDelta);
    if (!isNoopPatch(seat, patch)) patches.seats.push({ id, patch });
  }

  for (const id of rotatable.seatGroupIds) {
    const group = input.map.seatGroups?.find((entry) => entry.id === id);
    if (!group) continue;
    const patch = buildSeatGroupRotationPatch(group, input.map.seats, pivot, angleDelta);
    if (!isNoopPatch(group, patch)) patches.seatGroups.push({ id, patch });
  }

  return {
    patches,
    undoPatches: hasTransformPatches(patches) ? buildUndoTransformPatches(input.map, patches) : emptyTransformPatchSet(),
    selection: rotatable.selection,
    pivot,
    angleDelta,
    warnings: rotatable.warnings,
  };
}

export function selectionFromRotationPatchIds(input: {
  objects?: Array<{ id: string }>;
  seats?: Array<{ id: string }>;
  seatGroups?: Array<{ id: string }>;
}): MapSelection {
  return [
    ...(input.objects ?? []).map((entry) => ({ type: 'object' as const, id: entry.id })),
    ...(input.seats ?? []).map((entry) => ({ type: 'seat' as const, id: entry.id })),
    ...(input.seatGroups ?? []).map((entry) => ({ type: 'seatgroup' as const, id: entry.id })),
  ];
}
