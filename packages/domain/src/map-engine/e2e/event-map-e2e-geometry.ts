import { getSeatBounds } from '../geometry/bounds.js';
import { getObjectBounds } from '../layout/object-bounds.js';
import { getSectionVisualBounds } from '../layout/section-geometry.js';
import type { EventMapDTO } from '../types/event-map-types.js';

export type EventMapE2EGeometry = {
  seats: Array<{
    id: string;
    label: string;
    rowLabel: string | null;
    seatNumber: string | null;
    x: number;
    y: number;
    size: number;
    rotation: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  objects: Array<{
    id: string;
    type: EventMapDTO['objects'][number]['type'];
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    data: Record<string, unknown>;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  sections: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

export function buildEventMapE2EGeometry(map: EventMapDTO, activeLevelId: string | null): EventMapE2EGeometry {
  const levelId = activeLevelId ?? map.levels[0]?.id ?? null;
  if (!levelId) {
    return { seats: [], objects: [], sections: [] };
  }

  const seats = map.seats
    .filter((seat) => seat.levelId === levelId && seat.publicVisible)
    .map((seat) => {
      const bounds = getSeatBounds(seat);
      return {
        id: seat.id,
        label: seat.displayLabel,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        x: seat.x,
        y: seat.y,
        size: seat.size ?? 24,
        rotation: seat.rotation ?? 0,
        bounds,
      };
    });

  const objects = map.objects
    .filter((object) => object.levelId === levelId && !object.hidden)
    .map((object) => {
      return {
        id: object.id,
        type: object.type,
        x: object.x,
        y: object.y,
        width: object.width ?? 0,
        height: object.height ?? 0,
        rotation: object.rotation ?? 0,
        data: object.data ?? {},
        bounds: getObjectBounds(object),
      };
    });

  const sections = map.objects
    .filter((object) => object.levelId === levelId && object.type === 'SECTION' && object.sectionId && !object.hidden)
    .map((object) => {
      const sectionSeats = map.seats.filter((seat) => seat.levelId === levelId && seat.sectionId === object.sectionId);
      const bounds = getSectionVisualBounds(sectionSeats) ?? getObjectBounds(object);
      return {
        id: object.sectionId!,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    });

  return { seats, objects, sections };
}
