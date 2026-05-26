import type { EventMapObjectDTO } from '../../types/event-map-types.js';
import {
  updateCorridorSplitAnchorsOnDrag,
  persistCorridorMetadataOnly,
} from '../../layout/corridor/index.js';
import {
  applyCorridorRotationPreservingCenter,
  isCorridorRotationOnlyTransform,
  normalizeRotation,
  reconcileCorridorGeometry,
} from '../../layout/smart-corridor-layout.js';

export function hasCorridorGeometryPatch(patch: Partial<EventMapObjectDTO>) {
  return (
    typeof patch.x === 'number' ||
    typeof patch.y === 'number' ||
    typeof patch.width === 'number' ||
    typeof patch.height === 'number' ||
    typeof patch.rotation === 'number'
  );
}

export function hasCorridorMetadataPatch(patch: Partial<EventMapObjectDTO>) {
  if (!patch.data) return false;
  return (
    'seatGapTop' in patch.data ||
    'seatGapRight' in patch.data ||
    'seatGapBottom' in patch.data ||
    'seatGapLeft' in patch.data
  );
}

export function applyObjectPatchWithCorridorMetadata(
  object: EventMapObjectDTO,
  patch: Partial<EventMapObjectDTO>,
): EventMapObjectDTO {
  const previous: EventMapObjectDTO = {
    ...object,
    data: { ...object.data },
  };

  const next: EventMapObjectDTO = patch.data
    ? {
        ...object,
        ...patch,
        data: { ...object.data, ...patch.data },
      }
    : {
        ...object,
        ...patch,
      };

  if (next.type === 'CORRIDOR' && hasCorridorGeometryPatch(patch)) {
    if (isCorridorRotationOnlyTransform(patch, previous) && typeof patch.rotation === 'number') {
      applyCorridorRotationPreservingCenter(next, patch.rotation, previous, { snap: false });
    } else {
      if (typeof patch.rotation === 'number') {
        next.rotation = normalizeRotation(patch.rotation);
      }
      reconcileCorridorGeometry(next);
    }
    updateCorridorSplitAnchorsOnDrag(next, patch, previous);
    return next;
  }

  if (next.type === 'CORRIDOR' && hasCorridorMetadataPatch(patch)) {
    persistCorridorMetadataOnly(next);
    return next;
  }

  return next;
}
