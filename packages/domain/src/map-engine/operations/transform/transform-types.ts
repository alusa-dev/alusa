import type {
  EventMapObjectDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '../../types/event-map-types.js';

export type TransformPatchSet = {
  objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  seatGroups: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
};

export function emptyTransformPatchSet(): TransformPatchSet {
  return { objects: [], seats: [], seatGroups: [] };
}

export function hasTransformPatches(patches: TransformPatchSet) {
  return patches.objects.length > 0 || patches.seats.length > 0 || patches.seatGroups.length > 0;
}
