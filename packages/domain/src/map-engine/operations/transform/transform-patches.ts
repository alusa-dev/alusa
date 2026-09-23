import type { EventMapDTO } from '../../types/event-map-types.js';
import type { TransformPatchSet } from './transform-types.js';

export function buildUndoTransformPatches(map: EventMapDTO, patches: TransformPatchSet): TransformPatchSet {
  return {
    objects: patches.objects.flatMap((entry) => {
      const current = map.objects.find((object) => object.id === entry.id);
      return current ? [{ id: entry.id, patch: Object.fromEntries(Object.keys(entry.patch).map((key) => [key, current[key as keyof typeof current]])) }] : [];
    }),
    seats: patches.seats.flatMap((entry) => {
      const current = map.seats.find((seat) => seat.id === entry.id);
      return current ? [{ id: entry.id, patch: Object.fromEntries(Object.keys(entry.patch).map((key) => [key, current[key as keyof typeof current]])) }] : [];
    }),
  };
}

function isFinitePatch(patch: Record<string, unknown>) {
  return Object.values(patch).every((value) => typeof value !== 'number' || Number.isFinite(value));
}

export function filterFiniteTransformPatches(patches: TransformPatchSet): TransformPatchSet {
  return {
    objects: patches.objects.filter((entry) => isFinitePatch(entry.patch as Record<string, unknown>)),
    seats: patches.seats.filter((entry) => isFinitePatch(entry.patch as Record<string, unknown>)),
  };
}
