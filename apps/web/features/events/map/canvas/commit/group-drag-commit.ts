import {
  CORRIDOR_REFLOW_ITERATIONS,
  buildSmartCorridorDragPreview,
  extractGroupDragCommitUpdates,
  isSmartCorridorSeatReflowEnabled,
  resolveCorridorDragMode,
  resolveOperationSelection,
} from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import type { GroupDragState } from '../sessions/use-drag-session';
import type { TransformCommitPayload } from './build-canvas-transform-command';
import type { MapSelectionItem } from '@alusa/domain';

function selectionFromDragOrigin(map: EventMapDTO, origin: Map<string, { x: number; y: number }>): MapSelectionItem[] {
  const items: MapSelectionItem[] = [];

  for (const nodeId of origin.keys()) {
    if (nodeId.startsWith('node-seatgroup-')) {
      items.push({ type: 'seatgroup', id: nodeId.replace('node-seatgroup-', '') });
      continue;
    }

    const id = nodeId.replace(/^node-/, '');
    if (map.objects.some((object) => object.id === id)) {
      items.push({ type: 'object', id });
    } else if (map.seats.some((seat) => seat.id === id)) {
      items.push({ type: 'seat', id });
    }
  }

  return items;
}

export type GroupDragCommitResult = {
  kind: 'corridor' | 'generic' | 'noop';
  payload: TransformCommitPayload | null;
  forceCorridor?: boolean;
};

export type BuildGroupDragCommitParams = {
  drag: GroupDragState;
  map: EventMapDTO | null;
  baseMap: EventMapDTO | null;
  previewWorkingMap: EventMapDTO | null;
  corridorDragMode: ReturnType<typeof resolveCorridorDragMode> | null;
};

export function buildGroupDragCommit({
  drag,
  map,
  baseMap,
  previewWorkingMap,
  corridorDragMode,
}: BuildGroupDragCommitParams): GroupDragCommitResult {
  const corridorNodeIds = [...drag.origin.keys()].filter((nodeId) => {
    const id = nodeId.replace(/^node-/, '');
    return map?.objects.some((object) => object.id === id && object.type === 'CORRIDOR');
  });
  const movingCorridor = corridorNodeIds.length > 0;

  if (movingCorridor && baseMap && isSmartCorridorSeatReflowEnabled()) {
    const corridorIds = corridorNodeIds.map((nodeId) => nodeId.replace(/^node-/, ''));
    const dragMode = corridorDragMode || resolveCorridorDragMode(baseMap, drag, corridorIds);
    const preview = buildSmartCorridorDragPreview(baseMap, drag, corridorNodeIds, {
      previewMap: previewWorkingMap ?? undefined,
      maxIterations: CORRIDOR_REFLOW_ITERATIONS,
      activeCorridorIds: corridorIds,
      mode: dragMode,
    });
    const { objects, seats } = extractGroupDragCommitUpdates(baseMap, preview, drag, corridorIds, dragMode);

    if (objects.length > 0 || seats.length > 0) {
      return {
        kind: 'corridor',
        forceCorridor: true,
        payload: {
          objects,
          seats,
          skipSeatBaseLayoutTranslation: dragMode === 'reflow',
          skipCorridorReflow: true,
        },
      };
    }
    return { kind: 'corridor', payload: null, forceCorridor: true };
  }

  const { delta } = drag;
  const objectUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
  const seatUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
  const seatGroupUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];

  if (!map) return { kind: 'noop', payload: null };

  const resolved = resolveOperationSelection(map, selectionFromDragOrigin(map, drag.origin), {
    preferSeatGroups: true,
    includeSectionSeats: true,
  });

  for (const id of resolved.seatGroupIds) {
    const start = drag.origin.get(`node-seatgroup-${id}`);
    if (!start) continue;
    const nx = start.x + delta.x;
    const ny = start.y + delta.y;
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) continue;
    seatGroupUpdates.push({ id, patch: { x: nx, y: ny } });
  }

  for (const id of resolved.objectIds) {
    const start = drag.origin.get(`node-${id}`);
    if (!start) continue;
    const nx = start.x + delta.x;
    const ny = start.y + delta.y;
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) continue;
    objectUpdates.push({ id, patch: { x: nx, y: ny } });
  }

  for (const id of resolved.seatIds) {
    const start = drag.origin.get(`node-${id}`);
    if (!start) continue;
    const nx = start.x + delta.x;
    const ny = start.y + delta.y;
    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) continue;
    seatUpdates.push({ id, patch: { x: nx, y: ny } });
  }

  if (objectUpdates.length > 0 || seatUpdates.length > 0 || seatGroupUpdates.length > 0) {
    return {
      kind: 'generic',
      payload: {
        objects: objectUpdates,
        seats: seatUpdates,
        seatGroups: seatGroupUpdates,
      },
    };
  }

  return { kind: 'noop', payload: null };
}
