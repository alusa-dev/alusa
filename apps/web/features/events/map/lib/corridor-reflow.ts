import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../api/event-map-service';
import { getCorridorBounds, getCorridorUnionGroups, type CorridorUnionGroup } from './corridor-union';
import { getObjectBounds, getSeatBounds, intersectsRect, type BoundsRect } from './selection-utils';

const SEAT_BASE_LAYOUT_KEY = 'seatBaseLayout';
const SECTION_BASE_BOUNDS_KEY = 'sectionBaseBounds';
const CORRIDOR_REFLOW_PADDING = 8;
const SECTION_REFLOW_PADDING = 24;
const CORRIDOR_GAP_DEFAULT = 8;
const DEFAULT_SEAT_SIZE = 24;
const CORRIDOR_SPLIT_X_KEY = 'corridorSplitX';
const CORRIDOR_SPLIT_Y_KEY = 'corridorSplitY';
const CORRIDOR_AXIS_KEY = 'corridorAxis';
const CORRIDOR_AUTO_FIT_KEY = 'corridorAutoFit';
const CORRIDOR_CORE_WIDTH_KEY = 'corridorCoreWidth';
const CORRIDOR_CORE_HEIGHT_KEY = 'corridorCoreHeight';

export type CorridorAxis = 'vertical' | 'horizontal';

type SeatBaseLayout = Record<string, { x: number; y: number }>;
type SectionBaseBounds = { x: number; y: number; width: number; height: number };
type CorridorSpacing = { left: number; right: number; top: number; bottom: number };

type SeatEntry = {
  seat: EventSeatDTO;
  base: { x: number; y: number };
  center: number;
};

type CorridorObstacle = {
  group: CorridorUnionGroup;
  bodyRect: BoundsRect;
  clearance: number;
  axis: 'x' | 'y';
  splitCenter: number;
};

function isCorridor(object: EventMapObjectDTO) {
  return object.type === 'CORRIDOR' && !object.hidden;
}

export function inferCorridorAxisFromSize(width: number, height: number): CorridorAxis {
  return width > height ? 'horizontal' : 'vertical';
}

export function resolveCorridorAxis(corridor: EventMapObjectDTO): CorridorAxis {
  const stored = corridor.data[CORRIDOR_AXIS_KEY];
  if (stored === 'vertical' || stored === 'horizontal') return stored;
  return inferCorridorAxisFromSize(
    corridor.width ?? getCorridorBounds(corridor).width,
    corridor.height ?? getCorridorBounds(corridor).height,
  );
}

export function isCorridorAutoFit(corridor: EventMapObjectDTO) {
  return corridor.data[CORRIDOR_AUTO_FIT_KEY] !== false;
}

function persistCorridorMetadata(corridor: EventMapObjectDTO) {
  const axis = resolveCorridorAxis(corridor);
  const bounds = getCorridorBounds(corridor);
  const nextData: Record<string, unknown> = {
    ...corridor.data,
    [CORRIDOR_AXIS_KEY]: axis,
    [CORRIDOR_AUTO_FIT_KEY]: isCorridorAutoFit(corridor),
  };

  if (!Number.isFinite(Number(nextData[CORRIDOR_CORE_WIDTH_KEY]))) {
    nextData[CORRIDOR_CORE_WIDTH_KEY] = corridor.width ?? bounds.width;
  }
  if (!Number.isFinite(Number(nextData[CORRIDOR_CORE_HEIGHT_KEY]))) {
    nextData[CORRIDOR_CORE_HEIGHT_KEY] = corridor.height ?? bounds.height;
  }

  corridor.data = nextData;
}

