import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';
import {
  clampNumber,
  cloneEventMap,
  CORRIDOR_AXIS_KEY,
  CORRIDOR_AUTO_FIT_KEY,
  CORRIDOR_CORE_HEIGHT_KEY,
  CORRIDOR_CORE_WIDTH_KEY,
  CORRIDOR_SPLIT_X_KEY,
  CORRIDOR_SPLIT_Y_KEY,
  CORRIDOR_THICKNESS_KEY,
  DEFAULT_CORRIDOR_GAP,
  DEFAULT_CORRIDOR_THICKNESS,
  MIN_CORRIDOR_THICKNESS,
  expandRectWithSpacing,
  getCorridorSpacing,
  getSmartCorridorCoreRect,
  inferCorridorAxisFromSize,
  inferSmartCorridorAxisFromCoreRect,
  normalizeSmartCorridorObject,
  readCorridorThickness,
  reconcileCorridorGeometry,
  resolveSmartCorridorLayout,
  readStoredCorridorAxis,
  effectiveCorridorAxisAtRotation,
  snapSmartCorridorRotation,
  SMART_CORRIDOR_KIND_KEY,
  applyCorridorRotationPreservingCenter,
  getCorridorWorldCenter,
  isCorridorRotationOnlyTransform,
  type CorridorSpacing,
  type SmartCorridorAxis,
} from './smart-corridor-layout';
import { buildCorridorUnionGroupLookup, getCorridorUnionGroups } from './corridor-union';
import { getObjectBounds, getSeatBounds, intersectsRect, type BoundsRect } from './selection-utils';

export { cloneEventMap, inferCorridorAxisFromSize };

export const CORRIDOR_REFLOW_ITERATIONS = 25;
export const CORRIDOR_DRAG_PREVIEW_ITERATIONS = CORRIDOR_REFLOW_ITERATIONS;
export const CORRIDOR_DRAG_COMMIT_ITERATIONS = CORRIDOR_REFLOW_ITERATIONS;

export type CorridorDragMode = 'reflow' | 'rigid';

export type CorridorReflowOptions = {
  maxIterations?: number;
  activeCorridorIds?: string[];
  /** Corridors that must keep x/y during auto-fit (e.g. rotation-only transform). */
  freezeAutoFitCorridorIds?: string[];
};

export type CorridorDragSession = {
  origin: Map<string, { x: number; y: number }>;
  delta: { x: number; y: number };
};

export type SmartCorridorDragPreviewOptions = {
  previewMap?: EventMapDTO;
  maxIterations?: number;
  activeCorridorIds?: string[];
  mode?: CorridorDragMode;
};

const SEAT_BASE_LAYOUT_KEY = 'seatBaseLayout';
const SECTION_BASE_BOUNDS_KEY = 'sectionBaseBounds';
const SECTION_REFLOW_PADDING = 24;
const DEFAULT_SEAT_SIZE = 24;

export type CorridorAxis = SmartCorridorAxis;

type SeatBaseLayout = Record<string, { x: number; y: number }>;
type SectionBaseBounds = { x: number; y: number; width: number; height: number };

type SeatEntry = {
  seat: EventSeatDTO;
  base: { x: number; y: number };
  center: number;
};

type CorridorObstacle = {
  objectIds: string[];
  axis: 'x' | 'y';
  coreRect: BoundsRect;
  clearanceRect: BoundsRect;
  spacing: CorridorSpacing;
  thickness: number;
  splitCenter: number;
};

function unionRects(rects: BoundsRect[]): BoundsRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function rebuildObstacleClearanceRect(obstacle: {
  axis: 'x' | 'y';
  coreRect: BoundsRect;
  spacing: CorridorSpacing;
  thickness: number;
  splitCenter: number;
}): BoundsRect {
  const { coreRect, spacing, thickness, axis } = obstacle;

  if (axis === 'x') {
    const width = thickness + spacing.left + spacing.right;
    return {
      x: coreRect.x - spacing.left,
      y: coreRect.y - spacing.top,
      width,
      height: coreRect.height + spacing.top + spacing.bottom,
    };
  }

  const height = thickness + spacing.top + spacing.bottom;
  return {
    x: coreRect.x - spacing.left,
    y: coreRect.y - spacing.top,
    width: coreRect.width + spacing.left + spacing.right,
    height,
  };
}

function partitionAxisSpan(obstacle: CorridorObstacle) {
  if (obstacle.axis === 'x') {
    return { start: obstacle.clearanceRect.x, size: obstacle.clearanceRect.width };
  }
  return { start: obstacle.clearanceRect.y, size: obstacle.clearanceRect.height };
}

function obstaclesShouldMerge(
  left: CorridorObstacle,
  right: CorridorObstacle,
  unionGroupByObjectId?: Map<string, string>,
) {
  if (left.axis !== right.axis) return false;

  if (unionGroupByObjectId) {
    const leftGroup = left.objectIds.map((id) => unionGroupByObjectId.get(id)).find(Boolean);
    const rightGroup = right.objectIds.map((id) => unionGroupByObjectId.get(id)).find(Boolean);
    if (leftGroup && rightGroup && leftGroup === rightGroup) {
      return intersectsRect(left.clearanceRect, right.clearanceRect);
    }
  }

  if (Math.abs(left.splitCenter - right.splitCenter) < 2) return true;

  const leftSpan = partitionAxisSpan(left);
  const rightSpan = partitionAxisSpan(right);
  const overlap = Math.min(leftSpan.start + leftSpan.size, rightSpan.start + rightSpan.size) - Math.max(leftSpan.start, rightSpan.start);
  const minSize = Math.min(leftSpan.size, rightSpan.size);
  return overlap > minSize * 0.5;
}

function mergeCorridorObstacle(existing: CorridorObstacle, obstacle: CorridorObstacle) {
  existing.objectIds = [...new Set([...existing.objectIds, ...obstacle.objectIds])];
  existing.coreRect = unionRects([existing.coreRect, obstacle.coreRect]);
  existing.thickness = Math.max(existing.thickness, obstacle.thickness);
  existing.spacing = {
    top: Math.max(existing.spacing.top, obstacle.spacing.top),
    right: Math.max(existing.spacing.right, obstacle.spacing.right),
    bottom: Math.max(existing.spacing.bottom, obstacle.spacing.bottom),
    left: Math.max(existing.spacing.left, obstacle.spacing.left),
  };
  existing.splitCenter = (existing.splitCenter + obstacle.splitCenter) / 2;
  existing.clearanceRect = rebuildObstacleClearanceRect(existing);
}

function dedupeObstaclesBySplitCenter(
  obstacles: CorridorObstacle[],
  unionGroupByObjectId?: Map<string, string>,
) {
  const merged: CorridorObstacle[] = [];

  for (const obstacle of obstacles) {
    const existing = merged.find((entry) => obstaclesShouldMerge(entry, obstacle, unionGroupByObjectId));

    if (!existing) {
      merged.push({ ...obstacle });
      continue;
    }

    mergeCorridorObstacle(existing, obstacle);
  }

  return merged;
}

function getSeatSize(seat: EventSeatDTO) {
  return seat.size ?? DEFAULT_SEAT_SIZE;
}

function getSeatBasePoint(seat: EventSeatDTO, baseLayout: SeatBaseLayout) {
  return baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
}

function getSeatAxisEdge(seat: EventSeatDTO, axis: 'x' | 'y', edge: 'start' | 'end') {
  const size = getSeatSize(seat);
  const center = axis === 'x' ? seat.x : seat.y;
  return edge === 'start' ? center - size / 2 : center + size / 2;
}

function isCorridor(object: EventMapObjectDTO) {
  return object.type === 'CORRIDOR' && !object.hidden;
}

