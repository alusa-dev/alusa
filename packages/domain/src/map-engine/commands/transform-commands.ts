import type {
  EventMapDTO,
  EventMapObjectDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '../types/event-map-types.js';

export type TransformCommandPayload = {
  objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  seatGroups?: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
  skipSeatBaseLayoutTranslation?: boolean;
  skipCorridorReflow?: boolean;
};

export type ClassifiedTransformCommand =
  | {
      type: 'TRANSFORM_CORRIDOR';
      payload: TransformCommandPayload;
    }
  | {
      type: 'RESIZE_OBJECTS';
      payload: TransformCommandPayload;
    }
  | {
      type: 'ROTATE_OBJECTS';
      payload: {
        objects: Array<{ id: string; patch: Partial<Pick<EventMapObjectDTO, 'x' | 'y' | 'rotation'>> }>;
        seats: Array<{ id: string; patch: Partial<Pick<EventSeatDTO, 'x' | 'y' | 'rotation'>> }>;
      };
    }
  | {
      type: 'MOVE_OBJECTS';
      payload: {
        objectIds: string[];
        seatIds: string[];
        delta: { x: number; y: number };
      };
    };

const SIZE_EPSILON = 0.001;

function nearlyEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= SIZE_EPSILON;
}

export function isRotationOnlyObjectPatch(object: EventMapObjectDTO, patch: Partial<EventMapObjectDTO>) {
  if (object.type === 'TEXT' || patch.data !== undefined) return false;
  if (patch.width !== undefined && !nearlyEqual(patch.width, object.width)) return false;
  if (patch.height !== undefined && !nearlyEqual(patch.height, object.height)) return false;
  return patch.rotation !== undefined || patch.x !== undefined || patch.y !== undefined;
}

export function isRotationOnlySeatPatch(seat: EventSeatDTO, patch: Partial<EventSeatDTO>) {
  if (patch.size !== undefined && !nearlyEqual(patch.size, seat.size)) return false;
  return patch.rotation !== undefined || patch.x !== undefined || patch.y !== undefined;
}

export function isTranslationOnlyObjectPatch(object: EventMapObjectDTO, patch: Partial<EventMapObjectDTO>) {
  if (object.type === 'TEXT' || patch.data !== undefined) return false;
  if (patch.rotation !== undefined && !nearlyEqual(patch.rotation, object.rotation ?? 0)) return false;
  if (patch.width !== undefined && !nearlyEqual(patch.width, object.width)) return false;
  if (patch.height !== undefined && !nearlyEqual(patch.height, object.height)) return false;
  return patch.x !== undefined || patch.y !== undefined;
}

export function isTranslationOnlySeatPatch(seat: EventSeatDTO, patch: Partial<EventSeatDTO>) {
  if (patch.rotation !== undefined && !nearlyEqual(patch.rotation, seat.rotation ?? 0)) return false;
  if (patch.size !== undefined && !nearlyEqual(patch.size, seat.size)) return false;
  return patch.x !== undefined || patch.y !== undefined;
}

function pickRotatePatch<T extends { x?: number; y?: number; rotation?: number }>(
  patch: Partial<T>,
): Partial<Pick<T, 'x' | 'y' | 'rotation'>> {
  const next: Partial<Pick<T, 'x' | 'y' | 'rotation'>> = {};
  if (patch.x !== undefined) next.x = patch.x;
  if (patch.y !== undefined) next.y = patch.y;
  if (patch.rotation !== undefined) next.rotation = patch.rotation;
  return next;
}

function inferSharedTranslationDelta(
  objectEntries: Array<{ object: EventMapObjectDTO; patch: Partial<EventMapObjectDTO> }>,
  seatEntries: Array<{ seat: EventSeatDTO; patch: Partial<EventSeatDTO> }>,
) {
  const deltas: Array<{ x: number; y: number }> = [];

  for (const { object, patch } of objectEntries) {
    if (patch.x === undefined && patch.y === undefined) continue;
    deltas.push({
      x: (patch.x ?? object.x) - object.x,
      y: (patch.y ?? object.y) - object.y,
    });
  }

  for (const { seat, patch } of seatEntries) {
    if (patch.x === undefined && patch.y === undefined) continue;
    deltas.push({
      x: (patch.x ?? seat.x) - seat.x,
      y: (patch.y ?? seat.y) - seat.y,
    });
  }

  if (deltas.length === 0) return null;
  const first = deltas[0]!;
  if (!deltas.every((delta) => nearlyEqual(delta.x, first.x) && nearlyEqual(delta.y, first.y))) {
    return null;
  }
  return first;
}