function getCorridorCoreThickness(corridor: EventMapObjectDTO, axis: 'x' | 'y') {
  const key = axis === 'x' ? CORRIDOR_CORE_WIDTH_KEY : CORRIDOR_CORE_HEIGHT_KEY;
  const stored = Number(corridor.data[key]);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return axis === 'x' ? (corridor.width ?? 32) : (corridor.height ?? 32);
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

function getCorridorSpacing(corridor: EventMapObjectDTO): CorridorSpacing {
  const read = (key: string) => {
    const value = Number(corridor.data[key]);
    return Number.isFinite(value) ? Math.max(0, value) : CORRIDOR_GAP_DEFAULT;
  };

  return {
    left: read('seatGapLeft'),
    right: read('seatGapRight'),
    top: read('seatGapTop'),
    bottom: read('seatGapBottom'),
  };
}

function getSpacedCorridorBounds(bounds: BoundsRect, spacing: CorridorSpacing): BoundsRect {
  return {
    x: bounds.x - spacing.left,
    y: bounds.y - spacing.top,
    width: bounds.width + spacing.left + spacing.right,
    height: bounds.height + spacing.top + spacing.bottom,
  };
}

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

function getDefaultCorridorSpacing(): CorridorSpacing {
  return {
    left: CORRIDOR_REFLOW_PADDING,
    right: CORRIDOR_REFLOW_PADDING,
    top: CORRIDOR_REFLOW_PADDING,
    bottom: CORRIDOR_REFLOW_PADDING,
  };
}

function getGroupBodyBounds(group: CorridorUnionGroup): BoundsRect {
  return unionRects(group.members.map((member) => member.rect));
}

function getMemberClearance(
  memberRect: BoundsRect,
  spacing: CorridorSpacing,
  axis: 'x' | 'y',
  corridor?: EventMapObjectDTO,
) {
  const body =
    corridor && isCorridorAutoFit(corridor)
      ? getCorridorCoreThickness(corridor, axis)
      : axis === 'x'
        ? memberRect.width
        : memberRect.height;

  if (axis === 'x') {
    return body + spacing.left + spacing.right;
  }
  return body + spacing.top + spacing.bottom;
}

function getGroupClearance(group: CorridorUnionGroup, corridorById: Map<string, EventMapObjectDTO>, axis: 'x' | 'y') {
  return group.members.reduce((maxClearance, member) => {
    const corridor = corridorById.get(member.objectId);
    const spacing = corridor ? getCorridorSpacing(corridor) : getDefaultCorridorSpacing();
    return Math.max(maxClearance, getMemberClearance(member.rect, spacing, axis, corridor));
  }, 0);
}

function getObstacleSpacedRect(obstacle: CorridorObstacle): BoundsRect {
  if (obstacle.axis === 'x') {
    return {
      x: obstacle.splitCenter - obstacle.clearance / 2,
      y: obstacle.bodyRect.y,
      width: obstacle.clearance,
      height: obstacle.bodyRect.height,
    };
  }

  return {
    x: obstacle.bodyRect.x,
    y: obstacle.splitCenter - obstacle.clearance / 2,
    width: obstacle.bodyRect.width,
    height: obstacle.clearance,
  };
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

  const x = Math.min(baseBounds.x, seatBounds.minX - SECTION_REFLOW_PADDING);
  const y = Math.min(baseBounds.y, seatBounds.minY - SECTION_REFLOW_PADDING);
  const maxX = Math.max(baseBounds.x + baseBounds.width, seatBounds.maxX + SECTION_REFLOW_PADDING);
  const maxY = Math.max(baseBounds.y + baseBounds.height, seatBounds.maxY + SECTION_REFLOW_PADDING);

  sectionObject.x = x;
  sectionObject.y = y;
  sectionObject.width = maxX - x;
  sectionObject.height = maxY - y;
}

function collectAffectedSectionIds(map: EventMapDTO, corridors: EventMapObjectDTO[]) {
  const affected = new Set<string>();
  const sectionObjects = map.objects.filter(isSectionObject);

  for (const corridor of corridors) {
    const corridorBounds = getSpacedCorridorBounds(getCorridorBounds(corridor), getCorridorSpacing(corridor));

    for (const sectionObject of sectionObjects) {
      if (sectionObject.levelId !== corridor.levelId || !sectionObject.sectionId) continue;

      if (intersectsRect(getObjectBounds(sectionObject), corridorBounds)) {
        affected.add(sectionObject.sectionId);
        continue;
      }

      const sectionSeats = map.seats.filter((seat) => seat.sectionId === sectionObject.sectionId);
      if (sectionSeats.some((seat) => intersectsRect(getSeatBounds(seat), corridorBounds))) {
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

function unionGroupAffectsSection({
  group,
  corridorById,
  sectionObject,
  sectionSeats,
  baseLayout,
  baseBounds,
}: {
  group: CorridorUnionGroup;
  corridorById: Map<string, EventMapObjectDTO>;
  sectionObject: EventMapObjectDTO;
  sectionSeats: EventSeatDTO[];
  baseLayout: SeatBaseLayout;
  baseBounds: SectionBaseBounds;
}) {
  const spacedBounds = unionRects(
    group.members.map((member) => {
      const corridor = corridorById.get(member.objectId);
      const spacing = corridor ? getCorridorSpacing(corridor) : getDefaultCorridorSpacing();
      let bounds = member.rect;

      if (corridor) {
        const axis = resolveCorridorAxis(corridor);
        const expanded = expandObstacleBodyForSection(
          {
            group,
            bodyRect: bounds,
            clearance: 0,
            axis: axis === 'vertical' ? 'x' : 'y',
            splitCenter: 0,
          },
          sectionSeats,
          baseLayout,
        );
        bounds = expanded;
      }

      return getSpacedCorridorBounds(bounds, spacing);
    }),
  );

  if (intersectsRect(baseBounds, spacedBounds)) {
    return true;
  }

  return sectionSeats.some((seat) => {
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
    const seatBounds = getSeatBounds({ ...seat, x: base.x, y: base.y });
    return intersectsRect(seatBounds, spacedBounds);
  });
}

function getCorridorSplitCenter(corridor: EventMapObjectDTO, memberRect: BoundsRect, axis: 'x' | 'y') {
  const key = axis === 'x' ? CORRIDOR_SPLIT_X_KEY : CORRIDOR_SPLIT_Y_KEY;
  const stored = Number(corridor.data[key]);
  if (Number.isFinite(stored)) return stored;
  return axis === 'x' ? memberRect.x + memberRect.width / 2 : memberRect.y + memberRect.height / 2;
}

function ensureCorridorSplitAnchors(group: CorridorUnionGroup, corridorById: Map<string, EventMapObjectDTO>) {
  for (const member of group.members) {
    const corridor = corridorById.get(member.objectId);
    if (!corridor) continue;

    persistCorridorMetadata(corridor);
    const nextData = { ...corridor.data };
    if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_X_KEY]))) {
      nextData[CORRIDOR_SPLIT_X_KEY] = member.rect.x + member.rect.width / 2;
    }
    if (!Number.isFinite(Number(nextData[CORRIDOR_SPLIT_Y_KEY]))) {
      nextData[CORRIDOR_SPLIT_Y_KEY] = member.rect.y + member.rect.height / 2;
    }
    corridor.data = nextData;
  }
}

function getGroupSplitCenter(group: CorridorUnionGroup, corridorById: Map<string, EventMapObjectDTO>, axis: 'x' | 'y') {
  const centers = group.members.map((member) => {
    const corridor = corridorById.get(member.objectId);
    if (!corridor) {
      return axis === 'x' ? member.rect.x + member.rect.width / 2 : member.rect.y + member.rect.height / 2;
    }
    return getCorridorSplitCenter(corridor, member.rect, axis);
  });

  centers.sort((left, right) => left - right);
  return centers[Math.floor(centers.length / 2)]!;
}

export function persistCorridorMetadataOnly(corridor: EventMapObjectDTO) {
  persistCorridorMetadata(corridor);
}

export function updateCorridorSplitAnchors(corridor: EventMapObjectDTO) {
  const bounds = getCorridorBounds(corridor);
  persistCorridorMetadata(corridor);
  corridor.data = {
    ...corridor.data,
    [CORRIDOR_SPLIT_X_KEY]: bounds.x + bounds.width / 2,
    [CORRIDOR_SPLIT_Y_KEY]: bounds.y + bounds.height / 2,
  };
}

export function updateCorridorSplitAnchorsOnDrag(
  corridor: EventMapObjectDTO,
  patch: Partial<EventMapObjectDTO>,
  previous?: EventMapObjectDTO,
) {
  const axis = resolveCorridorAxis(corridor);
  const bounds = getCorridorBounds(corridor);
  const nextData = { ...corridor.data, [CORRIDOR_AXIS_KEY]: axis };

  const resizedOrRotated =
    typeof patch.width === 'number' ||
    typeof patch.height === 'number' ||
    typeof patch.rotation === 'number';

  if (resizedOrRotated) {
    nextData[CORRIDOR_SPLIT_X_KEY] = bounds.x + bounds.width / 2;
    nextData[CORRIDOR_SPLIT_Y_KEY] = bounds.y + bounds.height / 2;
    if (typeof patch.width === 'number') {
      nextData[CORRIDOR_CORE_WIDTH_KEY] = patch.width;
    }
    if (typeof patch.height === 'number') {
      nextData[CORRIDOR_CORE_HEIGHT_KEY] = patch.height;
    }
  } else if (axis === 'vertical' && typeof patch.x === 'number') {
    const previousSplit = Number(previous?.data[CORRIDOR_SPLIT_X_KEY]);
    if (previous && Number.isFinite(previousSplit)) {
      nextData[CORRIDOR_SPLIT_X_KEY] = previousSplit + (patch.x - previous.x);
    } else {
      nextData[CORRIDOR_SPLIT_X_KEY] = bounds.x + bounds.width / 2;
    }
  } else if (axis === 'horizontal' && typeof patch.y === 'number') {
    const previousSplit = Number(previous?.data[CORRIDOR_SPLIT_Y_KEY]);
    if (previous && Number.isFinite(previousSplit)) {
      nextData[CORRIDOR_SPLIT_Y_KEY] = previousSplit + (patch.y - previous.y);
    } else {
      nextData[CORRIDOR_SPLIT_Y_KEY] = bounds.y + bounds.height / 2;
    }
  }

  corridor.data = nextData;
}

function resolveGroupAxis(group: CorridorUnionGroup, corridorById: Map<string, EventMapObjectDTO>): CorridorAxis {
  let dominant: { axis: CorridorAxis; area: number } | null = null;

  for (const member of group.members) {
    const corridor = corridorById.get(member.objectId);
    if (corridor) persistCorridorMetadata(corridor);
    const axis = corridor ? resolveCorridorAxis(corridor) : inferCorridorAxisFromSize(member.rect.width, member.rect.height);
    const area = member.rect.width * member.rect.height;
    if (!dominant || area > dominant.area) dominant = { axis, area };
  }

  return dominant?.axis ?? 'vertical';
}

function expandObstacleBodyForSection(
  obstacle: CorridorObstacle,
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
): BoundsRect {
  if (sectionSeats.length === 0) return obstacle.bodyRect;

  if (obstacle.axis === 'x') {
    const rows = groupSeatsByRow(sectionSeats, baseLayout);
    const minY = Math.min(
      ...rows.flatMap((lineSeats) => lineSeats.map((seat) => (baseLayout[seat.id] ?? { x: seat.x, y: seat.y }).y)),
    );
    const maxY = Math.max(
      ...rows.flatMap((lineSeats) =>
        lineSeats.map((seat) => (baseLayout[seat.id] ?? { x: seat.x, y: seat.y }).y + (seat.size ?? DEFAULT_SEAT_SIZE)),
      ),
    );

    return {
      ...obstacle.bodyRect,
      y: minY,
      height: maxY - minY,
    };
  }

  const columns = groupSeatsByColumn(sectionSeats, baseLayout);
  const minX = Math.min(
    ...columns.flatMap((lineSeats) => lineSeats.map((seat) => (baseLayout[seat.id] ?? { x: seat.x, y: seat.y }).x)),
  );
  const maxX = Math.max(
    ...columns.flatMap((lineSeats) =>
      lineSeats.map((seat) => (baseLayout[seat.id] ?? { x: seat.x, y: seat.y }).x + (seat.size ?? DEFAULT_SEAT_SIZE)),
    ),
  );

  return {
    ...obstacle.bodyRect,
    x: minX,
    width: maxX - minX,
  };
}

function normalizeGroupSplitCenters(group: CorridorUnionGroup, corridorById: Map<string, EventMapObjectDTO>, axis: 'x' | 'y') {
  const splitCenter = getGroupSplitCenter(group, corridorById, axis);
  const key = axis === 'x' ? CORRIDOR_SPLIT_X_KEY : CORRIDOR_SPLIT_Y_KEY;

  for (const member of group.members) {
    const corridor = corridorById.get(member.objectId);
    if (!corridor) continue;
    corridor.data = { ...corridor.data, [key]: splitCenter };
  }
}

function buildCorridorObstacles(
  groups: CorridorUnionGroup[],
  corridorById: Map<string, EventMapObjectDTO>,
): { vertical: CorridorObstacle[]; horizontal: CorridorObstacle[] } {
  const vertical: CorridorObstacle[] = [];
  const horizontal: CorridorObstacle[] = [];

  for (const group of groups) {
    ensureCorridorSplitAnchors(group, corridorById);
    const corridorAxis = resolveGroupAxis(group, corridorById);
    const isVertical = corridorAxis === 'vertical';
    const axis = isVertical ? 'x' : 'y';
    normalizeGroupSplitCenters(group, corridorById, axis);
    const bodyRect = getGroupBodyBounds(group);
    const obstacle: CorridorObstacle = {
      group,
      bodyRect,
      clearance: getGroupClearance(group, corridorById, axis),
      axis,
      splitCenter: getGroupSplitCenter(group, corridorById, axis),
    };

    if (isVertical) vertical.push(obstacle);
    else horizontal.push(obstacle);
  }

  vertical.sort((a, b) => a.splitCenter - b.splitCenter);
  horizontal.sort((a, b) => a.splitCenter - b.splitCenter);

  return {
    vertical: dedupeObstaclesBySplitCenter(vertical),
    horizontal: dedupeObstaclesBySplitCenter(horizontal),
  };
}

function mergeCorridorUnionGroups(left: CorridorUnionGroup, right: CorridorUnionGroup): CorridorUnionGroup {
  const members = [...left.members, ...right.members];
  const rects = members.map((member) => member.rect);

  return {
    id: [...left.objectIds, ...right.objectIds].sort().join(':'),
    objectIds: [...left.objectIds, ...right.objectIds],
    members,
    rects,
    bounds: unionRects(rects),
    segments: [...left.segments, ...right.segments],
  };
}

function dedupeObstaclesBySplitCenter(obstacles: CorridorObstacle[]) {
  const merged: CorridorObstacle[] = [];

  for (const obstacle of obstacles) {
    const existing = merged.find(
      (entry) => entry.axis === obstacle.axis && Math.abs(entry.splitCenter - obstacle.splitCenter) < 2,
    );

    if (!existing) {
      merged.push(obstacle);
      continue;
    }

    existing.group = mergeCorridorUnionGroups(existing.group, obstacle.group);
    existing.bodyRect = unionRects([existing.bodyRect, obstacle.bodyRect]);
    existing.clearance = Math.max(existing.clearance, obstacle.clearance);
    existing.splitCenter = (existing.splitCenter + obstacle.splitCenter) / 2;
  }

  return merged;
}

function groupSeatsByRow(seats: EventSeatDTO[], baseLayout: SeatBaseLayout) {
  const groups = new Map<string, EventSeatDTO[]>();

  for (const seat of seats) {
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
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
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
    const key = seat.seatNumber?.trim() ? seat.seatNumber : `x:${Math.round(base.x)}`;
    const current = groups.get(key) ?? [];
    current.push(seat);
    groups.set(key, current);
  }

  return [...groups.values()];
}

function rowOverlapsObstacle(entries: SeatEntry[], obstacle: CorridorObstacle) {
  const rowMinY = Math.min(...entries.map((entry) => entry.base.y));
  const rowMaxY = Math.max(...entries.map((entry) => entry.base.y + (entry.seat.size ?? DEFAULT_SEAT_SIZE)));
  const spacedRect = getObstacleSpacedRect(obstacle);

  return !(rowMaxY < spacedRect.y || rowMinY > spacedRect.y + spacedRect.height);
}

function columnOverlapsObstacle(entries: SeatEntry[], obstacle: CorridorObstacle) {
  const colMinX = Math.min(...entries.map((entry) => entry.base.x));
  const colMaxX = Math.max(...entries.map((entry) => entry.base.x + (entry.seat.size ?? DEFAULT_SEAT_SIZE)));
  const spacedRect = getObstacleSpacedRect(obstacle);

  return !(colMaxX < spacedRect.x || colMinX > spacedRect.x + spacedRect.width);
}

function buildSeatEntries(seats: EventSeatDTO[], baseLayout: SeatBaseLayout, axis: 'x' | 'y'): SeatEntry[] {
  return seats.map((seat) => {
    const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
    const size = seat.size ?? DEFAULT_SEAT_SIZE;
    const center = axis === 'x' ? base.x + size / 2 : base.y + size / 2;
    return { seat, base, center };
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

function getSeatEdge(seat: EventSeatDTO, axis: 'x' | 'y', edge: 'start' | 'end') {
  const size = seat.size ?? DEFAULT_SEAT_SIZE;
  if (axis === 'x') {
    return edge === 'start' ? seat.x : seat.x + size;
  }
  return edge === 'start' ? seat.y : seat.y + size;
}

function repositionSeatStacks(stacks: SeatEntry[][], obstacles: CorridorObstacle[], axis: 'x' | 'y') {
  let cursor: number | null = null;

  for (let index = 0; index < stacks.length; index += 1) {
    const stack = stacks[index]!;
    const obstacle = obstacles[index];

    if (stack.length === 0) {
      if (cursor != null && obstacle) {
        cursor += obstacle.clearance;
      }
      continue;
    }

    const minBase = Math.min(...stack.map((entry) => (axis === 'x' ? entry.base.x : entry.base.y)));
    if (cursor == null) cursor = minBase;

    const delta = cursor - minBase;
    for (const entry of stack) {
      if (axis === 'x') {
        entry.seat.x = entry.base.x + delta;
      } else {
        entry.seat.y = entry.base.y + delta;
      }
    }

    if (obstacle) {
      const maxEdge = Math.max(...stack.map((entry) => getSeatEdge(entry.seat, axis, 'end')));
      cursor = maxEdge + obstacle.clearance;
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

    const activeSplitCenters = activeObstacles.map((obstacle) => obstacle.splitCenter);
    const stacks = assignSeatStacks(entries, activeSplitCenters);
    repositionSeatStacks(stacks, activeObstacles, axis);
  }
}

function getCrossAxisSpan(entries: SeatEntry[], partitionAxis: 'x' | 'y') {
  if (entries.length === 0) return null;

  if (partitionAxis === 'x') {
    return {
      min: Math.min(...entries.map((entry) => entry.seat.y)),
      max: Math.max(...entries.map((entry) => entry.seat.y + (entry.seat.size ?? DEFAULT_SEAT_SIZE))),
    };
  }

  return {
    min: Math.min(...entries.map((entry) => entry.seat.x)),
    max: Math.max(...entries.map((entry) => entry.seat.x + (entry.seat.size ?? DEFAULT_SEAT_SIZE))),
  };
}

function applyCorridorGeometry({
  corridor,
  axis,
  gapStart,
  gapEnd,
  crossSpan,
}: {
  corridor: EventMapObjectDTO;
  axis: 'x' | 'y';
  gapStart: number;
  gapEnd: number;
  crossSpan: { min: number; max: number };
}) {
  const availableGap = gapEnd - gapStart;
  if (availableGap <= 0.001) return;

  const crossSize = crossSpan.max - crossSpan.min;
  const rotation = Number(corridor.rotation ?? 0);

  if (Math.abs(rotation % 360) > 0.001) {
    const bodyWidth = corridor.width ?? availableGap;
    const bodyHeight = corridor.height ?? crossSize;
    if (axis === 'x') {
      corridor.x = gapStart + Math.max(0, (availableGap - bodyWidth) / 2);
      corridor.y = crossSpan.min + Math.max(0, (crossSize - bodyHeight) / 2);
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_X_KEY]: gapStart + availableGap / 2,
      };
    } else {
      corridor.y = gapStart + Math.max(0, (availableGap - bodyHeight) / 2);
      corridor.x = crossSpan.min + Math.max(0, (crossSize - bodyWidth) / 2);
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_Y_KEY]: gapStart + availableGap / 2,
      };
    }
    persistCorridorMetadata(corridor);
    return;
  }

  if (isCorridorAutoFit(corridor)) {
    if (axis === 'x') {
      corridor.x = gapStart;
      corridor.y = crossSpan.min;
      corridor.width = availableGap;
      corridor.height = crossSize;
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_X_KEY]: gapStart + availableGap / 2,
      };
    } else {
      corridor.x = crossSpan.min;
      corridor.y = gapStart;
      corridor.width = crossSize;
      corridor.height = availableGap;
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_Y_KEY]: gapStart + availableGap / 2,
      };
    }
  } else {
    const bodyWidth = corridor.width ?? availableGap;
    const bodyHeight = corridor.height ?? crossSize;
    if (axis === 'x') {
      corridor.x = gapStart + Math.max(0, (availableGap - bodyWidth) / 2);
      corridor.y = crossSpan.min + Math.max(0, (crossSize - bodyHeight) / 2);
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_X_KEY]: gapStart + availableGap / 2,
      };
    } else {
      corridor.y = gapStart + Math.max(0, (availableGap - bodyHeight) / 2);
      corridor.x = crossSpan.min + Math.max(0, (crossSize - bodyWidth) / 2);
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_Y_KEY]: gapStart + availableGap / 2,
      };
    }
  }

  persistCorridorMetadata(corridor);
}

