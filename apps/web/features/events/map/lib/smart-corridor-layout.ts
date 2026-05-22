import type { EventMapDTO, EventMapObjectDTO } from '../api/event-map-service';
import type { BoundsRect } from './selection-utils';

export type SmartCorridorAxis = 'vertical' | 'horizontal';

export type CorridorSpacing = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type SmartCorridorLayout = {
  objectId: string;
  axis: SmartCorridorAxis;
  coreRect: BoundsRect;
  clearanceRect: BoundsRect;
  spacing: CorridorSpacing;
  thickness: number;
};

export const SMART_CORRIDOR_KIND_KEY = 'smartCorridor';
export const CORRIDOR_THICKNESS_KEY = 'corridorThickness';
export const CORRIDOR_SPLIT_X_KEY = 'corridorSplitX';
export const CORRIDOR_SPLIT_Y_KEY = 'corridorSplitY';
export const CORRIDOR_CORE_WIDTH_KEY = 'corridorCoreWidth';
export const CORRIDOR_CORE_HEIGHT_KEY = 'corridorCoreHeight';
export const CORRIDOR_AXIS_KEY = 'corridorAxis';
export const CORRIDOR_AUTO_FIT_KEY = 'corridorAutoFit';

export const DEFAULT_CORRIDOR_THICKNESS = 32;
export const DEFAULT_CORRIDOR_GAP = 8;
const CORRIDOR_AXIS_RATIO_THRESHOLD = 1.15;

export function readNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRotation(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360;
  return Math.abs(normalized) < 0.001 ? 0 : normalized;
}

export function getCorridorSpacing(corridor: EventMapObjectDTO): CorridorSpacing {
  const read = (key: string) => Math.max(0, readNumber(corridor.data[key], DEFAULT_CORRIDOR_GAP));

  return {
    top: read('seatGapTop'),
    right: read('seatGapRight'),
    bottom: read('seatGapBottom'),
    left: read('seatGapLeft'),
  };
}

export function expandRectWithSpacing(rect: BoundsRect, spacing: CorridorSpacing): BoundsRect {
  return {
    x: rect.x - spacing.left,
    y: rect.y - spacing.top,
    width: rect.width + spacing.left + spacing.right,
    height: rect.height + spacing.top + spacing.bottom,
  };
}

export function inferSmartCorridorAxisFromCoreRect(coreRect: BoundsRect): SmartCorridorAxis {
  const width = Math.max(1, Math.abs(coreRect.width));
  const height = Math.max(1, Math.abs(coreRect.height));

  if (width / height >= CORRIDOR_AXIS_RATIO_THRESHOLD) return 'horizontal';
  if (height / width >= CORRIDOR_AXIS_RATIO_THRESHOLD) return 'vertical';

  return height >= width ? 'vertical' : 'horizontal';
}

export function inferCorridorAxisFromSize(width: number, height: number): SmartCorridorAxis {
  return inferSmartCorridorAxisFromCoreRect({ x: 0, y: 0, width, height });
}

export function readCorridorThickness(corridor: EventMapObjectDTO, axis: SmartCorridorAxis) {
  const direct = Number(corridor.data[CORRIDOR_THICKNESS_KEY]);
  if (Number.isFinite(direct) && direct > 0) {
    return clampNumber(direct, 8, 240);
  }

  const legacy =
    axis === 'vertical'
      ? Number(corridor.data[CORRIDOR_CORE_WIDTH_KEY])
      : Number(corridor.data[CORRIDOR_CORE_HEIGHT_KEY]);

  if (Number.isFinite(legacy) && legacy > 0 && legacy <= 240) {
    return clampNumber(legacy, 8, 240);
  }

  const width = corridor.width ?? DEFAULT_CORRIDOR_THICKNESS;
  const height = corridor.height ?? DEFAULT_CORRIDOR_THICKNESS;
  return clampNumber(Math.min(Math.abs(width), Math.abs(height), DEFAULT_CORRIDOR_THICKNESS), 8, 240);
}

export function getSmartCorridorCoreRect(corridor: EventMapObjectDTO): BoundsRect {
  const width = corridor.width ?? DEFAULT_CORRIDOR_THICKNESS;
  const height = corridor.height ?? 280;

  return {
    x: corridor.x,
    y: corridor.y,
    width,
    height,
  };
}

export function normalizeSmartCorridorObject(corridor: EventMapObjectDTO) {
  corridor.rotation = normalizeRotation(corridor.rotation ?? 0);
}

export function resolveSmartCorridorLayout(corridor: EventMapObjectDTO): SmartCorridorLayout {
  normalizeSmartCorridorObject(corridor);

  const coreRect = getSmartCorridorCoreRect(corridor);
  const axis = inferSmartCorridorAxisFromCoreRect(coreRect);
  const spacing = getCorridorSpacing(corridor);
  const thickness = readCorridorThickness(corridor, axis);

  const normalizedCoreRect =
    axis === 'vertical'
      ? { ...coreRect, width: thickness }
      : { ...coreRect, height: thickness };

  return {
    objectId: corridor.id,
    axis,
    coreRect: normalizedCoreRect,
    clearanceRect: expandRectWithSpacing(normalizedCoreRect, spacing),
    spacing,
    thickness,
  };
}

export function cloneEventMap(map: EventMapDTO): EventMapDTO {
  return JSON.parse(JSON.stringify(map)) as EventMapDTO;
}