export function resolveCorridorAxis(corridor: EventMapObjectDTO): CorridorAxis {
  return resolveSmartCorridorLayout(corridor).axis;
}

export function isCorridorAutoFit(_corridor: EventMapObjectDTO) {
  return true;
}

function persistSmartCorridorMetadata(corridor: EventMapObjectDTO) {
  normalizeSmartCorridorObject(corridor);
  const layout = resolveSmartCorridorLayout(corridor);
  corridor.data = {
    ...corridor.data,
    [SMART_CORRIDOR_KIND_KEY]: true,
    [CORRIDOR_AXIS_KEY]: layout.axis,
    [CORRIDOR_AUTO_FIT_KEY]: true,
    [CORRIDOR_THICKNESS_KEY]: layout.thickness,
    [CORRIDOR_CORE_WIDTH_KEY]: layout.axis === 'vertical' ? layout.thickness : layout.coreRect.width,
    [CORRIDOR_CORE_HEIGHT_KEY]: layout.axis === 'horizontal' ? layout.thickness : layout.coreRect.height,
  };
}

function isSectionObject(object: EventMapObjectDTO) {
  return object.type === 'SECTION' && Boolean(object.sectionId);
}

function readSeatBaseLayout(object: EventMapObjectDTO): SeatBaseLayout {
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

function writeSeatBaseLayout(object: EventMapObjectDTO, layout: SeatBaseLayout) {
  object.data = { ...object.data, [SEAT_BASE_LAYOUT_KEY]: layout };
}

function readSectionBaseBounds(object: EventMapObjectDTO): SectionBaseBounds | null {
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

function writeSectionBaseBounds(object: EventMapObjectDTO, bounds: SectionBaseBounds) {
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

function resizeSectionToSeats(sectionObject: EventMapObjectDTO, seats: EventSeatDTO[], baseBounds: SectionBaseBounds) {
  const seatBounds = getSectionSeatBounds(seats);
  if (!seatBounds) return;

  sectionObject.x = Math.min(baseBounds.x, seatBounds.minX - SECTION_REFLOW_PADDING);
  sectionObject.y = Math.min(baseBounds.y, seatBounds.minY - SECTION_REFLOW_PADDING);
  sectionObject.width =
    Math.max(baseBounds.x + baseBounds.width, seatBounds.maxX + SECTION_REFLOW_PADDING) - sectionObject.x;
  sectionObject.height =
    Math.max(baseBounds.y + baseBounds.height, seatBounds.maxY + SECTION_REFLOW_PADDING) - sectionObject.y;
}

export function toLocal(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  rotationDegrees: number,
): { x: number; y: number } {
  const theta = (rotationDegrees * Math.PI) / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(-theta) - dy * Math.sin(-theta),
    y: pivot.y + dx * Math.sin(-theta) + dy * Math.cos(-theta),
  };
}

export function toGlobal(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  rotationDegrees: number,
): { x: number; y: number } {
  const theta = (rotationDegrees * Math.PI) / 180;
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(theta) - dy * Math.sin(theta),
    y: pivot.y + dx * Math.sin(theta) + dy * Math.cos(theta),
  };
}

function getRectCorners(rect: BoundsRect, pivot: { x: number; y: number }, rotationDegrees: number) {
  const rad = (rotationDegrees * Math.PI) / 180;
  const rotate = (px: number, py: number) => {
    const dx = px - pivot.x;
    const dy = py - pivot.y;
    return {
      x: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  };
  return [
    rotate(rect.x, rect.y),
    rotate(rect.x + rect.width, rect.y),
    rotate(rect.x + rect.width, rect.y + rect.height),
    rotate(rect.x, rect.y + rect.height),
  ];
}

function getAABB(points: Array<{ x: number; y: number }>): BoundsRect {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
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

function corridorAffectsSection({
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

function collectAffectedSectionIds(map: EventMapDTO, corridors: EventMapObjectDTO[]) {
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

function getSeatAxisCenters(sectionSeats: EventSeatDTO[], baseLayout: SeatBaseLayout, axis: 'x' | 'y') {
  const centers = sectionSeats.map((seat) => {
    const base = getSeatBasePoint(seat, baseLayout);
    return axis === 'x' ? base.x : base.y;
  });

  return [...new Set(centers.map((center) => Number(center.toFixed(4))))].sort((left, right) => left - right);
}

function resolveInitialCorridorSplitCenter(
  coreRect: BoundsRect,
  axis: 'x' | 'y',
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
) {
  const centers = getSeatAxisCenters(sectionSeats, baseLayout, axis);
  if (centers.length < 2) {
    return axis === 'x' ? coreRect.x + coreRect.width / 2 : coreRect.y + coreRect.height / 2;
  }

  const edge = axis === 'x' ? coreRect.x : coreRect.y;
  let before: number | undefined;
  let after: number | undefined;

  for (const center of centers) {
    if (center < edge) {
      before = center;
      continue;
    }
    after = center;
    break;
  }

  if (before !== undefined && after !== undefined) {
    return (before + after) / 2;
  }

  if (before === undefined) {
    return centers[0]! - 100;
  }

  if (after === undefined) {
    return centers[centers.length - 1]! + 100;
  }

  return axis === 'x' ? coreRect.x + coreRect.width / 2 : coreRect.y + coreRect.height / 2;
}

function getPartitionedPairIndex(centers: number[], split: number) {
  for (let index = 0; index < centers.length - 1; index += 1) {
    const left = centers[index]!;
    const right = centers[index + 1]!;
    if (left < split && split <= right) return index;
  }
  return null;
}

function corridorGeometryMatchesAxis(layout: ReturnType<typeof resolveSmartCorridorLayout>) {
  if (layout.axis === 'vertical') return layout.coreRect.height >= layout.coreRect.width;
  return layout.coreRect.width >= layout.coreRect.height;
}

function areSeatsUndisplaced(sectionSeats: EventSeatDTO[], baseLayout: SeatBaseLayout) {
  return sectionSeats.every((seat) => {
    const base = baseLayout[seat.id];
    return !base || (Math.abs(seat.x - base.x) < 0.01 && Math.abs(seat.y - base.y) < 0.01);
  });
}

function resolveReflowedCorridorSplitCenter(
  coreRect: BoundsRect,
  axis: 'x' | 'y',
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
) {
  const filteredSeats = sectionSeats.filter((seat) => {
    const seatSize = getSeatSize(seat);
    const base = getSeatBasePoint(seat, baseLayout);
    if (axis === 'x') {
      const seatMinY = base.y - seatSize / 2;
      const seatMaxY = base.y + seatSize / 2;
      const corrMinY = coreRect.y;
      const corrMaxY = coreRect.y + coreRect.height;
      return !(seatMaxY < corrMinY || seatMinY > corrMaxY);
    } else {
      const seatMinX = base.x - seatSize / 2;
      const seatMaxX = base.x + seatSize / 2;
      const corrMinX = coreRect.x;
      const corrMaxX = coreRect.x + coreRect.width;
      return !(seatMaxX < corrMinX || seatMinX > corrMaxX);
    }
  });

  const seatsToUse = filteredSeats.length > 0 ? filteredSeats : sectionSeats;
  return resolveInitialCorridorSplitCenter(coreRect, axis, seatsToUse, baseLayout);
}

function reconcileCorridorSplitAnchor(
  corridor: EventMapObjectDTO,
  layout: ReturnType<typeof resolveSmartCorridorLayout>,
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
) {
  const axis = layout.axis === 'vertical' ? 'x' : 'y';
  const key = axis === 'x' ? CORRIDOR_SPLIT_X_KEY : CORRIDOR_SPLIT_Y_KEY;
  const stored = Number(corridor.data[key]);
  if (!Number.isFinite(stored) || !corridorGeometryMatchesAxis(layout)) return;

  const centers = getSeatAxisCenters(sectionSeats, baseLayout, axis);
  if (centers.length < 2) return;

  const resolved = resolveReflowedCorridorSplitCenter(layout.coreRect, axis, sectionSeats, baseLayout);
  const storedPair = getPartitionedPairIndex(centers, stored);
  const resolvedPair = getPartitionedPairIndex(centers, resolved);



  if (storedPair !== resolvedPair) {
    corridor.data = { ...corridor.data, [key]: resolved };
  }
}

function getCorridorSplitCenter(
  corridor: EventMapObjectDTO,
  layout: ReturnType<typeof resolveSmartCorridorLayout>,
  axis: 'x' | 'y',
) {
  const key = axis === 'x' ? CORRIDOR_SPLIT_X_KEY : CORRIDOR_SPLIT_Y_KEY;
  const stored = Number(corridor.data[key]);
  if (Number.isFinite(stored)) return stored;
  return axis === 'x'
    ? layout.coreRect.x + layout.coreRect.width / 2
    : layout.coreRect.y + layout.coreRect.height / 2;
}

function ensureCorridorSplitAnchors(
  corridor: EventMapObjectDTO,
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
) {
  persistSmartCorridorMetadata(corridor);
  const layout = resolveSmartCorridorLayout(corridor);
  const nextData: Record<string, unknown> = { ...corridor.data };

  if (layout.axis === 'vertical') {
    if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_X_KEY]))) {
      nextData[CORRIDOR_SPLIT_X_KEY] = resolveInitialCorridorSplitCenter(
        layout.coreRect,
        'x',
        sectionSeats,
        baseLayout,
      );
    } else {
      corridor.data = nextData;
      reconcileCorridorSplitAnchor(corridor, layout, sectionSeats, baseLayout);
      nextData[CORRIDOR_SPLIT_X_KEY] = corridor.data[CORRIDOR_SPLIT_X_KEY];
    }
  } else if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_X_KEY]))) {
    nextData[CORRIDOR_SPLIT_X_KEY] = layout.coreRect.x + layout.coreRect.width / 2;
  }

  if (layout.axis === 'horizontal') {
    if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_Y_KEY]))) {
      nextData[CORRIDOR_SPLIT_Y_KEY] = resolveInitialCorridorSplitCenter(
        layout.coreRect,
        'y',
        sectionSeats,
        baseLayout,
      );
    } else {
      corridor.data = nextData;
      reconcileCorridorSplitAnchor(corridor, layout, sectionSeats, baseLayout);
      nextData[CORRIDOR_SPLIT_Y_KEY] = corridor.data[CORRIDOR_SPLIT_Y_KEY];
    }
  } else if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_Y_KEY]))) {
    nextData[CORRIDOR_SPLIT_Y_KEY] = layout.coreRect.y + layout.coreRect.height / 2;
  }

  corridor.data = nextData;
}