function syncCorridorObjectsToOpenedGaps(
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
  obstacles: CorridorObstacle[],
  corridorById: Map<string, EventMapObjectDTO>,
  axis: 'x' | 'y',
) {
  if (obstacles.length === 0 || sectionSeats.length === 0) return;

  const seatLines = axis === 'x' ? groupSeatsByRow(sectionSeats, baseLayout) : groupSeatsByColumn(sectionSeats, baseLayout);
  const overlaps = axis === 'x' ? rowOverlapsObstacle : columnOverlapsObstacle;
  const referenceLine = seatLines.find((lineSeats) => {
    const entries = buildSeatEntries(lineSeats, baseLayout, axis);
    return entries.length > 0 && obstacles.some((obstacle) => overlaps(entries, obstacle));
  });

  if (!referenceLine) return;

  const baseEntries = buildSeatEntries(referenceLine, baseLayout, axis);
  const activeObstacles = obstacles.filter((obstacle) => overlaps(baseEntries, obstacle));
  const stacks = assignSeatStacks(
    baseEntries,
    activeObstacles.map((obstacle) => obstacle.splitCenter),
  );
  const sectionCrossSpan = getCrossAxisSpan(
    sectionSeats.map((seat) => {
      const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
      return { seat, base, center: 0 };
    }),
    axis,
  );

  for (let index = 0; index < activeObstacles.length; index += 1) {
    const leftStack = stacks[index]!;
    const rightStack = stacks[index + 1]!;
    const obstacle = activeObstacles[index]!;
    if (leftStack.length === 0 || rightStack.length === 0) continue;

    const gapStart = Math.max(...leftStack.map((entry) => getSeatEdge(entry.seat, axis, 'end')));
    const gapEnd = Math.min(...rightStack.map((entry) => getSeatEdge(entry.seat, axis, 'start')));
    if (gapEnd - gapStart <= 0.001) continue;

    const crossSpan =
      sectionCrossSpan ??
      getCrossAxisSpan([...leftStack, ...rightStack], axis);
    if (!crossSpan) continue;

    for (const member of obstacle.group.members) {
      const corridor = corridorById.get(member.objectId);
      if (!corridor) continue;

      applyCorridorGeometry({
        corridor,
        axis,
        gapStart,
        gapEnd,
        crossSpan,
      });
    }
  }
}

