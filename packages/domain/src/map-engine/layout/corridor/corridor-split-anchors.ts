import type { EventMapObjectDTO, EventSeatDTO } from '../../types/event-map-types.js';
import {
  CORRIDOR_AXIS_KEY,
  CORRIDOR_AUTO_FIT_KEY,
  CORRIDOR_CORE_HEIGHT_KEY,
  CORRIDOR_CORE_WIDTH_KEY,
  CORRIDOR_SPLIT_X_KEY,
  CORRIDOR_SPLIT_Y_KEY,
  CORRIDOR_THICKNESS_KEY,
  DEFAULT_CORRIDOR_THICKNESS,
  getSmartCorridorCoreRect,
  inferSmartCorridorAxisFromCoreRect,
  normalizeSmartCorridorObject,
  readCorridorThickness,
  resolveSmartCorridorLayout,
  getCorridorWorldCenter,
  SMART_CORRIDOR_KIND_KEY,
  type SmartCorridorAxis,
} from '../smart-corridor-layout.js';
import type { BoundsRect } from '../../geometry/bounds.js';
import { toGlobal, toLocal } from '../../geometry/rotation.js';
import {
  getSeatBasePoint,
  getSeatSize,
  type SeatBaseLayout,
} from './corridor-section-base.js';

export type CorridorAxis = SmartCorridorAxis;

export function resolveCorridorAxis(corridor: EventMapObjectDTO): CorridorAxis {
  return resolveSmartCorridorLayout(corridor).axis;
}

export function isCorridorAutoFit(_corridor: EventMapObjectDTO) {
  return true;
}

export function persistSmartCorridorMetadata(corridor: EventMapObjectDTO) {
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

export function getCorridorSplitCenter(
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

export function ensureCorridorSplitAnchors(
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