export function persistCorridorMetadataOnly(corridor: EventMapObjectDTO) {
  persistSmartCorridorMetadata(corridor);
}

export function updateCorridorSplitAnchors(corridor: EventMapObjectDTO) {
  const layout = resolveSmartCorridorLayout(corridor);
  persistSmartCorridorMetadata(corridor);
  corridor.data = {
    ...corridor.data,
    [CORRIDOR_SPLIT_X_KEY]: layout.coreRect.x + layout.coreRect.width / 2,
    [CORRIDOR_SPLIT_Y_KEY]: layout.coreRect.y + layout.coreRect.height / 2,
  };
}

export function updateCorridorSplitAnchorsOnDrag(
  corridor: EventMapObjectDTO,
  patch: Partial<EventMapObjectDTO>,
  previous?: EventMapObjectDTO,
) {
  const layout = resolveSmartCorridorLayout(corridor);
  const axis = layout.axis;
  const nextData: Record<string, unknown> = {
    ...corridor.data,
    [SMART_CORRIDOR_KIND_KEY]: true,
  };

  const prevX = previous?.data[CORRIDOR_SPLIT_X_KEY];
  const prevY = previous?.data[CORRIDOR_SPLIT_Y_KEY];
  const hasPreviousSplit = previous && Number.isFinite(Number(prevX)) && Number.isFinite(Number(prevY));

  let globalSplit: { x: number; y: number };

  if (hasPreviousSplit) {
    const prevSplitPoint = { x: Number(prevX), y: Number(prevY) };
    const prevLocal = toLocal(prevSplitPoint, { x: previous.x, y: previous.y }, previous.rotation ?? 0);
    const ratioX = (prevLocal.x - previous.x) / (previous.width ?? 1);
    const ratioY = (prevLocal.y - previous.y) / (previous.height ?? 1);

    const nextLocal = {
      x: corridor.x + ratioX * (corridor.width ?? 1),
      y: corridor.y + ratioY * (corridor.height ?? 1),
    };
    globalSplit = toGlobal(nextLocal, { x: corridor.x, y: corridor.y }, corridor.rotation ?? 0);
  } else {
    const nextLocal = {
      x: corridor.x + (corridor.width ?? 1) / 2,
      y: corridor.y + (corridor.height ?? 1) / 2,
    };
    globalSplit = toGlobal(nextLocal, { x: corridor.x, y: corridor.y }, corridor.rotation ?? 0);
  }

  nextData[CORRIDOR_SPLIT_X_KEY] = globalSplit.x;
  nextData[CORRIDOR_SPLIT_Y_KEY] = globalSplit.y;

  if (typeof patch.width === 'number' || typeof patch.height === 'number') {
    const resizedAxis = inferSmartCorridorAxisFromCoreRect(getSmartCorridorCoreRect(corridor));
    nextData[CORRIDOR_AXIS_KEY] = resizedAxis;
    nextData[CORRIDOR_THICKNESS_KEY] = readCorridorThickness(corridor, resizedAxis);
  }

  if (typeof patch.rotation === 'number' && previous) {
    const width = corridor.width ?? previous.width ?? DEFAULT_CORRIDOR_THICKNESS;
    const height = corridor.height ?? previous.height ?? 280;
    const center = getCorridorWorldCenter({
      x: previous.x,
      y: previous.y,
      width,
      height,
      rotation: previous.rotation ?? 0,
    });
    nextData[CORRIDOR_SPLIT_X_KEY] = center.x;
    nextData[CORRIDOR_SPLIT_Y_KEY] = center.y;
  }

  corridor.data = nextData;
}

function buildCorridorObstacles(
  corridors: EventMapObjectDTO[],
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
): { vertical: CorridorObstacle[]; horizontal: CorridorObstacle[] } {
  const vertical: CorridorObstacle[] = [];
  const horizontal: CorridorObstacle[] = [];

  for (const corridor of corridors) {
    const layout = resolveSmartCorridorLayout(corridor);
    const partitionAxis = layout.axis === 'vertical' ? 'x' : 'y';

    const obstacle: CorridorObstacle = {
      objectIds: [corridor.id],
      axis: partitionAxis,
      coreRect: layout.coreRect,
      clearanceRect: layout.clearanceRect,
      spacing: layout.spacing,
      thickness: layout.thickness,
      splitCenter: getCorridorSplitCenter(corridor, layout, partitionAxis),
    };
    obstacle.clearanceRect = rebuildObstacleClearanceRect(obstacle);

    if (layout.axis === 'vertical') {
      vertical.push(obstacle);
    } else {
      horizontal.push(obstacle);
    }
  }

  vertical.sort((a, b) => a.splitCenter - b.splitCenter);
  horizontal.sort((a, b) => a.splitCenter - b.splitCenter);

  const unionGroupByObjectId = buildCorridorUnionGroupLookup(getCorridorUnionGroups(corridors));

  return {
    vertical: dedupeObstaclesBySplitCenter(vertical, unionGroupByObjectId),
    horizontal: dedupeObstaclesBySplitCenter(horizontal, unionGroupByObjectId),
  };
}

