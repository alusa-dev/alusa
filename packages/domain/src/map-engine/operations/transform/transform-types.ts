import type { EventMapObjectDTO, EventSeatDTO } from '../../types/event-map-types.js';

export type TransformPatchSet = {
  objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
};

export function emptyTransformPatchSet(): TransformPatchSet {
  return { objects: [], seats: [] };
}

export function hasTransformPatches(patches: TransformPatchSet) {
  return patches.objects.length > 0 || patches.seats.length > 0;
}