/** Classify generic transform payload into semantic map commands. */
export function classifyTransformPayload(
  payload: TransformCommandPayload,
  map: EventMapDTO | null,
  options?: { forceCorridor?: boolean },
): ClassifiedTransformCommand | null {
  const objects = payload.objects ?? [];
  const seats = payload.seats ?? [];
  const seatGroups = payload.seatGroups ?? [];

  if (objects.length === 0 && seats.length === 0 && seatGroups.length === 0) {
    return null;
  }

  if (options?.forceCorridor) {
    return {
      type: 'TRANSFORM_CORRIDOR',
      payload: {
        objects,
        seats,
        seatGroups,
        skipSeatBaseLayoutTranslation: payload.skipSeatBaseLayoutTranslation,
        skipCorridorReflow: payload.skipCorridorReflow,
      },
    };
  }

  if (seatGroups.length > 0) {
    return {
      type: 'RESIZE_OBJECTS',
      payload: {
        objects,
        seats,
        seatGroups,
        skipSeatBaseLayoutTranslation: payload.skipSeatBaseLayoutTranslation,
        skipCorridorReflow: payload.skipCorridorReflow,
      },
    };
  }

  const objectEntries = objects
    .map((entry) => {
      const object = map?.objects.find((candidate) => candidate.id === entry.id);
      return object ? { object, patch: entry.patch } : null;
    })
    .filter((entry): entry is { object: EventMapObjectDTO; patch: Partial<EventMapObjectDTO> } => entry !== null);

  const seatEntries = seats
    .map((entry) => {
      const seat = map?.seats.find((candidate) => candidate.id === entry.id);
      return seat ? { seat, patch: entry.patch } : null;
    })
    .filter((entry): entry is { seat: EventSeatDTO; patch: Partial<EventSeatDTO> } => entry !== null);

  const allRotationOnly =
    objectEntries.length === objects.length &&
    seatEntries.length === seats.length &&
    objectEntries.every(({ object, patch }) => isRotationOnlyObjectPatch(object, patch)) &&
    seatEntries.every(({ seat, patch }) => isRotationOnlySeatPatch(seat, patch)) &&
    objectEntries.some(({ patch }) => patch.rotation !== undefined);

  if (allRotationOnly) {
    return {
      type: 'ROTATE_OBJECTS',
      payload: {
        objects: objectEntries.map(({ object, patch }) => ({ id: object.id, patch: pickRotatePatch(patch) })),
        seats: seatEntries.map(({ seat, patch }) => ({ id: seat.id, patch: pickRotatePatch(patch) })),
      },
    };
  }

  const allTranslationOnly =
    seatGroups.length === 0 &&
    objectEntries.length === objects.length &&
    seatEntries.length === seats.length &&
    objectEntries.every(({ object, patch }) => isTranslationOnlyObjectPatch(object, patch)) &&
    seatEntries.every(({ seat, patch }) => isTranslationOnlySeatPatch(seat, patch));

  if (allTranslationOnly && (objects.length > 0 || seats.length > 0)) {
    const delta = inferSharedTranslationDelta(objectEntries, seatEntries);
    if (delta) {
      return {
        type: 'MOVE_OBJECTS',
        payload: {
          objectIds: objects.map((entry) => entry.id),
          seatIds: seats.map((entry) => entry.id),
          delta,
        },
      };
    }
  }

  return {
    type: 'RESIZE_OBJECTS',
    payload: {
      objects,
      seats,
      seatGroups,
      skipSeatBaseLayoutTranslation: payload.skipSeatBaseLayoutTranslation,
      skipCorridorReflow: payload.skipCorridorReflow,
    },
  };
}