function realignCorridorSplitAnchorsForSection(
  corridors: EventMapObjectDTO[],
  sectionSeats: EventSeatDTO[],
  baseLayout: SeatBaseLayout,
) {
  for (const corridor of corridors) {
    const bounds = getCorridorBounds(corridor);
    const affectsSection = sectionSeats.some((seat) => {
      const base = baseLayout[seat.id] ?? { x: seat.x, y: seat.y };
      return intersectsRect(getSeatBounds({ ...seat, x: base.x, y: base.y }), bounds);
    });
    if (!affectsSection) continue;

    const axis = resolveCorridorAxis(corridor);
    if (axis === 'vertical') {
      const coreWidth = getCorridorCoreThickness(corridor, 'x');
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_X_KEY]: corridor.x + coreWidth / 2,
      };
    } else {
      const coreHeight = getCorridorCoreThickness(corridor, 'y');
      corridor.data = {
        ...corridor.data,
        [CORRIDOR_SPLIT_Y_KEY]: corridor.y + coreHeight / 2,
      };
    }
  }
}

function applyCorridorStackReflow(
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

  const verticalObstacles = obstacles.vertical.map((obstacle) => ({
    ...obstacle,
    bodyRect: expandObstacleBodyForSection(obstacle, sectionSeats, baseLayout),
  }));
  const horizontalObstacles = obstacles.horizontal.map((obstacle) => ({
    ...obstacle,
    bodyRect: expandObstacleBodyForSection(obstacle, sectionSeats, baseLayout),
  }));

  applyAxisObstaclesToSeatLines(groupSeatsByRow(sectionSeats, baseLayout), baseLayout, verticalObstacles, 'x');
  applyAxisObstaclesToSeatLines(groupSeatsByColumn(sectionSeats, baseLayout), baseLayout, horizontalObstacles, 'y');

  syncCorridorObjectsToOpenedGaps(sectionSeats, baseLayout, verticalObstacles, corridorById, 'x');
  syncCorridorObjectsToOpenedGaps(sectionSeats, baseLayout, horizontalObstacles, corridorById, 'y');
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

    const sectionCorridorGroups = getCorridorUnionGroups(
      corridors.filter((corridor) => corridor.levelId === sectionObject.levelId),
    ).filter((group) => unionGroupAffectsSection({ group, corridorById, sectionObject, sectionSeats, baseLayout, baseBounds }));

    if (sectionCorridorGroups.length > 0) {
      realignCorridorSplitAnchorsForSection(
        corridors.filter((corridor) => corridor.levelId === sectionObject.levelId),
        sectionSeats,
        baseLayout,
      );
      const obstacles = buildCorridorObstacles(sectionCorridorGroups, corridorById);
      applyCorridorStackReflow(sectionSeats, baseLayout, obstacles, corridorById);
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
