import type { EventMapDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import {
  applyCorridorRotationPreservingCenter,
  cloneEventMap,
  isCorridorRotationOnlyTransform,
  normalizeRotation,
  reconcileCorridorGeometry,
} from '../smart-corridor-layout.js';
import { updateCorridorSplitAnchorsOnDrag } from './corridor-split-anchors.js';
import {
  applyCorridorReflow,
  CORRIDOR_REFLOW_ITERATIONS,
} from './corridor-reflow.js';
import type { SmartCorridorDragPreviewOptions } from './corridor-preview-types.js';

export type CorridorTransformPreviewPatch = {
  objectId: string;
  patch: Partial<EventMapObjectDTO>;
  mode?: 'rotate' | 'resize' | 'group-rotate' | 'group-resize';
  /** Renderer anchor used for this gesture. */
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
  if (typeof normalizedPatch.rotation === 'number') {
    normalizedPatch.rotation = normalizeRotation(normalizedPatch.rotation);
  }

  const rotationChanged =
    typeof normalizedPatch.rotation === 'number' &&
    normalizedPatch.rotation !== normalizeRotation(previous.rotation ?? 0);
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
    if (typeof rotation === 'number') object.rotation = normalizeRotation(rotation);
    reconcileCorridorGeometry(object);
  } else if (mode === 'rotate' && typeof rotation === 'number') {
    applyCorridorRotationPreservingCenter(object, rotation, previous, { snap: false });
  } else {
    if (typeof x === 'number') object.x = x;
    if (typeof y === 'number') object.y = y;
    if (typeof rotation === 'number') object.rotation = rotation;
  }

  updateCorridorSplitAnchorsOnDrag(object, normalizedPatch, previous);
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
