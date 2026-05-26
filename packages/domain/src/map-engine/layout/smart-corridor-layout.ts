import type { EventMapDTO, EventMapObjectDTO } from '../types/event-map-types.js';
import type { BoundsRect } from '../selection/selection-utils.js';
import {
  normalizeRotation,
  snapSmartCorridorRotation,
} from '../geometry/rotation.js';
import {
  applyCorridorRotationPreservingCenter,
  corridorCenterTransformFromModel,
  corridorModelFromCenterTransform,
  corridorWorldCenterToTopLeft,
  effectiveCorridorAxisAtRotation,
  getCorridorWorldCenter,
  isCorridorRotationOnlyTransform,
} from './corridor-rotation.js';

export {
  applyCorridorRotationPreservingCenter,
  corridorCenterTransformFromModel,
  corridorModelFromCenterTransform,
  corridorWorldCenterToTopLeft,
  effectiveCorridorAxisAtRotation,
  getCorridorWorldCenter,
  isCorridorRotationOnlyTransform,
  normalizeRotation,
  snapSmartCorridorRotation,
};

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
export const MIN_CORRIDOR_THICKNESS = 8;
export const DEFAULT_CORRIDOR_GAP = 8;
const CORRIDOR_AXIS_RATIO_THRESHOLD = 1.15;

export function readNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function readStoredCorridorAxis(corridor: EventMapObjectDTO): SmartCorridorAxis {
  const stored = corridor.data[CORRIDOR_AXIS_KEY];
  if (stored === 'vertical' || stored === 'horizontal') return stored;
  return inferSmartCorridorAxisFromCoreRect(getSmartCorridorCoreRect(corridor));
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

  if (Number.isFinite(direct) && direct >= MIN_CORRIDOR_THICKNESS) {
    return clampNumber(direct, MIN_CORRIDOR_THICKNESS, 240);
  }

  const legacy =
    axis === 'vertical'
      ? Number(corridor.data[CORRIDOR_CORE_WIDTH_KEY])
      : Number(corridor.data[CORRIDOR_CORE_HEIGHT_KEY]);

  if (Number.isFinite(legacy) && legacy >= MIN_CORRIDOR_THICKNESS) {
    return clampNumber(legacy, MIN_CORRIDOR_THICKNESS, 240);
  }

  const sizeFromObject = axis === 'vertical' ? Number(corridor.width) : Number(corridor.height);

  if (Number.isFinite(sizeFromObject) && sizeFromObject >= MIN_CORRIDOR_THICKNESS) {
    return clampNumber(sizeFromObject, MIN_CORRIDOR_THICKNESS, 240);
  }

  return DEFAULT_CORRIDOR_THICKNESS;
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

  if (corridor.data[SMART_CORRIDOR_KIND_KEY]) {
    const rawThickness = corridor.data[CORRIDOR_THICKNESS_KEY];
    if (rawThickness !== undefined) {
      const thickness = Number(rawThickness);
      if (Number.isFinite(thickness) && thickness < MIN_CORRIDOR_THICKNESS) {
        corridor.data[CORRIDOR_THICKNESS_KEY] = MIN_CORRIDOR_THICKNESS;
      }
    }

    const width = corridor.width ?? DEFAULT_CORRIDOR_THICKNESS;
    const height = corridor.height ?? 280;
    const axis = width >= height ? 'horizontal' : 'vertical';

    if (axis === 'vertical') {
      if (corridor.width != null && corridor.width < MIN_CORRIDOR_THICKNESS) {
        corridor.width = MIN_CORRIDOR_THICKNESS;
      }
    } else {
      if (corridor.height != null && corridor.height < MIN_CORRIDOR_THICKNESS) {
        corridor.height = MIN_CORRIDOR_THICKNESS;
      }
    }
  }
}

export function resolveSmartCorridorLayout(corridor: EventMapObjectDTO): SmartCorridorLayout {
  normalizeSmartCorridorObject(corridor);

  const coreRect = getSmartCorridorCoreRect(corridor);
  const axis = effectiveCorridorAxisAtRotation(readStoredCorridorAxis(corridor), corridor.rotation ?? 0);
  const spacing = getCorridorSpacing(corridor);
  const thickness =
    axis === 'vertical'
      ? clampNumber(coreRect.width, MIN_CORRIDOR_THICKNESS, 240)
      : clampNumber(coreRect.height, MIN_CORRIDOR_THICKNESS, 240);

  return {
    objectId: corridor.id,
    axis,
    coreRect,
    clearanceRect: expandRectWithSpacing(coreRect, spacing),
    spacing,
    thickness,
  };
}

/** Single source of truth for canvas + union overlay bounds (polygon AABB). */
export function getCorridorRenderBounds(corridor: EventMapObjectDTO): BoundsRect {
  // Lazy import avoided — keep local core rect for reflow metadata;
  // visual union uses polygon bounds via corridor-union.getCorridorBounds.
  return getSmartCorridorCoreRect(corridor);
}

/** Align split anchors and metadata with the corridor body after reflow/snap. */
export function reconcileCorridorGeometry(corridor: EventMapObjectDTO) {
  normalizeSmartCorridorObject(corridor);

  const layout = resolveSmartCorridorLayout(corridor);
  const core = layout.coreRect;

  corridor.data = {
    ...corridor.data,
    [SMART_CORRIDOR_KIND_KEY]: true,
    [CORRIDOR_AXIS_KEY]: readStoredCorridorAxis(corridor),
    [CORRIDOR_AUTO_FIT_KEY]: true,
    [CORRIDOR_THICKNESS_KEY]: layout.thickness,
    [CORRIDOR_CORE_WIDTH_KEY]: layout.axis === 'vertical' ? layout.thickness : core.width,
    [CORRIDOR_CORE_HEIGHT_KEY]: layout.axis === 'horizontal' ? layout.thickness : core.height,
    [CORRIDOR_SPLIT_X_KEY]: core.x + core.width / 2,
    [CORRIDOR_SPLIT_Y_KEY]: core.y + core.height / 2,
  };
}

export function cloneEventMap(map: EventMapDTO): EventMapDTO {
  return JSON.parse(JSON.stringify(map)) as EventMapDTO;
}
