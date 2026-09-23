import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getObjectBounds } from '../../layout/object-bounds.js';
import { getSeatBounds, unionBounds, centerOf } from '../../geometry/bounds.js';
import { emptyTransformPatchSet, hasTransformPatches, type TransformPatchSet } from './transform-types.js';
import { buildUndoTransformPatches, filterFiniteTransformPatches } from './transform-patches.js';
import { resolveOperationSelection } from '../selection/selection-resolver.js';

export type ResizeSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
  scaleX?: number;
  scaleY?: number;
  pivot?: { x: number; y: number } | null;
  patches?: Partial<TransformPatchSet>;
};

export type ResizeSelectionResult = {
  patches: TransformPatchSet;
  undoPatches: TransformPatchSet;
  selection: MapSelection;
  warnings: string[];
};

function resolvePivot(map: EventMapDTO, resolved: ReturnType<typeof resolveOperationSelection>, explicit?: { x: number; y: number } | null) {
  if (explicit && Number.isFinite(explicit.x) && Number.isFinite(explicit.y)) return explicit;
  const bounds = [
    ...resolved.objectIds
      .map((id) => map.objects.find((entry) => entry.id === id))
      .filter((entry): entry is EventMapObjectDTO => Boolean(entry))
      .map(getObjectBounds),
    ...resolved.seatIds
      .map((id) => map.seats.find((entry) => entry.id === id))
      .filter((entry): entry is EventSeatDTO => Boolean(entry))
      .map(getSeatBounds),
  ];
  const union = unionBounds(bounds);
  return union ? centerOf(union) : null;
}

function normalizeExplicitPatches(patches?: Partial<TransformPatchSet>): TransformPatchSet {
  return {
    objects: patches?.objects ?? [],
    seats: patches?.seats ?? [],
  };
}

function filterExplicitPatchesToSelection(patches: TransformPatchSet, resolved: ReturnType<typeof resolveOperationSelection>) {
  const objectIds = new Set(resolved.objectIds);
  const seatIds = new Set(resolved.seatIds);

  return {
    objects: patches.objects.filter((entry) => objectIds.has(entry.id)),
    seats: patches.seats.filter((entry) => seatIds.has(entry.id)),
  };
}

export function resizeSelection(input: ResizeSelectionInput): ResizeSelectionResult {
  const resolved = resolveOperationSelection(input.map, input.selection);
  if (resolved.blocked) {
    return {
      patches: emptyTransformPatchSet(),
      undoPatches: emptyTransformPatchSet(),
      selection: input.selection,
      warnings: resolved.warnings,
    };
  }

  if (input.patches) {
    const explicit = filterExplicitPatchesToSelection(normalizeExplicitPatches(input.patches), resolved);
    const safe = filterFiniteTransformPatches(explicit);
    return {
      patches: safe,
      undoPatches: hasTransformPatches(safe) ? buildUndoTransformPatches(input.map, safe) : emptyTransformPatchSet(),
      selection: resolved.selection.length > 0 ? resolved.selection : input.selection,
      warnings: resolved.warnings,
    };
  }

  const sx = input.scaleX ?? 1;
  const sy = input.scaleY ?? sx;
  const patches = emptyTransformPatchSet();
  const pivot = resolvePivot(input.map, resolved, input.pivot);

  if (!pivot || !Number.isFinite(sx) || !Number.isFinite(sy) || (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001)) {
    return {
      patches,
      undoPatches: emptyTransformPatchSet(),
      selection: input.selection,
      warnings: resolved.warnings,
    };
  }

  for (const id of resolved.objectIds) {
    const object = input.map.objects.find((entry) => entry.id === id);
    if (!object) continue;
    const bounds = getObjectBounds(object);
    patches.objects.push({
      id,
      patch: {
        x: pivot.x + (object.x - pivot.x) * sx,
        y: pivot.y + (object.y - pivot.y) * sy,
        width: Math.max(8, bounds.width * Math.abs(sx)),
        height: Math.max(8, bounds.height * Math.abs(sy)),
      },
    });
  }

  for (const id of resolved.seatIds) {
    const seat = input.map.seats.find((entry) => entry.id === id);
    if (!seat) continue;
    const scale = Math.max(Math.abs(sx), Math.abs(sy));
    patches.seats.push({
      id,
      patch: {
        x: pivot.x + (seat.x - pivot.x) * sx,
        y: pivot.y + (seat.y - pivot.y) * sy,
        size: Math.max(8, (seat.size ?? 24) * scale),
      },
    });
  }


  const safe = filterFiniteTransformPatches(patches);
  return {
    patches: safe,
    undoPatches: hasTransformPatches(safe) ? buildUndoTransformPatches(input.map, safe) : emptyTransformPatchSet(),
    selection: resolved.selection,
    warnings: resolved.warnings,
  };
}