function groupSeatsByRow(seats: EventSeatDTO[], baseLayout: SeatBaseLayout) {
  const groups = new Map<string, EventSeatDTO[]>();

  for (const seat of seats) {
    const base = getSeatBasePoint(seat, baseLayout);
    const key = seat.rowLabel?.trim() ? seat.rowLabel : `y:${Math.round(base.y)}`;
    const current = groups.get(key) ?? [];
    current.push(seat);
    groups.set(key, current);
  }

  return [...groups.values()];
}

function groupSeatsByColumn(seats: EventSeatDTO[], baseLayout: SeatBaseLayout) {
  const groups = new Map<string, EventSeatDTO[]>();

  for (const seat of seats) {
    const base = getSeatBasePoint(seat, baseLayout);
    const key = seat.seatNumber?.trim() ? seat.seatNumber : `x:${Math.round(base.x)}`;
    const current = groups.get(key) ?? [];
    current.push(seat);
    groups.set(key, current);
  }

  return [...groups.values()];
}

function rowOverlapsObstacle(entries: SeatEntry[], obstacle: CorridorObstacle) {
  const rect = obstacle.clearanceRect;
  return entries.some((entry) => {
    const seatBounds = getSeatBounds({ ...entry.seat, x: entry.base.x, y: entry.base.y });
    return intersectsRect(seatBounds, rect);
  });
}

function columnOverlapsObstacle(entries: SeatEntry[], obstacle: CorridorObstacle) {
  const rect = obstacle.clearanceRect;
  return entries.some((entry) => {
    const seatBounds = getSeatBounds({ ...entry.seat, x: entry.base.x, y: entry.base.y });
    return intersectsRect(seatBounds, rect);
  });
}

function buildSeatEntries(seats: EventSeatDTO[], baseLayout: SeatBaseLayout, axis: 'x' | 'y'): SeatEntry[] {
  return seats.map((seat) => {
    const base = getSeatBasePoint(seat, baseLayout);
    return { seat, base, center: axis === 'x' ? base.x : base.y };
  });
}

function sortSeatEntriesByLabel(entries: SeatEntry[], axis: 'x' | 'y') {
  return [...entries].sort((left, right) => {
    if (axis === 'x') {
      const leftNum = Number(left.seat.seatNumber);
      const rightNum = Number(right.seat.seatNumber);
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum) && leftNum !== rightNum) {
        return leftNum - rightNum;
      }
    } else {
      const leftRow = left.seat.rowLabel?.trim() ?? '';
      const rightRow = right.seat.rowLabel?.trim() ?? '';
      if (leftRow && rightRow && leftRow !== rightRow) {
        return leftRow.localeCompare(rightRow);
      }
    }
    return left.center - right.center;
  });
}

function enforceMonotonicSeatCenters(entries: SeatEntry[], axis: 'x' | 'y') {
  const sorted = sortSeatEntriesByLabel(entries, axis);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const previousCenter = axis === 'x' ? previous.seat.x : previous.seat.y;
    const currentCenter = axis === 'x' ? current.seat.x : current.seat.y;
    if (currentCenter <= previousCenter) {
      const nextCenter = previousCenter + 0.01;
      if (axis === 'x') {
        current.seat.x = nextCenter;
        current.center = nextCenter;
      } else {
        current.seat.y = nextCenter;
        current.center = nextCenter;
      }
    }
  }
}

function assignSeatStacks(entries: SeatEntry[], splitCenters: number[], axis: 'x' | 'y') {
  const stacks: SeatEntry[][] = Array.from({ length: splitCenters.length + 1 }, () => []);
  const orderedEntries = sortSeatEntriesByLabel(entries, axis);

  for (const entry of orderedEntries) {
    let stackIndex = splitCenters.length;
    for (let index = 0; index < splitCenters.length; index += 1) {
      if (entry.center <= splitCenters[index]!) {
        stackIndex = index;
        break;
      }
    }
    stacks[stackIndex]!.push(entry);
  }

  return stacks;
}

function getSeatBaseEdge(entry: SeatEntry, axis: 'x' | 'y', edge: 'start' | 'end') {
  const size = getSeatSize(entry.seat);
  const center = axis === 'x' ? entry.base.x : entry.base.y;
  return edge === 'start' ? center - size / 2 : center + size / 2;
}

function applyAxisObstaclesToSeatLines(
  seatLines: EventSeatDTO[][],
  baseLayout: SeatBaseLayout,
  obstacles: CorridorObstacle[],
  axis: 'x' | 'y',
) {
  if (obstacles.length === 0) return;

  const numLines = seatLines.length;
  const numObstacles = obstacles.length;

  const overlaps = axis === 'x' ? rowOverlapsObstacle : columnOverlapsObstacle;

  const lineData = seatLines.map((lineSeats) => {
    const entries = buildSeatEntries(lineSeats, baseLayout, axis);
    const active = obstacles.filter((obstacle) => overlaps(entries, obstacle));
    if (active.length === 0) return null;

    const stacks = assignSeatStacks(
      entries,
      active.map((obstacle) => obstacle.splitCenter),
      axis,
    );

    const numStacks = stacks.length;
    const starts = new Array(numStacks);
    const ends = new Array(numStacks);
    for (let s = 0; s < numStacks; s++) {
      const stack = stacks[s]!;
      if (stack.length > 0) {
        starts[s] = Math.min(...stack.map((entry) => getSeatBaseEdge(entry, axis, 'start')));
        ends[s] = Math.max(...stack.map((entry) => getSeatBaseEdge(entry, axis, 'end')));
      }
    }

    const activeIndices = active.map((obs) => obstacles.findIndex((o) => o === obs));

    return {
      entries,
      active,
      activeIndices,
      stacks,
      starts,
      ends,
      x_S: new Array(numStacks).fill(0),
      w_S: new Array(numStacks).fill(1.0),
    };
  });

  for (let r = 0; r < numLines; r++) {
    const data = lineData[r];
    if (!data) continue;

    const numActive = data.active.length;
    const numStacks = data.stacks.length;

    for (let i = 0; i < numStacks; i++) {
      const stack = data.stacks[i]!;
      if (stack.length === 0) continue;

      let d_min = -Infinity;
      let d_max = Infinity;

      if (i > 0) {
        const obs = data.active[i - 1]!;
        const obsStart = axis === 'x' ? obs.clearanceRect.x : obs.clearanceRect.y;
        const obsEnd = obsStart + (axis === 'x' ? obs.clearanceRect.width : obs.clearanceRect.height);
        d_min = obsEnd - data.starts[i];
      }

      if (i < numActive) {
        const obs = data.active[i]!;
        const obsStart = axis === 'x' ? obs.clearanceRect.x : obs.clearanceRect.y;
        d_max = obsStart - data.ends[i];
      }

      let d = 0;
      if (d_min > d_max) {
        d = (d_min + d_max) / 2;
      } else {
        if (d_min > 0) {
          d = d_min;
        } else if (d_max < 0) {
          d = d_max;
        }
      }

      if (process.env.DEBUG_REFLOW === 'true') {
        console.log(`[REFLOW_DEBUG_ITER] row/col: ${r}, stack: ${i}, d_min: ${d_min.toFixed(4)}, d_max: ${d_max.toFixed(4)}, d: ${d.toFixed(4)}`);
      }

      data.x_S[i] = d;
    }
  }

  // Apply displacements to seats
  for (let r = 0; r < numLines; r++) {
    const data = lineData[r];
    if (!data) continue;

    const numStacks = data.stacks.length;
    for (let i = 0; i < numStacks; i++) {
      const stack = data.stacks[i]!;
      if (stack.length === 0) continue;
      const delta = data.x_S[i];
      for (const entry of stack) {
        if (axis === 'x') {
          entry.seat.x = entry.base.x + delta;
        } else {
          entry.seat.y = entry.base.y + delta;
        }
      }
    }

    const lineEntries = lineData[r]?.entries;
    if (lineEntries) enforceMonotonicSeatCenters(lineEntries, axis);
  }
}

