import type { EventMapDTO } from '../../types/event-map-types.js';
import { emptyTransformPatchSet, type TransformPatchSet } from './transform-types.js';

export function buildUndoTransformPatches(map: EventMapDTO, patches: TransformPatchSet): TransformPatchSet {
  const undo = emptyTransformPatchSet();

  for (const entry of patches.objects) {
    const object = map.objects.find((candidate) => candidate.id === entry.id);
    if (!object) continue;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(entry.patch) as Array<keyof typeof entry.patch>) {
      patch[key] = object[key as keyof typeof object];
    }
    undo.objects.push({ id: entry.id, patch });
  }

  for (const entry of patches.seats) {
    const seat = map.seats.find((candidate) => candidate.id === entry.id);
    if (!seat) continue;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(entry.patch) as Array<keyof typeof entry.patch>) {
      patch[key] = seat[key as keyof typeof seat];
    }
    undo.seats.push({ id: entry.id, patch });
  }

  for (const entry of patches.seatGroups) {
    const group = map.seatGroups?.find((candidate) => candidate.id === entry.id);
    if (!group) continue;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(entry.patch) as Array<keyof typeof entry.patch>) {
      patch[key] = group[key as keyof typeof group];
    }
    undo.seatGroups.push({ id: entry.id, patch });
  }

  return undo;
}

export function filterFiniteTransformPatches(patches: TransformPatchSet): TransformPatchSet {
  const isFinitePatch = (patch: Record<string, unknown>) =>
    Object.values(patch).every((value) => typeof value !== 'number' || Number.isFinite(value));

  return {
    objects: patches.objects.filter((entry) => isFinitePatch(entry.patch as Record<string, unknown>)),
    seats: patches.seats.filter((entry) => isFinitePatch(entry.patch as Record<string, unknown>)),
    seatGroups: patches.seatGroups.filter((entry) => isFinitePatch(entry.patch as Record<string, unknown>)),
  };
}
