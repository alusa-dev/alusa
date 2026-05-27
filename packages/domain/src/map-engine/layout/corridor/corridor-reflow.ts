import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../../types/event-map-types.js';
import {
  clampNumber,
  CORRIDOR_AXIS_KEY,
  CORRIDOR_SPLIT_X_KEY,
  CORRIDOR_SPLIT_Y_KEY,
  MIN_CORRIDOR_THICKNESS,
  readStoredCorridorAxis,
  reconcileCorridorGeometry,
  resolveSmartCorridorLayout,
  type CorridorSpacing,
} from '../smart-corridor-layout.js';
import { buildCorridorUnionGroupLookup, getCorridorUnionGroups } from '../corridor-union.js';
import { getSeatBounds, intersectsRect, type BoundsRect } from '../../geometry/bounds.js';
import { toGlobal, toLocal } from '../../geometry/rotation.js';
import {
  corridorAffectsSection,
  collectAffectedSectionIds,
  isSectionObject,
  mapCorridorToSectionLocal,
  readSeatBaseLayout,
  readSectionBaseBounds,
  resizeSectionToSeats,
  SEAT_BASE_LAYOUT_KEY,
  SECTION_BASE_BOUNDS_KEY,
  getSeatBasePoint,
  getSeatAxisEdge,
  getSeatSize,
  type SeatBaseLayout,
  type SectionBaseBounds,
  writeSeatBaseLayout,
  writeSectionBaseBounds,
} from './corridor-section-base.js';
import {
  ensureCorridorSplitAnchors,
  getCorridorSplitCenter,
  persistSmartCorridorMetadata,
} from './corridor-split-anchors.js';

export const CORRIDOR_REFLOW_ITERATIONS = 25;
export const CORRIDOR_DRAG_PREVIEW_ITERATIONS = CORRIDOR_REFLOW_ITERATIONS;
export const CORRIDOR_DRAG_COMMIT_ITERATIONS = CORRIDOR_REFLOW_ITERATIONS;
const CLEARANCE_SAFETY_GAP = 0.25;

export type CorridorReflowOptions = {
  maxIterations?: number;
  activeCorridorIds?: string[];
  /** Corridors that must keep x/y during auto-fit (e.g. rotation-only transform). */
  freezeAutoFitCorridorIds?: string[];
};

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

function isCorridor(object: EventMapObjectDTO) {
  return object.type === 'CORRIDOR' && !object.hidden;
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

function buildCorridorObstacles(
  corridors: EventMapObjectDTO[],
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
        d_min = obsEnd + CLEARANCE_SAFETY_GAP - data.starts[i];
      }

      if (i < numActive) {
        const obs = data.active[i]!;
        const obsStart = axis === 'x' ? obs.clearanceRect.x : obs.clearanceRect.y;
        d_max = obsStart - CLEARANCE_SAFETY_GAP - data.ends[i];
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
      ? spacing.left + CLEARANCE_SAFETY_GAP + normalizedPartitionSize + spacing.right + CLEARANCE_SAFETY_GAP
      : spacing.top + CLEARANCE_SAFETY_GAP + normalizedPartitionSize + spacing.bottom + CLEARANCE_SAFETY_GAP;

  const nextData: Record<string, unknown> = { ...corridor.data };
  delete nextData.corridorLayoutWarning;

  if (availableGap + 0.001 < requiredGap) {
    nextData.corridorLayoutWarning = 'INSUFFICIENT_GAP';
  }

  if (axis === 'x') {
    if (availableGap < requiredGap) {
      corridor.x = gapStart + (availableGap - normalizedPartitionSize) / 2;
    } else {
      const minX = Number.isFinite(gapStart) ? gapStart + spacing.left + CLEARANCE_SAFETY_GAP : -Infinity;
      const maxX = Number.isFinite(gapEnd)
        ? gapEnd - spacing.right - CLEARANCE_SAFETY_GAP - normalizedPartitionSize
        : Infinity;
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
    const minY = Number.isFinite(gapStart) ? gapStart + spacing.top + CLEARANCE_SAFETY_GAP : -Infinity;
    const maxY = Number.isFinite(gapEnd)
      ? gapEnd - spacing.bottom - CLEARANCE_SAFETY_GAP - normalizedPartitionSize
      : Infinity;
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
        const localObstacles = buildCorridorObstacles(localCorridors);
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