function getCrossAxisSpan(entries: SeatEntry[], partitionAxis: 'x' | 'y') {
  if (entries.length === 0) return null;

  if (partitionAxis === 'x') {
    return {
      min: Math.min(...entries.map((entry) => entry.seat.y - getSeatSize(entry.seat) / 2)),
      max: Math.max(...entries.map((entry) => entry.seat.y + getSeatSize(entry.seat) / 2)),
    };
  }

  return {
    min: Math.min(...entries.map((entry) => entry.seat.x - getSeatSize(entry.seat) / 2)),
    max: Math.max(...entries.map((entry) => entry.seat.x + getSeatSize(entry.seat) / 2)),
  };
}

function getRequiredClearanceForAxis(input: {
  axis: 'x' | 'y';
  thickness: number;
  spacing: CorridorSpacing;
}) {
  return input.axis === 'x'
    ? input.spacing.left + input.thickness + input.spacing.right
    : input.spacing.top + input.thickness + input.spacing.bottom;
}

function applyCorridorCoreGeometry({
  corridor,
  axis,
  gapStart,
  gapEnd,
  spacing,
  thickness,
}: {
  corridor: EventMapObjectDTO;
  axis: 'x' | 'y';
  gapStart: number;
  gapEnd: number;
  crossSpan: { min: number; max: number };
  spacing: CorridorSpacing;
  thickness: number;
}) {
  const availableGap = gapEnd - gapStart;
  if (availableGap <= 0.001) return;

  const preservedWidth = corridor.width ?? thickness;
  const preservedHeight = corridor.height ?? thickness;
  const normalizedWidth =
    axis === 'x' ? Math.max(preservedWidth, MIN_CORRIDOR_THICKNESS) : preservedWidth;
  const normalizedHeight =
    axis === 'y' ? Math.max(preservedHeight, MIN_CORRIDOR_THICKNESS) : preservedHeight;
  const normalizedPartitionSize = axis === 'x' ? normalizedWidth : normalizedHeight;
  const requiredGap =
    axis === 'x'
      ? spacing.left + normalizedPartitionSize + spacing.right
      : spacing.top + normalizedPartitionSize + spacing.bottom;

  const nextData: Record<string, unknown> = { ...corridor.data };
  delete nextData.corridorLayoutWarning;

  if (availableGap + 0.001 < requiredGap) {
    nextData.corridorLayoutWarning = 'INSUFFICIENT_GAP';
  }

  if (axis === 'x') {
    if (availableGap < requiredGap) {
      corridor.x = gapStart + (availableGap - normalizedPartitionSize) / 2;
    } else {
      const minX = Number.isFinite(gapStart) ? gapStart + spacing.left : -Infinity;
      const maxX = Number.isFinite(gapEnd) ? gapEnd - spacing.right - normalizedPartitionSize : Infinity;
      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        corridor.x = clampNumber(corridor.x, minX, Math.max(minX, maxX));
      } else if (Number.isFinite(minX)) {
        corridor.x = Math.max(corridor.x, minX);
      } else if (Number.isFinite(maxX)) {
        corridor.x = Math.min(corridor.x, maxX);
      }
    }
  } else if (availableGap < requiredGap) {
    corridor.y = gapStart + (availableGap - normalizedPartitionSize) / 2;
  } else {
    const minY = Number.isFinite(gapStart) ? gapStart + spacing.top : -Infinity;
    const maxY = Number.isFinite(gapEnd) ? gapEnd - spacing.bottom - normalizedPartitionSize : Infinity;
    if (Number.isFinite(minY) && Number.isFinite(maxY)) {
      corridor.y = clampNumber(corridor.y, minY, Math.max(minY, maxY));
    } else if (Number.isFinite(minY)) {
      corridor.y = Math.max(corridor.y, minY);
    } else if (Number.isFinite(maxY)) {
      corridor.y = Math.min(corridor.y, maxY);
    }
  }

  corridor.width = normalizedWidth;
  corridor.height = normalizedHeight;
  corridor.data = nextData;
  persistSmartCorridorMetadata(corridor);
}

function syncCorridorCoresToOpenedGaps(
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
  obstacles: CorridorObstacle[],
  corridorById: Map<string, EventMapObjectDTO>,
  axis: 'x' | 'y',
  baseBounds: SectionBaseBounds,
  freezeAutoFitCorridorIds?: Set<string>,
) {
  const lines =
    axis === 'x' ? groupSeatsByRow(sectionSeats, baseLayout) : groupSeatsByColumn(sectionSeats, baseLayout);
  const overlaps = axis === 'x' ? rowOverlapsObstacle : columnOverlapsObstacle;

  for (const obstacle of obstacles) {
    const affectedLines = lines.filter((lineSeats) => {
      const entries = buildSeatEntries(lineSeats, baseLayout, axis);
      return entries.length > 0 && overlaps(entries, obstacle);
    });

    if (affectedLines.length === 0) continue;

    let gapStart = -Infinity;
    let gapEnd = Infinity;
    const crossMins: number[] = [];
    const crossMaxs: number[] = [];

    for (const lineSeats of affectedLines) {
      const entries = buildSeatEntries(lineSeats, baseLayout, axis);
      const stacks = assignSeatStacks(entries, [obstacle.splitCenter], axis);
      const leftStack = stacks[0] ?? [];
      const rightStack = stacks[1] ?? [];

      if (leftStack.length === 0 && rightStack.length === 0) continue;

      if (leftStack.length > 0) {
        gapStart = Math.max(
          gapStart,
          ...leftStack.map((entry) => getSeatAxisEdge(entry.seat, axis, 'end')),
        );
      } else {
        const boundary = axis === 'x' 
          ? baseBounds.x - obstacle.spacing.left 
          : baseBounds.y - obstacle.spacing.top;
        gapStart = Math.max(gapStart, boundary);
      }

      if (rightStack.length > 0) {
        gapEnd = Math.min(
          gapEnd,
          ...rightStack.map((entry) => getSeatAxisEdge(entry.seat, axis, 'start')),
        );
      } else {
        const boundary = axis === 'x' 
          ? baseBounds.x + baseBounds.width + obstacle.spacing.right 
          : baseBounds.y + baseBounds.height + obstacle.spacing.bottom;
        gapEnd = Math.min(gapEnd, boundary);
      }

      const span = getCrossAxisSpan([...leftStack, ...rightStack], axis);
      if (span) {
        crossMins.push(span.min);
        crossMaxs.push(span.max);
      }
    }

    if (!Number.isFinite(gapStart) && !Number.isFinite(gapEnd)) continue;
    if (crossMins.length === 0 || crossMaxs.length === 0) continue;

    // For each corridor in this obstacle, compute individual crossSpan
    for (const objectId of obstacle.objectIds) {
      const corridor = corridorById.get(objectId);
      if (!corridor || freezeAutoFitCorridorIds?.has(objectId)) continue;

      const corrLayout = resolveSmartCorridorLayout(corridor);
      const corrObstacle: CorridorObstacle = {
        objectIds: [objectId],
        axis: axis,
        coreRect: corrLayout.coreRect,
        clearanceRect: corrLayout.clearanceRect,
        spacing: corrLayout.spacing,
        thickness: corrLayout.thickness,
        splitCenter: getCorridorSplitCenter(corridor, corrLayout, axis),
      };

      const corrAffectedLines = lines.filter((lineSeats) => {
        const entries = buildSeatEntries(lineSeats, baseLayout, axis);
        return entries.length > 0 && overlaps(entries, corrObstacle);
      });

      const corrCrossMins: number[] = [];
      const corrCrossMaxs: number[] = [];

      for (const lineSeats of corrAffectedLines) {
        const entries = buildSeatEntries(lineSeats, baseLayout, axis);
        const stacks = assignSeatStacks(entries, [obstacle.splitCenter], axis);
        const leftStack = stacks[0] ?? [];
        const rightStack = stacks[1] ?? [];
        const span = getCrossAxisSpan([...leftStack, ...rightStack], axis);
        if (span) {
          corrCrossMins.push(span.min);
          corrCrossMaxs.push(span.max);
        }
      }

      const minCross = corrCrossMins.length > 0 ? Math.min(...corrCrossMins) : Math.min(...crossMins);
      const maxCross = corrCrossMaxs.length > 0 ? Math.max(...corrCrossMaxs) : Math.max(...crossMaxs);

      applyCorridorCoreGeometry({
        corridor,
        axis,
        gapStart,
        gapEnd,
        crossSpan: { min: minCross, max: maxCross },
        spacing: corrObstacle.spacing,
        thickness: corrObstacle.thickness,
      });
    }
  }
}

