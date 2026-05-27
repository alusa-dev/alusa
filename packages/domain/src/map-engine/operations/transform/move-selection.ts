import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { emptyTransformPatchSet, hasTransformPatches, type TransformPatchSet } from './transform-types.js';
import { buildUndoTransformPatches, filterFiniteTransformPatches } from './transform-patches.js';
import { resolveOperationSelection } from '../selection/selection-resolver.js';

export type MoveSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
  delta: { x: number; y: number };
};

export type MoveSelectionResult = {
  patches: TransformPatchSet;
  undoPatches: TransformPatchSet;
  selection: MapSelection;
  warnings: string[];
};

export function moveSelection(input: MoveSelectionInput): MoveSelectionResult {
  const delta = input.delta;
  const patches = emptyTransformPatchSet();
  const resolved = resolveOperationSelection(input.map, input.selection);

  if (
    resolved.blocked ||
    !Number.isFinite(delta.x) ||
    !Number.isFinite(delta.y) ||
    (Math.abs(delta.x) < 0.001 && Math.abs(delta.y) < 0.001)
  ) {
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
    patches.objects.push({ id, patch: { x: object.x + delta.x, y: object.y + delta.y } });
  }

  for (const id of resolved.seatIds) {
    const seat = input.map.seats.find((entry) => entry.id === id);
    if (!seat) continue;
    patches.seats.push({ id, patch: { x: seat.x + delta.x, y: seat.y + delta.y } });
  }

  for (const id of resolved.seatGroupIds) {
    const group = input.map.seatGroups?.find((entry) => entry.id === id);
    if (!group) continue;
    patches.seatGroups.push({ id, patch: { x: group.x + delta.x, y: group.y + delta.y } });
  }

  const safePatches = filterFiniteTransformPatches(patches);

  return {
    patches: safePatches,
    undoPatches: hasTransformPatches(safePatches) ? buildUndoTransformPatches(input.map, safePatches) : emptyTransformPatchSet(),
    selection: resolved.selection,
    warnings: resolved.warnings,
  };
}
