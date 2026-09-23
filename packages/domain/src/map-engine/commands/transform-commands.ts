import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../types/event-map-types.js';
import { selectionFromRotationPatchIds } from '../operations/transform/rotate-selection.js';
import { shortestRotationDelta } from '../geometry/rotation.js';

export type TransformCommandPayload = {
  objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  skipSeatBaseLayoutTranslation?: boolean;
};

export type ClassifiedTransformCommand =
  | { type: 'RESIZE_OBJECTS'; payload: TransformCommandPayload }
  | { type: 'ROTATE_OBJECTS'; payload: { objects: Array<{ id: string; patch: Partial<Pick<EventMapObjectDTO, 'x' | 'y' | 'rotation'>> }>; seats: Array<{ id: string; patch: Partial<Pick<EventSeatDTO, 'x' | 'y' | 'rotation'>> }> } }
  | { type: 'ROTATE_SELECTION'; payload: { selection: ReturnType<typeof selectionFromRotationPatchIds>; angleDelta: number; mode: 'free' } }
  | { type: 'MOVE_OBJECTS'; payload: { objectIds: string[]; seatIds: string[]; delta: { x: number; y: number } } };

const EPSILON = 0.001;
function nearlyEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= EPSILON;
}
function isRotationOnlyObjectPatch(object: EventMapObjectDTO, patch: Partial<EventMapObjectDTO>) {
  if (object.type === 'TEXT' || patch.data !== undefined) return false;
  if (patch.width !== undefined && !nearlyEqual(patch.width, object.width)) return false;
  if (patch.height !== undefined && !nearlyEqual(patch.height, object.height)) return false;
  return patch.rotation !== undefined || patch.x !== undefined || patch.y !== undefined;
}
function isRotationOnlySeatPatch(seat: EventSeatDTO, patch: Partial<EventSeatDTO>) {
  if (patch.size !== undefined && !nearlyEqual(patch.size, seat.size)) return false;
  return patch.rotation !== undefined || patch.x !== undefined || patch.y !== undefined;
}
function isTranslationOnlyObjectPatch(object: EventMapObjectDTO, patch: Partial<EventMapObjectDTO>) {
  if (object.type === 'TEXT' || patch.data !== undefined) return false;
  if (patch.rotation !== undefined && !nearlyEqual(patch.rotation, object.rotation)) return false;
  if (patch.width !== undefined && !nearlyEqual(patch.width, object.width)) return false;
  if (patch.height !== undefined && !nearlyEqual(patch.height, object.height)) return false;
  return patch.x !== undefined || patch.y !== undefined;
}
function isTranslationOnlySeatPatch(seat: EventSeatDTO, patch: Partial<EventSeatDTO>) {
  if (patch.rotation !== undefined && !nearlyEqual(patch.rotation, seat.rotation)) return false;
  if (patch.size !== undefined && !nearlyEqual(patch.size, seat.size)) return false;
  return patch.x !== undefined || patch.y !== undefined;
}
function sharedDelta(objects: Array<{ object: EventMapObjectDTO; patch: Partial<EventMapObjectDTO> }>, seats: Array<{ seat: EventSeatDTO; patch: Partial<EventSeatDTO> }>) {
  const deltas = [
    ...objects.filter(({ patch }) => patch.x !== undefined || patch.y !== undefined).map(({ object, patch }) => ({ x: (patch.x ?? object.x) - object.x, y: (patch.y ?? object.y) - object.y })),
    ...seats.filter(({ patch }) => patch.x !== undefined || patch.y !== undefined).map(({ seat, patch }) => ({ x: (patch.x ?? seat.x) - seat.x, y: (patch.y ?? seat.y) - seat.y })),
  ];
  const first = deltas[0];
  return first && deltas.every((delta) => nearlyEqual(delta.x, first.x) && nearlyEqual(delta.y, first.y)) ? first : null;
}

export function classifyTransformPayload(payload: TransformCommandPayload, map: EventMapDTO | null): ClassifiedTransformCommand | null {
  const objects = payload.objects ?? [];
  const seats = payload.seats ?? [];
  if (objects.length === 0 && seats.length === 0) return null;
  const objectEntries = objects.map((entry) => { const object = map?.objects.find((candidate) => candidate.id === entry.id); return object ? { object, patch: entry.patch } : null; }).filter((entry): entry is { object: EventMapObjectDTO; patch: Partial<EventMapObjectDTO> } => Boolean(entry));
  const seatEntries = seats.map((entry) => { const seat = map?.seats.find((candidate) => candidate.id === entry.id); return seat ? { seat, patch: entry.patch } : null; }).filter((entry): entry is { seat: EventSeatDTO; patch: Partial<EventSeatDTO> } => Boolean(entry));
  const allRotationOnly = objectEntries.length === objects.length && seatEntries.length === seats.length && objectEntries.every(({ object, patch }) => isRotationOnlyObjectPatch(object, patch)) && seatEntries.every(({ seat, patch }) => isRotationOnlySeatPatch(seat, patch)) && [...objectEntries, ...seatEntries].some(({ patch }) => patch.rotation !== undefined);
  if (allRotationOnly) {
    const source = objectEntries.find(({ patch }) => patch.rotation !== undefined) ?? seatEntries.find(({ patch }) => patch.rotation !== undefined);
    const base = source && 'object' in source ? source.object.rotation : source && 'seat' in source ? source.seat.rotation : 0;
    return { type: 'ROTATE_SELECTION', payload: { selection: selectionFromRotationPatchIds({ objects: objectEntries.map(({ object }) => ({ id: object.id })), seats: seatEntries.map(({ seat }) => ({ id: seat.id })) }), angleDelta: shortestRotationDelta(base, source?.patch.rotation ?? base), mode: 'free' } };
  }
  const allTranslationOnly = objectEntries.length === objects.length && seatEntries.length === seats.length && objectEntries.every(({ object, patch }) => isTranslationOnlyObjectPatch(object, patch)) && seatEntries.every(({ seat, patch }) => isTranslationOnlySeatPatch(seat, patch));
  const delta = allTranslationOnly ? sharedDelta(objectEntries, seatEntries) : null;
  if (delta) return { type: 'MOVE_OBJECTS', payload: { objectIds: objects.map((entry) => entry.id), seatIds: seats.map((entry) => entry.id), delta } };
  return { type: 'RESIZE_OBJECTS', payload: { objects, seats, skipSeatBaseLayoutTranslation: payload.skipSeatBaseLayoutTranslation } };
}
