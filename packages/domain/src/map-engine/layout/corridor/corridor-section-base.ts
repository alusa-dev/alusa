import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../../types/event-map-types.js';
import {
  CORRIDOR_AXIS_KEY,
  CORRIDOR_SPLIT_X_KEY,
  CORRIDOR_SPLIT_Y_KEY,
  effectiveCorridorAxisAtRotation,
  getSmartCorridorCoreRect,
  normalizeRotation,
  readStoredCorridorAxis,
  resolveSmartCorridorLayout,
} from '../smart-corridor-layout.js';
import { getSeatBounds, intersectsRect, type BoundsRect } from '../../geometry/bounds.js';
import { rotateRectCorners, toLocal } from '../../geometry/rotation.js';

export const SEAT_BASE_LAYOUT_KEY = 'seatBaseLayout';
export const SECTION_BASE_BOUNDS_KEY = 'sectionBaseBounds';
const SECTION_REFLOW_PADDING = 24;
export const DEFAULT_SEAT_SIZE = 24;

export type SeatBaseLayout = Record<string, { x: number; y: number }>;
export type SectionBaseBounds = { x: number; y: number; width: number; height: number };

export function getSeatSize(seat: EventSeatDTO) {
  return seat.size ?? DEFAULT_SEAT_SIZE;
}

export function getSeatBasePoint(seat: EventSeatDTO, baseLayout: SeatBaseLayout) {
  return baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
}

export function getSeatAxisEdge(seat: EventSeatDTO, axis: 'x' | 'y', edge: 'start' | 'end') {
  const size = getSeatSize(seat);
  const center = axis === 'x' ? seat.x : seat.y;
  return edge === 'start' ? center - size / 2 : center + size / 2;
}

export function isSectionObject(object: EventMapObjectDTO) {
  return object.type === 'SECTION' && Boolean(object.sectionId);
}