function applySmartCorridorStackReflow(
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
  obstacles: { vertical: CorridorObstacle[]; horizontal: CorridorObstacle[] },
  corridorById: Map<string, EventMapObjectDTO>,
  baseBounds: SectionBaseBounds,
  freezeAutoFitCorridorIds?: Set<string>,
) {
  for (const seat of sectionSeats) {
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
    seat.x = base.x;
    seat.y = base.y;
  }

  applyAxisObstaclesToSeatLines(groupSeatsByRow(sectionSeats, baseLayout), baseLayout, obstacles.vertical, 'x');
  applyAxisObstaclesToSeatLines(groupSeatsByColumn(sectionSeats, baseLayout), baseLayout, obstacles.horizontal, 'y');

  syncCorridorCoresToOpenedGaps(sectionSeats, baseLayout, obstacles.vertical, corridorById, 'x', baseBounds, freezeAutoFitCorridorIds);
  syncCorridorCoresToOpenedGaps(sectionSeats, baseLayout, obstacles.horizontal, corridorById, 'y', baseBounds, freezeAutoFitCorridorIds);
}

function getGlobalCorridorSplitCenter(corridor: EventMapObjectDTO) {
  const x = Number(corridor.data[CORRIDOR_SPLIT_X_KEY]);
  const y = Number(corridor.data[CORRIDOR_SPLIT_Y_KEY]);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  const localCenter = {
    x: corridor.x + (corridor.width ?? 0) / 2,
    y: corridor.y + (corridor.height ?? 0) / 2,
  };
  return toGlobal(localCenter, { x: corridor.x, y: corridor.y }, corridor.rotation ?? 0);
}

export function applyCorridorReflow(map: EventMapDTO, options?: CorridorReflowOptions) {
  const maxIterations = options?.maxIterations ?? CORRIDOR_DRAG_COMMIT_ITERATIONS;
  const freezeAutoFitCorridorIds = new Set(options?.freezeAutoFitCorridorIds ?? []);
  const allCorridors = map.objects.filter(isCorridor);
  const scopedCorridors =
    options?.activeCorridorIds && options.activeCorridorIds.length > 0
      ? allCorridors.filter((corridor) => options.activeCorridorIds!.includes(corridor.id))
      : allCorridors;
  const corridorById = new Map(allCorridors.map((corridor) => [corridor.id, corridor]));
  const affectedSectionIds = collectAffectedSectionIds(map, scopedCorridors);
  if (affectedSectionIds.size === 0) return;

  const sectionObjects = map.objects.filter((object) => isSectionObject(object) && object.sectionId);

  for (const sectionObject of sectionObjects) {
    const sectionId = sectionObject.sectionId;
    if (!sectionId || !affectedSectionIds.has(sectionId)) continue;

    const sectionSeats = map.seats.filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD');
    if (sectionSeats.length === 0) continue;

    const previousBaseLayout = readSeatBaseLayout(sectionObject);
    const previousBaseBounds = readSectionBaseBounds(sectionObject);
    const baseLayout: SeatBaseLayout = { ...previousBaseLayout };
    for (const seat of sectionSeats) {
      if (!baseLayout[seat.id]) baseLayout[seat.id] = { x: seat.x, y: seat.y };
    }
    const baseBounds = previousBaseBounds ?? {
      x: sectionObject.x,
      y: sectionObject.y,
      width: sectionObject.width ?? 0,
      height: sectionObject.height ?? 0,
    };

    const sectionRotation = sectionObject.rotation ?? 0;
    const sectionPivot = { x: baseBounds.x, y: baseBounds.y };

    const sectionCorridors = allCorridors.filter((corridor) => {
      if (corridor.levelId !== sectionObject.levelId) return false;
      return corridorAffectsSection({ corridor, sectionSeats, baseLayout, baseBounds, sectionRotation });
    });

    if (sectionCorridors.length > 0) {
      // 1. Map seats to local space
      const originalSeatPositions = new Map<string, { x: number; y: number }>();
      for (const seat of sectionSeats) {
        originalSeatPositions.set(seat.id, { x: seat.x, y: seat.y });
        const localPt = toLocal({ x: seat.x, y: seat.y }, sectionPivot, sectionRotation);
        seat.x = localPt.x;
        seat.y = localPt.y;
      }

      // 2. Map baseLayout to local space
      const localBaseLayout: SeatBaseLayout = {};
      for (const [seatId, point] of Object.entries(baseLayout)) {
        localBaseLayout[seatId] = toLocal(point, sectionPivot, sectionRotation);
      }

      // 3. Map corridors to local space
      const localCorridors: EventMapObjectDTO[] = [];
      const originalCorridors = new Map<string, EventMapObjectDTO>();
      const localAABBs = new Map<string, BoundsRect>();

      for (const c of sectionCorridors) {
        originalCorridors.set(c.id, { ...c, data: { ...c.data } });

        const { localCorridor, localReferenceBounds } = mapCorridorToSectionLocal(c, sectionPivot, sectionRotation);
        localAABBs.set(c.id, localReferenceBounds);
        localCorridors.push(localCorridor);
      }

      const localCorridorById = new Map(localCorridors.map((c) => [c.id, c]));

      // 4. Run local reflow
      const localBaseBounds: SectionBaseBounds = {
        x: baseBounds.x,
        y: baseBounds.y,
        width: baseBounds.width,
        height: baseBounds.height,
      };

      // Ensure split anchors are set and stable in local space using undisplaced local coordinates
      const tempSeatsPos = sectionSeats.map((seat) => ({ id: seat.id, x: seat.x, y: seat.y }));
      for (const seat of sectionSeats) {
        const base = localBaseLayout[seat.id];
        if (base) {
          seat.x = base.x;
          seat.y = base.y;
        }
      }
      for (const localC of localCorridors) {
        ensureCorridorSplitAnchors(localC, sectionSeats, localBaseLayout);
      }
      for (let i = 0; i < sectionSeats.length; i++) {
        sectionSeats[i]!.x = tempSeatsPos[i]!.x;
        sectionSeats[i]!.y = tempSeatsPos[i]!.y;
      }

      for (let iter = 0; iter < maxIterations; iter++) {
        const localObstacles = buildCorridorObstacles(localCorridors, sectionSeats, localBaseLayout);
        applySmartCorridorStackReflow(
          sectionSeats,
          localBaseLayout,
          localObstacles,
          localCorridorById,
          localBaseBounds,
          freezeAutoFitCorridorIds,
        );
      }

      for (const localC of localCorridors) {
        reconcileCorridorGeometry(localC);
      }

      // 5. Map seats back to global space
      for (const seat of sectionSeats) {
        const globalPt = toGlobal({ x: seat.x, y: seat.y }, sectionPivot, sectionRotation);
        seat.x = Number(globalPt.x.toFixed(4));
        seat.y = Number(globalPt.y.toFixed(4));
      }

      // 6. Map baseLayout back to global space
      const globalBaseLayout: SeatBaseLayout = {};
      for (const [seatId, point] of Object.entries(localBaseLayout)) {
        const globalPt = toGlobal(point, sectionPivot, sectionRotation);
        globalBaseLayout[seatId] = {
          x: Number(globalPt.x.toFixed(4)),
          y: Number(globalPt.y.toFixed(4)),
        };
      }
      writeSeatBaseLayout(sectionObject, globalBaseLayout);
      writeSectionBaseBounds(sectionObject, baseBounds);

      // 7. Map section boundaries back to global space
      const localSectionObject = {
        ...sectionObject,
        x: localBaseBounds.x,
        y: localBaseBounds.y,
        width: localBaseBounds.width,
        height: localBaseBounds.height,
      };
      resizeSectionToSeats(localSectionObject, sectionSeats, localBaseBounds);

      const globalSectionPos = toGlobal({ x: localSectionObject.x, y: localSectionObject.y }, sectionPivot, sectionRotation);
      sectionObject.x = Number(globalSectionPos.x.toFixed(4));
      sectionObject.y = Number(globalSectionPos.y.toFixed(4));
      sectionObject.width = Number(localSectionObject.width.toFixed(4));
      sectionObject.height = Number(localSectionObject.height.toFixed(4));

      // 8. Map corridors back to global space
      for (const localC of localCorridors) {
        const originalC = originalCorridors.get(localC.id);
        const actualC = corridorById.get(localC.id);
        const localAABB = localAABBs.get(localC.id);
        if (!originalC || !actualC || !localAABB) continue;

        // Calculate local displacement delta
        const deltaX = localC.x - localAABB.x;
        const deltaY = localC.y - localAABB.y;

        // Calculate the original position in local space
        const localOriginalPos = toLocal({ x: originalC.x, y: originalC.y }, sectionPivot, sectionRotation);

        // Shift the original position by the displacement delta
        const localNewPos = {
          x: localOriginalPos.x + deltaX,
          y: localOriginalPos.y + deltaY,
        };

        // Convert the new local position back to global space
        const globalCorridorPos = toGlobal(localNewPos, sectionPivot, sectionRotation);

        actualC.x = Number(globalCorridorPos.x.toFixed(4));
        actualC.y = Number(globalCorridorPos.y.toFixed(4));
        actualC.width = originalC.width;
        actualC.height = originalC.height;
        actualC.rotation = originalC.rotation;

        const localSplitPt = {
          x: Number(localC.data[CORRIDOR_SPLIT_X_KEY]),
          y: Number(localC.data[CORRIDOR_SPLIT_Y_KEY]),
        };
        const globalSplitPt = toGlobal(localSplitPt, sectionPivot, sectionRotation);

        actualC.data = {
          ...actualC.data,
          ...localC.data,
          [CORRIDOR_AXIS_KEY]: readStoredCorridorAxis(originalC),
          [CORRIDOR_SPLIT_X_KEY]: Number(globalSplitPt.x.toFixed(4)),
          [CORRIDOR_SPLIT_Y_KEY]: Number(globalSplitPt.y.toFixed(4)),
        };

        persistSmartCorridorMetadata(actualC);
      }
    } else if (Object.keys(previousBaseLayout).length > 0) {
      for (const seat of sectionSeats) {
        const base = previousBaseLayout[seat.id];
        if (base) {
          seat.x = base.x;
          seat.y = base.y;
        }
      }

      if (previousBaseBounds) {
        sectionObject.x = previousBaseBounds.x;
        sectionObject.y = previousBaseBounds.y;
        sectionObject.width = previousBaseBounds.width;
        sectionObject.height = previousBaseBounds.height;
      }
      const nextData = { ...sectionObject.data };
      delete nextData[SEAT_BASE_LAYOUT_KEY];
      delete nextData[SECTION_BASE_BOUNDS_KEY];
      sectionObject.data = nextData;
    }
  }
}

