import { getSeatBounds } from '../geometry/bounds.js';
import { getObjectBounds } from '../layout/object-bounds.js';
import { resolveSmartCorridorLayout } from '../layout/smart-corridor-layout.js';
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
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  corridors: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    data: Record<string, unknown>;
    coreRect: { x: number; y: number; width: number; height: number };
    clearanceRect: { x: number; y: number; width: number; height: number };
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
    return { seats: [], corridors: [], sections: [] };
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
        bounds,
      };
    });

  const corridors = map.objects
    .filter((object) => object.levelId === levelId && object.type === 'CORRIDOR' && !object.hidden)
    .map((object) => {
      const layout = resolveSmartCorridorLayout(object);
      return {
        id: object.id,
        x: object.x,
        y: object.y,
        width: object.width ?? 0,
        height: object.height ?? 0,
        rotation: object.rotation ?? 0,
        data: object.data ?? {},
        coreRect: layout.coreRect,
        clearanceRect: layout.clearanceRect,
      };
    });

  const sections = map.objects
    .filter((object) => object.levelId === levelId && object.type === 'SECTION' && object.sectionId && !object.hidden)
    .map((object) => {
      const bounds = getObjectBounds(object);
      return {
        id: object.sectionId!,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    });

  return { seats, corridors, sections };
}
