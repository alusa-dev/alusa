import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';
import {
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
  expandRectWithSpacing,
  getCorridorSpacing,
  inferCorridorAxisFromSize,
  inferSmartCorridorAxisFromCoreRect,
  normalizeSmartCorridorObject,
  readCorridorThickness,
  resolveSmartCorridorLayout,
  SMART_CORRIDOR_KIND_KEY,
  type CorridorSpacing,
  type SmartCorridorAxis,
} from './smart-corridor-layout';
import { getObjectBounds, getSeatBounds, intersectsRect, type BoundsRect } from './selection-utils';

export { cloneEventMap, inferCorridorAxisFromSize };

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
  const { coreRect, spacing, thickness, splitCenter, axis } = obstacle;

  if (axis === 'x') {
    const width = thickness + spacing.left + spacing.right;
    return {
      x: splitCenter - width / 2,
      y: coreRect.y - spacing.top,
      width,
      height: coreRect.height + spacing.top + spacing.bottom,
    };
  }

  const height = thickness + spacing.top + spacing.bottom;
  return {
    x: coreRect.x - spacing.left,
    y: splitCenter - height / 2,
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

function obstaclesShouldMerge(left: CorridorObstacle, right: CorridorObstacle) {
  if (left.axis !== right.axis) return false;
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

function dedupeObstaclesBySplitCenter(obstacles: CorridorObstacle[]) {
  const merged: CorridorObstacle[] = [];

  for (const obstacle of obstacles) {
    const existing = merged.find((entry) => obstaclesShouldMerge(entry, obstacle));

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

function getSeatBoundsFromBase(seat: EventSeatDTO, baseLayout: SeatBaseLayout) {
  const base = getSeatBasePoint(seat, baseLayout);
  return getSeatBounds({ ...seat, x: base.x, y: base.y });
}

function corridorAffectsSection({
  corridor,
  sectionSeats,
  baseLayout,
  baseBounds,
}: {
  corridor: EventMapObjectDTO;
  sectionSeats: EventSeatDTO[];
  baseLayout: SeatBaseLayout;
  baseBounds: SectionBaseBounds;
}) {
  const { clearanceRect } = resolveSmartCorridorLayout(corridor);

  if (intersectsRect(baseBounds, clearanceRect)) {
    return true;
  }

  return sectionSeats.some((seat) => intersectsRect(getSeatBoundsFromBase(seat, baseLayout), clearanceRect));
}

function collectAffectedSectionIds(map: EventMapDTO, corridors: EventMapObjectDTO[]) {
  const affected = new Set<string>();
  const sectionObjects = map.objects.filter(isSectionObject);

  for (const corridor of corridors) {
    const { clearanceRect } = resolveSmartCorridorLayout(corridor);

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

      if (corridorAffectsSection({ corridor, sectionSeats, baseLayout, baseBounds })) {
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

  const resolved = resolveInitialCorridorSplitCenter(layout.coreRect, axis, sectionSeats, baseLayout);
  const storedPair = getPartitionedPairIndex(centers, stored);
  const resolvedPair = getPartitionedPairIndex(centers, resolved);

  if (resolvedPair !== null && storedPair !== resolvedPair) {
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

  const movedX = typeof patch.x === 'number' && previous;
  const movedY = typeof patch.y === 'number' && previous;

  if (axis === 'vertical') {
    const previousSplit = Number(previous?.data[CORRIDOR_SPLIT_X_KEY]);
    nextData[CORRIDOR_SPLIT_X_KEY] =
      movedX && Number.isFinite(previousSplit)
        ? previousSplit + (corridor.x - previous.x)
        : layout.coreRect.x + layout.coreRect.width / 2;
  }

  if (axis === 'horizontal') {
    const previousSplit = Number(previous?.data[CORRIDOR_SPLIT_Y_KEY]);
    nextData[CORRIDOR_SPLIT_Y_KEY] =
      movedY && Number.isFinite(previousSplit)
        ? previousSplit + (corridor.y - previous.y)
        : layout.coreRect.y + layout.coreRect.height / 2;
  }

  if (typeof patch.width === 'number' || typeof patch.height === 'number') {
    const nextLayout = resolveSmartCorridorLayout(corridor);
    nextData[CORRIDOR_THICKNESS_KEY] =
      nextLayout.axis === 'vertical'
        ? Math.max(1, nextLayout.coreRect.width)
        : Math.max(1, nextLayout.coreRect.height);
  }

  corridor.rotation = 0;
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
    ensureCorridorSplitAnchors(corridor, sectionSeats, baseLayout);
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

    if (layout.axis === 'vertical') {
      vertical.push(obstacle);
    } else {
      horizontal.push(obstacle);
    }
  }

  vertical.sort((a, b) => a.splitCenter - b.splitCenter);
  horizontal.sort((a, b) => a.splitCenter - b.splitCenter);

  return {
    vertical: dedupeObstaclesBySplitCenter(vertical),
    horizontal: dedupeObstaclesBySplitCenter(horizontal),
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
  const rowMinY = Math.min(...entries.map((entry) => entry.base.y - getSeatSize(entry.seat) / 2));
  const rowMaxY = Math.max(...entries.map((entry) => entry.base.y + getSeatSize(entry.seat) / 2));
  const rect = obstacle.clearanceRect;
  return !(rowMaxY < rect.y || rowMinY > rect.y + rect.height);
}

function columnOverlapsObstacle(entries: SeatEntry[], obstacle: CorridorObstacle) {
  const colMinX = Math.min(...entries.map((entry) => entry.base.x - getSeatSize(entry.seat) / 2));
  const colMaxX = Math.max(...entries.map((entry) => entry.base.x + getSeatSize(entry.seat) / 2));
  const rect = obstacle.clearanceRect;
  return !(colMaxX < rect.x || colMinX > rect.x + rect.width);
}

function buildSeatEntries(seats: EventSeatDTO[], baseLayout: SeatBaseLayout, axis: 'x' | 'y'): SeatEntry[] {
  return seats.map((seat) => {
    const base = getSeatBasePoint(seat, baseLayout);
    return { seat, base, center: axis === 'x' ? base.x : base.y };
  });
}

function assignSeatStacks(entries: SeatEntry[], splitCenters: number[]) {
  const stacks: SeatEntry[][] = Array.from({ length: splitCenters.length + 1 }, () => []);

  for (const entry of entries) {
    let stackIndex = splitCenters.length;
    for (let index = 0; index < splitCenters.length; index += 1) {
      if (entry.center < splitCenters[index]!) {
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

function getObstacleClearanceSize(obstacle: CorridorObstacle, axis: 'x' | 'y') {
  return axis === 'x' ? obstacle.clearanceRect.width : obstacle.clearanceRect.height;
}

function repositionSeatStacks(stacks: SeatEntry[][], obstacles: CorridorObstacle[], axis: 'x' | 'y') {
  let cursor: number | null = null;

  for (let index = 0; index < stacks.length; index += 1) {
    const stack = stacks[index]!;
    const obstacle = obstacles[index];

    if (stack.length === 0) {
      if (cursor != null && obstacle) {
        cursor += getObstacleClearanceSize(obstacle, axis);
      }
      continue;
    }

    const stackStart = Math.min(...stack.map((entry) => getSeatBaseEdge(entry, axis, 'start')));

    if (cursor == null) {
      cursor = stackStart;
    }

    const delta = cursor - stackStart;
    for (const entry of stack) {
      if (axis === 'x') {
        entry.seat.x = entry.base.x + delta;
      } else {
        entry.seat.y = entry.base.y + delta;
      }
    }

    if (obstacle) {
      const movedEnd = Math.max(...stack.map((entry) => getSeatAxisEdge(entry.seat, axis, 'end')));
      cursor = movedEnd + getObstacleClearanceSize(obstacle, axis);
    }
  }
}

function applyAxisObstaclesToSeatLines(
  seatLines: EventSeatDTO[][],
  baseLayout: SeatBaseLayout,
  obstacles: CorridorObstacle[],
  axis: 'x' | 'y',
) {
  if (obstacles.length === 0) return;

  const overlaps = axis === 'x' ? rowOverlapsObstacle : columnOverlapsObstacle;

  for (const lineSeats of seatLines) {
    const entries = buildSeatEntries(lineSeats, baseLayout, axis);
    const activeObstacles = obstacles.filter((obstacle) => overlaps(entries, obstacle));
    if (activeObstacles.length === 0) continue;

    const stacks = assignSeatStacks(
      entries,
      activeObstacles.map((obstacle) => obstacle.splitCenter),
    );
    repositionSeatStacks(stacks, activeObstacles, axis);
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

function applyCorridorCoreGeometry({
  corridor,
  axis,
  gapStart,
  gapEnd,
  crossSpan,
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

  const crossSize = crossSpan.max - crossSpan.min;
  if (crossSize <= 0.001) return;

  if (axis === 'x') {
    corridor.x = gapStart + spacing.left;
    corridor.y = crossSpan.min;
    corridor.width = Math.min(thickness, Math.max(1, availableGap - spacing.left - spacing.right));
    corridor.height = crossSize;
  } else {
    corridor.x = crossSpan.min;
    corridor.y = gapStart + spacing.top;
    corridor.width = crossSize;
    corridor.height = Math.min(thickness, Math.max(1, availableGap - spacing.top - spacing.bottom));
  }

  corridor.rotation = 0;
  corridor.data = {
    ...corridor.data,
    [SMART_CORRIDOR_KIND_KEY]: true,
    [CORRIDOR_THICKNESS_KEY]: axis === 'x' ? corridor.width : corridor.height,
    [CORRIDOR_AXIS_KEY]: axis === 'x' ? 'vertical' : 'horizontal',
    [CORRIDOR_AUTO_FIT_KEY]: true,
  };
}

function syncCorridorCoresToOpenedGaps(
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
  obstacles: CorridorObstacle[],
  corridorById: Map<string, EventMapObjectDTO>,
  axis: 'x' | 'y',
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
      const stacks = assignSeatStacks(entries, [obstacle.splitCenter]);
      const leftStack = stacks[0] ?? [];
      const rightStack = stacks[1] ?? [];

      if (leftStack.length === 0 || rightStack.length === 0) continue;

      gapStart = Math.max(
        gapStart,
        ...leftStack.map((entry) => getSeatAxisEdge(entry.seat, axis, 'end')),
      );
      gapEnd = Math.min(
        gapEnd,
        ...rightStack.map((entry) => getSeatAxisEdge(entry.seat, axis, 'start')),
      );

      const span = getCrossAxisSpan([...leftStack, ...rightStack], axis);
      if (span) {
        crossMins.push(span.min);
        crossMaxs.push(span.max);
      }
    }

    if (!Number.isFinite(gapStart) || !Number.isFinite(gapEnd) || gapEnd <= gapStart) continue;
    if (crossMins.length === 0 || crossMaxs.length === 0) continue;

    const corridor = corridorById.get(obstacle.objectIds[0]!);
    if (!corridor) continue;

    applyCorridorCoreGeometry({
      corridor,
      axis,
      gapStart,
      gapEnd,
      crossSpan: { min: Math.min(...crossMins), max: Math.max(...crossMaxs) },
      spacing: obstacle.spacing,
      thickness: obstacle.thickness,
    });

    for (const objectId of obstacle.objectIds.slice(1)) {
      const extra = corridorById.get(objectId);
      if (!extra) continue;
      applyCorridorCoreGeometry({
        corridor: extra,
        axis,
        gapStart,
        gapEnd,
        crossSpan: { min: Math.min(...crossMins), max: Math.max(...crossMaxs) },
        spacing: obstacle.spacing,
        thickness: obstacle.thickness,
      });
    }
  }
}

function applySmartCorridorStackReflow(
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
  obstacles: { vertical: CorridorObstacle[]; horizontal: CorridorObstacle[] },
  corridorById: Map<string, EventMapObjectDTO>,
) {
  for (const seat of sectionSeats) {
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
    seat.x = base.x;
    seat.y = base.y;
  }

  applyAxisObstaclesToSeatLines(groupSeatsByRow(sectionSeats, baseLayout), baseLayout, obstacles.vertical, 'x');
  applyAxisObstaclesToSeatLines(groupSeatsByColumn(sectionSeats, baseLayout), baseLayout, obstacles.horizontal, 'y');

  syncCorridorCoresToOpenedGaps(sectionSeats, baseLayout, obstacles.vertical, corridorById, 'x');
  syncCorridorCoresToOpenedGaps(sectionSeats, baseLayout, obstacles.horizontal, corridorById, 'y');
}

export function applyCorridorReflow(map: EventMapDTO) {
  const corridors = map.objects.filter(isCorridor);
  const corridorById = new Map(corridors.map((corridor) => [corridor.id, corridor]));
  const affectedSectionIds = collectAffectedSectionIds(map, corridors);
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

    const sectionCorridors = corridors.filter((corridor) => {
      if (corridor.levelId !== sectionObject.levelId) return false;
      return corridorAffectsSection({ corridor, sectionSeats, baseLayout, baseBounds });
    });

    if (sectionCorridors.length > 0) {
      const obstacles = buildCorridorObstacles(sectionCorridors, sectionSeats, baseLayout);
      applySmartCorridorStackReflow(sectionSeats, baseLayout, obstacles, corridorById);
      writeSeatBaseLayout(sectionObject, baseLayout);
      writeSectionBaseBounds(sectionObject, baseBounds);
      resizeSectionToSeats(sectionObject, sectionSeats, baseBounds);
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
  expandRectWithSpacing,
  getCorridorSpacing,
  inferSmartCorridorAxisFromCoreRect,
  readCorridorThickness,
  resolveSmartCorridorLayout,
};