function mapCorridorToSectionLocal(
  corridor: EventMapObjectDTO,
  sectionPivot: { x: number; y: number },
  sectionRotation: number,
): { localCorridor: EventMapObjectDTO; localReferenceBounds: BoundsRect } {
  const coreRect = getSmartCorridorCoreRect(corridor);
  const globalCorners = getRectCorners(coreRect, { x: corridor.x, y: corridor.y }, corridor.rotation ?? 0);
  const localCorners = globalCorners.map((point) => toLocal(point, sectionPivot, sectionRotation));
  const localReferenceBounds = getAABB(localCorners);

  const effectiveRotation = snapSmartCorridorRotation((corridor.rotation ?? 0) - sectionRotation);
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

function getSectionContext(
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

export function resolveCorridorDragMode(
  baseMap: EventMapDTO,
  drag: CorridorDragSession,
  corridorIds: string[],
): CorridorDragMode {
  if (corridorIds.length === 0) return 'reflow';

  const originIds = new Set([...drag.origin.keys()].map((nodeId) => nodeId.replace(/^node-/, '')));
  const corridorSet = new Set(corridorIds);
  const checkedSections = new Set<string>();

  for (const corridorId of corridorIds) {
    const corridor = baseMap.objects.find((object) => object.id === corridorId && object.type === 'CORRIDOR');
    if (!corridor) continue;

    for (const sectionObject of baseMap.objects) {
      if (sectionObject.type !== 'SECTION' || !sectionObject.sectionId) continue;
      if (sectionObject.levelId !== corridor.levelId) continue;
      if (checkedSections.has(sectionObject.sectionId)) continue;

      const context = getSectionContext(baseMap, sectionObject.sectionId);
      if (!context || context.sectionSeats.length === 0) continue;

      if (
        !corridorAffectsSection({
          corridor,
          sectionSeats: context.sectionSeats,
          baseLayout: context.baseLayout,
          baseBounds: context.baseBounds,
          sectionRotation: sectionObject.rotation ?? 0,
        })
      ) {
        continue;
      }

      checkedSections.add(sectionObject.sectionId);

      const affectingCorridors = baseMap.objects.filter(
        (object) =>
          object.type === 'CORRIDOR' &&
          corridorAffectsSection({
            corridor: object,
            sectionSeats: context.sectionSeats,
            baseLayout: context.baseLayout,
            baseBounds: context.baseBounds,
            sectionRotation: sectionObject.rotation ?? 0,
          }),
      );

      const allSeatsSelected = context.sectionSeats.every((seat) => originIds.has(seat.id));
      const allCorridorsSelected = affectingCorridors.every((entry) => corridorSet.has(entry.id) && originIds.has(entry.id));
      const sectionFrameSelected = originIds.has(context.sectionObject.id);

      if (allSeatsSelected && allCorridorsSelected && sectionFrameSelected) {
        return 'rigid';
      }
    }
  }

  return 'reflow';
}

function applyRigidDragDeltaToPreview(
  preview: EventMapDTO,
  drag: CorridorDragSession,
  skipIds: Set<string> = new Set(),
) {
  for (const [nodeId, start] of drag.origin) {
    const id = nodeId.replace(/^node-/, '');
    if (skipIds.has(id)) continue;

    const nextX = start.x + drag.delta.x;
    const nextY = start.y + drag.delta.y;

    const seat = preview.seats.find((entry) => entry.id === id);
    if (seat) {
      seat.x = nextX;
      seat.y = nextY;
      continue;
    }

    const object = preview.objects.find((entry) => entry.id === id);
    if (object) {
      object.x = nextX;
      object.y = nextY;
    }
  }
}

function originIdsFromDrag(drag: CorridorDragSession) {
  return new Set([...drag.origin.keys()].map((nodeId) => nodeId.replace(/^node-/, '')));
}

export function buildRigidGroupDragPreview(baseMap: EventMapDTO, drag: CorridorDragSession): EventMapDTO {
  const preview = cloneEventMap(baseMap);
  applyRigidDragDeltaToPreview(preview, drag);
  return preview;
}

export function applyCorridorPreviewPatch(
  preview: EventMapDTO,
  baseMap: EventMapDTO,
  objectId: string,
  patch: Partial<EventMapObjectDTO>,
  options?: { mode?: 'rotate' | 'resize' | 'group-rotate' | 'group-resize' },
) {
  const object = preview.objects.find((entry) => entry.id === objectId);
  const previous = baseMap.objects.find((entry) => entry.id === objectId);

  if (!object || !previous || object.type !== 'CORRIDOR') return;

  const normalizedPatch = { ...patch };
  if (
    typeof normalizedPatch.rotation === 'number' &&
    options?.mode !== 'group-rotate' &&
    options?.mode !== 'group-resize'
  ) {
    normalizedPatch.rotation = snapSmartCorridorRotation(normalizedPatch.rotation);
  }

  const rotationChanged =
    typeof normalizedPatch.rotation === 'number' &&
    normalizedPatch.rotation !== snapSmartCorridorRotation(previous.rotation ?? 0);
  const inferredRotationOnly = rotationChanged && isCorridorRotationOnlyTransform(normalizedPatch, previous);
  const mode = options?.mode ?? (inferredRotationOnly ? 'rotate' : 'resize');

  const { rotation, x, y, width, height, data, ...rest } = normalizedPatch;
  Object.assign(object, rest);

  if (typeof width === 'number') object.width = width;
  if (typeof height === 'number') object.height = height;
  if (data) object.data = { ...object.data, ...data };

  if (mode === 'group-rotate' || mode === 'group-resize') {
    if (typeof x === 'number') object.x = x;
    if (typeof y === 'number') object.y = y;
    if (typeof width === 'number') object.width = width;
    if (typeof height === 'number') object.height = height;
    if (typeof rotation === 'number') object.rotation = snapSmartCorridorRotation(rotation);
    reconcileCorridorGeometry(object);
  } else if (mode === 'rotate' && typeof rotation === 'number') {
    applyCorridorRotationPreservingCenter(object, rotation, previous);
  } else {
    if (typeof x === 'number') object.x = x;
    if (typeof y === 'number') object.y = y;
    if (typeof rotation === 'number') object.rotation = rotation;
  }

  updateCorridorSplitAnchorsOnDrag(object, normalizedPatch, previous);
}

export type CorridorTransformPreviewPatch = {
  objectId: string;
  patch: Partial<EventMapObjectDTO>;
  mode?: 'rotate' | 'resize' | 'group-rotate' | 'group-resize';
  /** Konva anchor used for this gesture (domain handle fidelity). */
  anchor?: string;
};

export function resetCorridorPreviewFromBase(preview: EventMapDTO, base: EventMapDTO) {
  for (const baseSeat of base.seats) {
    const seat = preview.seats.find((entry) => entry.id === baseSeat.id);
    if (!seat) continue;
    seat.x = baseSeat.x;
    seat.y = baseSeat.y;
  }

  for (const baseObject of base.objects) {
    const object = preview.objects.find((entry) => entry.id === baseObject.id);
    if (!object) continue;
    object.x = baseObject.x;
    object.y = baseObject.y;
    object.width = baseObject.width;
    object.height = baseObject.height;
    object.rotation = baseObject.rotation;
    object.data = { ...baseObject.data };
  }
}

export function buildSmartCorridorDragPreview(
  baseMap: EventMapDTO,
  drag: CorridorDragSession,
  corridorNodeIds: string[],
  options?: SmartCorridorDragPreviewOptions,
): EventMapDTO {
  const corridorIds = corridorNodeIds.map((nodeId) => nodeId.replace(/^node-/, ''));
  const mode = options?.mode ?? resolveCorridorDragMode(baseMap, drag, corridorIds);

  if (mode === 'rigid') {
    return buildRigidGroupDragPreview(baseMap, drag);
  }

  const preview = options?.previewMap ?? cloneEventMap(baseMap);
  if (options?.previewMap) {
    resetCorridorPreviewFromBase(preview, baseMap);
  }

  for (const nodeId of drag.origin.keys()) {
    const objectId = nodeId.replace(/^node-/, '');
    const start = drag.origin.get(nodeId);
    const baseObject = baseMap.objects.find((entry) => entry.id === objectId);
    if (!start || !baseObject) continue;

    if (baseObject.type === 'CORRIDOR') {
      applyCorridorPreviewPatch(preview, baseMap, objectId, {
        x: start.x + drag.delta.x,
        y: start.y + drag.delta.y,
        rotation: baseObject.rotation,
        width: baseObject.width,
        height: baseObject.height,
      });
    } else {
      const object = preview.objects.find((entry) => entry.id === objectId);
      if (object) {
        object.x = start.x + drag.delta.x;
        object.y = start.y + drag.delta.y;
      }
    }
  }

  applyCorridorReflow(preview, {
    maxIterations: options?.maxIterations ?? CORRIDOR_REFLOW_ITERATIONS,
    activeCorridorIds: options?.activeCorridorIds,
  });

  const originIds = originIdsFromDrag(drag);
  for (const seat of preview.seats) {
    if (!originIds.has(seat.id)) continue;
    const baseSeat = baseMap.seats.find((entry) => entry.id === seat.id);
    const start = drag.origin.get(`node-${seat.id}`);
    if (!baseSeat || !start) continue;
    const reflowChanged =
      Math.abs(seat.x - baseSeat.x) >= 0.001 || Math.abs(seat.y - baseSeat.y) >= 0.001;
    if (!reflowChanged) {
      seat.x = start.x + drag.delta.x;
      seat.y = start.y + drag.delta.y;
    }
  }

  return preview;
}

export function buildSmartCorridorTransformPreview(
  baseMap: EventMapDTO,
  patches: CorridorTransformPreviewPatch[],
  options?: SmartCorridorDragPreviewOptions,
): EventMapDTO {
  const preview = options?.previewMap ?? cloneEventMap(baseMap);
  if (options?.previewMap) {
    resetCorridorPreviewFromBase(preview, baseMap);
  }

  const freezeAutoFitCorridorIds: string[] = [];

  for (const { objectId, patch, mode } of patches) {
    const previous = baseMap.objects.find((entry) => entry.id === objectId);
    const resolvedMode =
      mode ??
      (previous?.type === 'CORRIDOR' && isCorridorRotationOnlyTransform(patch, previous)
        ? 'rotate'
        : 'resize');

    if (
      resolvedMode === 'rotate' ||
      resolvedMode === 'resize' ||
      resolvedMode === 'group-rotate' ||
      resolvedMode === 'group-resize'
    ) {
      freezeAutoFitCorridorIds.push(objectId);
    }

    applyCorridorPreviewPatch(preview, baseMap, objectId, patch, { mode: resolvedMode });
  }

  applyCorridorReflow(preview, {
    maxIterations: options?.maxIterations ?? CORRIDOR_REFLOW_ITERATIONS,
    activeCorridorIds: options?.activeCorridorIds,
    freezeAutoFitCorridorIds,
  });
  return preview;
}

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

export {
  DEFAULT_CORRIDOR_GAP,
  DEFAULT_CORRIDOR_THICKNESS,
  MIN_CORRIDOR_THICKNESS,
  expandRectWithSpacing,
  getCorridorSpacing,
  inferSmartCorridorAxisFromCoreRect,
  readCorridorThickness,
  reconcileCorridorGeometry,
  resolveSmartCorridorLayout,
};
