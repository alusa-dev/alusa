import {
  CORRIDOR_REFLOW_ITERATIONS,
  buildSmartCorridorDragPreview,
  extractGroupDragCommitUpdates,
  resolveCorridorDragMode,
} from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import type { GroupDragState } from './sessions/use-drag-session';

export type GroupDragCommitParams = {
  drag: GroupDragState;
  map: EventMapDTO | null;
  baseMap: EventMapDTO | null;
  previewWorkingMap: EventMapDTO | null;
  corridorDragMode: ReturnType<typeof resolveCorridorDragMode> | null;
  updateMapItems: (updates: {
    objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
    seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
    seatGroups?: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
    skipSeatBaseLayoutTranslation?: boolean;
    skipCorridorReflow?: boolean;
  }) => void;
};

export function commitGroupDragSession({
  drag,
  map,
  baseMap,
  previewWorkingMap,
  corridorDragMode,
  updateMapItems,
}: GroupDragCommitParams): 'corridor' | 'generic' | 'noop' {
  const corridorNodeIds = [...drag.origin.keys()].filter((nodeId) => {
    const id = nodeId.replace(/^node-/, '');
    return map?.objects.some((object) => object.id === id && object.type === 'CORRIDOR');
  });
  const movingCorridor = corridorNodeIds.length > 0;

  if (movingCorridor && baseMap) {
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
      updateMapItems({
        objects,
        seats,
        skipSeatBaseLayoutTranslation: dragMode === 'reflow',
        skipCorridorReflow: true,
      });
    }
    return 'corridor';
  }

  const { delta } = drag;
  const objectUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
  const seatUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
  const seatGroupUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];

  for (const [nodeId, start] of drag.origin) {
    const isSeatGroupNode = nodeId.startsWith('node-seatgroup-');
    const id = isSeatGroupNode ? nodeId.replace('node-seatgroup-', '') : nodeId.replace('node-', '');
    const nx = start.x + delta.x;
    const ny = start.y + delta.y;

    if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) continue;

    if (isSeatGroupNode && map?.seatGroups?.some((group) => group.id === id)) {
      seatGroupUpdates.push({ id, patch: { x: nx, y: ny } });
    } else if (map?.objects.some((object) => object.id === id)) {
      objectUpdates.push({ id, patch: { x: nx, y: ny } });
    } else if (map?.seats.some((seat) => seat.id === id)) {
      seatUpdates.push({ id, patch: { x: nx, y: ny } });
    }
  }

  if (objectUpdates.length > 0 || seatUpdates.length > 0 || seatGroupUpdates.length > 0) {
    updateMapItems({ objects: objectUpdates, seats: seatUpdates, seatGroups: seatGroupUpdates });
    return 'generic';
  }

  return 'noop';
}
