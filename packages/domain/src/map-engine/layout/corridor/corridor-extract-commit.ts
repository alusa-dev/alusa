import type { EventMapDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import type { CorridorDragMode, CorridorDragSession } from './corridor-preview-types.js';

export function extractGroupDragCommitUpdates(
  baseMap: EventMapDTO,
  preview: EventMapDTO,
  drag: CorridorDragSession,
  corridorIds: string[],
  mode: CorridorDragMode,
): {
  objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats: Array<{ id: string; patch: { x: number; y: number } }>;
} {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seatPatches = new Map<string, { x: number; y: number }>();
  const corridorSet = new Set(corridorIds);
  const hasMovement = Math.abs(drag.delta.x) >= 0.001 || Math.abs(drag.delta.y) >= 0.001;

  if (hasMovement) {
    for (const [nodeId, start] of drag.origin) {
      const id = nodeId.replace(/^node-/, '');
      if (corridorSet.has(id)) continue;

      const patch = { x: start.x + drag.delta.x, y: start.y + drag.delta.y };

      if (baseMap.objects.some((object) => object.id === id)) {
        objects.push({ id, patch });
      } else if (baseMap.seats.some((seat) => seat.id === id)) {
        seatPatches.set(id, patch);
      }
    }
  }

  for (const corridorId of corridorIds) {
    const reflowed = preview.objects.find((entry) => entry.id === corridorId);
    const previous = baseMap.objects.find((entry) => entry.id === corridorId);
    if (!reflowed || !previous || reflowed.type !== 'CORRIDOR') continue;

    const existingIndex = objects.findIndex((entry) => entry.id === corridorId);
    const corridorPatch = {
      x: reflowed.x,
      y: reflowed.y,
      width: reflowed.width,
      height: reflowed.height,
      rotation: reflowed.rotation,
      data: { ...reflowed.data },
    };

    if (existingIndex >= 0) {
      objects[existingIndex] = { id: corridorId, patch: corridorPatch };
    } else {
      objects.push({ id: corridorId, patch: corridorPatch });
    }
  }

  if (mode === 'reflow') {
    for (const seat of preview.seats) {
      const previous = baseMap.seats.find((entry) => entry.id === seat.id);
      if (!previous) continue;
      if (Math.abs(seat.x - previous.x) < 0.001 && Math.abs(seat.y - previous.y) < 0.001) continue;
      seatPatches.set(seat.id, { x: seat.x, y: seat.y });
    }
  }

  return {
    objects,
    seats: [...seatPatches.entries()].map(([id, patch]) => ({ id, patch })),
  };
}

export function extractCorridorDragCommitUpdates(
  baseMap: EventMapDTO,
  preview: EventMapDTO,
  corridorIds: string[],
): {
  objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
  seats: Array<{ id: string; patch: { x: number; y: number } }>;
} {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seats: Array<{ id: string; patch: { x: number; y: number } }> = [];

  for (const corridorId of corridorIds) {
    const reflowed = preview.objects.find((entry) => entry.id === corridorId);
    const previous = baseMap.objects.find((entry) => entry.id === corridorId);
    if (!reflowed || !previous || reflowed.type !== 'CORRIDOR') continue;

    objects.push({
      id: corridorId,
      patch: {
        x: reflowed.x,
        y: reflowed.y,
        width: reflowed.width,
        height: reflowed.height,
        rotation: reflowed.rotation,
        data: { ...reflowed.data },
      },
    });
  }

  for (const seat of preview.seats) {
    const previous = baseMap.seats.find((entry) => entry.id === seat.id);
    if (!previous) continue;
    if (Math.abs(seat.x - previous.x) < 0.001 && Math.abs(seat.y - previous.y) < 0.001) continue;
    seats.push({ id: seat.id, patch: { x: seat.x, y: seat.y } });
  }

  return { objects, seats };
}