export function readSeatBaseLayout(object: EventMapObjectDTO): SeatBaseLayout {
  const value = object.data[SEAT_BASE_LAYOUT_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const layout: SeatBaseLayout = {};
  for (const [seatId, point] of Object.entries(value as Record<string, unknown>)) {
    if (!point || typeof point !== 'object') continue;
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (typeof x === 'number' && typeof y === 'number') {
      layout[seatId] = { x, y };
    }
  }
  return layout;
}

export function writeSeatBaseLayout(object: EventMapObjectDTO, layout: SeatBaseLayout) {
  object.data = { ...object.data, [SEAT_BASE_LAYOUT_KEY]: layout };
}

export function readSectionBaseBounds(object: EventMapObjectDTO): SectionBaseBounds | null {
  const value = object.data[SECTION_BASE_BOUNDS_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof width === 'number' &&
    typeof height === 'number'
  ) {
    return { x, y, width, height };
  }
  return null;
}

export function writeSectionBaseBounds(object: EventMapObjectDTO, bounds: SectionBaseBounds) {
  object.data = { ...object.data, [SECTION_BASE_BOUNDS_KEY]: bounds };
}

function getSectionSeatBounds(seats: EventSeatDTO[]) {
  if (seats.length === 0) return null;

  return seats.reduce(
    (bounds, seat) => {
      const seatBounds = getSeatBounds(seat);
      return {
        minX: Math.min(bounds.minX, seatBounds.x),
        minY: Math.min(bounds.minY, seatBounds.y),
        maxX: Math.max(bounds.maxX, seatBounds.x + seatBounds.width),
        maxY: Math.max(bounds.maxY, seatBounds.y + seatBounds.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function resizeSectionToSeats(sectionObject: EventMapObjectDTO, seats: EventSeatDTO[], baseBounds: SectionBaseBounds) {
  const seatBounds = getSectionSeatBounds(seats);
  if (!seatBounds) return;

  sectionObject.x = Math.min(baseBounds.x, seatBounds.minX - SECTION_REFLOW_PADDING);
  sectionObject.y = Math.min(baseBounds.y, seatBounds.minY - SECTION_REFLOW_PADDING);
  sectionObject.width =
    Math.max(baseBounds.x + baseBounds.width, seatBounds.maxX + SECTION_REFLOW_PADDING) - sectionObject.x;
  sectionObject.height =
    Math.max(baseBounds.y + baseBounds.height, seatBounds.maxY + SECTION_REFLOW_PADDING) - sectionObject.y;
}

function getRectCorners(rect: BoundsRect, pivot: { x: number; y: number }, rotationDegrees: number) {
  return rotateRectCorners(rect, pivot, rotationDegrees);
}

function getAABB(points: Array<{ x: number; y: number }>): BoundsRect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function corridorAffectsSection({
  corridor,
  sectionSeats,
  baseLayout,
  baseBounds,
  sectionRotation,
}: {
  corridor: EventMapObjectDTO;
  sectionSeats: EventSeatDTO[];
  baseLayout: SeatBaseLayout;
  baseBounds: SectionBaseBounds;
  sectionRotation: number;
}) {
  const layout = resolveSmartCorridorLayout(corridor);
  const sectionPivot = { x: baseBounds.x, y: baseBounds.y };

  const globalClearanceCorners = getRectCorners(
    layout.clearanceRect,
    { x: corridor.x, y: corridor.y },
    corridor.rotation ?? 0,
  );
  const localClearanceRect = getAABB(
    globalClearanceCorners.map((p) => toLocal(p, sectionPivot, sectionRotation)),
  );

  if (intersectsRect(baseBounds, localClearanceRect)) {
    return true;
  }

  return sectionSeats.some((seat) => {
    const base = getSeatBasePoint(seat, baseLayout);
    const localBase = toLocal(base, sectionPivot, sectionRotation);
    const seatBounds = getSeatBounds({ ...seat, x: localBase.x, y: localBase.y });
    return intersectsRect(seatBounds, localClearanceRect);
  });
}

export function collectAffectedSectionIds(map: EventMapDTO, corridors: EventMapObjectDTO[]) {
  const affected = new Set<string>();
  const sectionObjects = map.objects.filter(isSectionObject);

  for (const corridor of corridors) {
    for (const sectionObject of sectionObjects) {
      if (sectionObject.levelId !== corridor.levelId || !sectionObject.sectionId) continue;

      const baseLayout = readSeatBaseLayout(sectionObject);
      const baseBounds =
        readSectionBaseBounds(sectionObject) ??
        ({
          x: sectionObject.x,
          y: sectionObject.y,
          width: sectionObject.width ?? 0,
          height: sectionObject.height ?? 0,
        } satisfies SectionBaseBounds);

      const sectionSeats = map.seats.filter((seat) => seat.sectionId === sectionObject.sectionId);

      if (
        corridorAffectsSection({
          corridor,
          sectionSeats,
          baseLayout,
          baseBounds,
          sectionRotation: sectionObject.rotation ?? 0,
        })
      ) {
        affected.add(sectionObject.sectionId);
      }
    }
  }

  for (const sectionObject of sectionObjects) {
    if (!sectionObject.sectionId) continue;
    if (Object.keys(readSeatBaseLayout(sectionObject)).length > 0) {
      affected.add(sectionObject.sectionId);
    }
  }

  return affected;
}

export function mapCorridorToSectionLocal(
  corridor: EventMapObjectDTO,
  sectionPivot: { x: number; y: number },
  sectionRotation: number,
): { localCorridor: EventMapObjectDTO; localReferenceBounds: BoundsRect } {
  const coreRect = getSmartCorridorCoreRect(corridor);
  const globalCorners = getRectCorners(coreRect, { x: corridor.x, y: corridor.y }, corridor.rotation ?? 0);
  const localCorners = globalCorners.map((point) => toLocal(point, sectionPivot, sectionRotation));
  const localReferenceBounds = getAABB(localCorners);

  const effectiveRotation = normalizeRotation((corridor.rotation ?? 0) - sectionRotation);
  const effectiveAxis = effectiveCorridorAxisAtRotation(readStoredCorridorAxis(corridor), effectiveRotation);

  const localCorridor: EventMapObjectDTO = {
    ...corridor,
    x: localReferenceBounds.x,
    y: localReferenceBounds.y,
    width: localReferenceBounds.width,
    height: localReferenceBounds.height,
    rotation: 0,
    data: {
      ...corridor.data,
      [CORRIDOR_AXIS_KEY]: effectiveAxis,
    },
  };

  const hasSplitX = Number.isFinite(corridor.data[CORRIDOR_SPLIT_X_KEY]);
  const hasSplitY = Number.isFinite(corridor.data[CORRIDOR_SPLIT_Y_KEY]);
  if (hasSplitX && hasSplitY) {
    const globalSplitPt = {
      x: Number(corridor.data[CORRIDOR_SPLIT_X_KEY]),
      y: Number(corridor.data[CORRIDOR_SPLIT_Y_KEY]),
    };
    const localSplitPt = toLocal(globalSplitPt, sectionPivot, sectionRotation);
    localCorridor.data[CORRIDOR_SPLIT_X_KEY] = localSplitPt.x;
    localCorridor.data[CORRIDOR_SPLIT_Y_KEY] = localSplitPt.y;
  }

  return { localCorridor, localReferenceBounds };
}

export function getSectionContext(
  map: EventMapDTO,
  sectionId: string,
): {
  sectionObject: EventMapObjectDTO;
  sectionSeats: EventSeatDTO[];
  baseLayout: SeatBaseLayout;
  baseBounds: SectionBaseBounds;
} | null {
  const sectionObject = map.objects.find((object) => object.type === 'SECTION' && object.sectionId === sectionId);
  if (!sectionObject || !sectionObject.sectionId) return null;

  const sectionSeats = map.seats.filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD');
  const baseLayout = readSeatBaseLayout(sectionObject);
  const baseBounds =
    readSectionBaseBounds(sectionObject) ??
    ({
      x: sectionObject.x,
      y: sectionObject.y,
      width: sectionObject.width ?? 0,
      height: sectionObject.height ?? 0,
    } satisfies SectionBaseBounds);

  return { sectionObject, sectionSeats, baseLayout, baseBounds };
}

export function translateSectionCorridorBase(map: EventMapDTO, sectionId: string, delta: { x: number; y: number }) {
  if (Math.abs(delta.x) < 0.001 && Math.abs(delta.y) < 0.001) return;

  const sectionObject = map.objects.find((object) => object.type === 'SECTION' && object.sectionId === sectionId);
  if (!sectionObject) return;

  const baseLayout = readSeatBaseLayout(sectionObject);
  const baseBounds = readSectionBaseBounds(sectionObject);

  if (Object.keys(baseLayout).length > 0) {
    const nextLayout: SeatBaseLayout = {};
    for (const [seatId, point] of Object.entries(baseLayout)) {
      nextLayout[seatId] = { x: point.x + delta.x, y: point.y + delta.y };
    }
    writeSeatBaseLayout(sectionObject, nextLayout);
  }

  if (baseBounds) {
    writeSectionBaseBounds(sectionObject, {
      ...baseBounds,
      x: baseBounds.x + delta.x,
      y: baseBounds.y + delta.y,
    });
  }
}

export function translateSeatCorridorBase(
  map: EventMapDTO,
  entries: Array<{ seatId: string; sectionId: string; delta: { x: number; y: number } }>,
) {
  if (entries.length === 0) return;

  const entriesBySectionId = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (Math.abs(entry.delta.x) < 0.001 && Math.abs(entry.delta.y) < 0.001) continue;
    const current = entriesBySectionId.get(entry.sectionId) ?? [];
    current.push(entry);
    entriesBySectionId.set(entry.sectionId, current);
  }

  for (const [sectionId, sectionEntries] of entriesBySectionId) {
    const sectionObject = map.objects.find((object) => object.type === 'SECTION' && object.sectionId === sectionId);
    if (!sectionObject) continue;

    const baseLayout = readSeatBaseLayout(sectionObject);
    if (Object.keys(baseLayout).length === 0) continue;

    let changed = false;
    const nextLayout: SeatBaseLayout = { ...baseLayout };
    for (const entry of sectionEntries) {
      const point = nextLayout[entry.seatId];
      if (!point) continue;
      nextLayout[entry.seatId] = {
        x: point.x + entry.delta.x,
        y: point.y + entry.delta.y,
      };
      changed = true;
    }

    if (changed) writeSeatBaseLayout(sectionObject, nextLayout);
  }
}
