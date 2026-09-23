import { resolveOperationSelection } from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import type { GroupDragState } from '../sessions/use-drag-session';
import type { TransformCommitPayload } from './build-canvas-transform-command';
import type { MapSelectionItem } from '@alusa/domain';

function selectionFromDragOrigin(map: EventMapDTO, origin: Map<string, { x: number; y: number }>): MapSelectionItem[] {
  const items: MapSelectionItem[] = [];

  for (const nodeId of origin.keys()) {
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
  kind: 'generic' | 'noop';
  payload: TransformCommitPayload | null;
};

export type BuildGroupDragCommitParams = {
  drag: GroupDragState;
  map: EventMapDTO | null;
};

export function buildGroupDragCommit({
  drag,
  map,
}: BuildGroupDragCommitParams): GroupDragCommitResult {
  const { delta } = drag;
  const objectUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];
  const seatUpdates: Array<{ id: string; patch: { x: number; y: number } }> = [];

  if (!map) return { kind: 'noop', payload: null };

  const resolved = resolveOperationSelection(map, selectionFromDragOrigin(map, drag.origin), {
    includeSectionSeats: true,
  });

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

  if (objectUpdates.length > 0 || seatUpdates.length > 0) {
    return {
      kind: 'generic',
      payload: {
        objects: objectUpdates,
        seats: seatUpdates,
      },
    };
  }

  return { kind: 'noop', payload: null };
}
