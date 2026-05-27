import type { EventMapDTO } from '../../types/event-map-types.js';
import { cloneEventMap } from '../smart-corridor-layout.js';
import {
  corridorAffectsSection,
  getSectionContext,
} from './corridor-section-base.js';
import {
  applyCorridorPreviewPatch,
  resetCorridorPreviewFromBase,
} from './corridor-transform-preview.js';
import {
  applyCorridorReflow,
  CORRIDOR_REFLOW_ITERATIONS,
} from './corridor-reflow.js';
import type { CorridorDragMode, CorridorDragSession, SmartCorridorDragPreviewOptions } from './corridor-preview-types.js';

export type { CorridorDragMode, CorridorDragSession, SmartCorridorDragPreviewOptions } from './corridor-preview-types.js';

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
    const start = drag.origin.get(`node-${seat.id}`);
    if (!start) continue;
    seat.x = start.x + drag.delta.x;
    seat.y = start.y + drag.delta.y;
  }

  return preview;
}
