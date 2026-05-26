'use client';

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type Konva from 'konva';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';

export type GroupDragState = {
  anchorNodeId: string;
  origin: Map<string, { x: number; y: number }>;
  delta: { x: number; y: number };
};

type DragSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
};

function getNodeEntityId(nodeId: string) {
  return nodeId.startsWith('node-seatgroup-')
    ? nodeId.replace('node-seatgroup-', '')
    : nodeId.replace(/^node-/, '');
}

export function useDragSession({ stageRef }: DragSessionInput) {
  const groupDragRef = useRef<GroupDragState | null>(null);
  const committedGroupDragNodeIdsRef = useRef<Set<string>>(new Set());

  const beginGroupDrag = useCallback((nodeId: string, nodeIds: string[]) => {
    committedGroupDragNodeIdsRef.current.clear();
    if (!nodeIds.includes(nodeId)) {
      groupDragRef.current = null;
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;

    const currentMap = useEventMapEditorStore.getState().map;
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of nodeIds) {
      const entityId = getNodeEntityId(id);
      const object = currentMap?.objects.find((entry) => entry.id === entityId);
      if (object) {
        origin.set(id, { x: object.x, y: object.y });
        continue;
      }

      const seat = currentMap?.seats.find((entry) => entry.id === entityId);
      if (seat) {
        origin.set(id, { x: seat.x, y: seat.y });
        continue;
      }

      const seatGroup = currentMap?.seatGroups?.find((entry) => entry.id === entityId);
      if (seatGroup) {
        origin.set(id, { x: seatGroup.x, y: seatGroup.y });
        continue;
      }

      const node = stage.findOne(`#${id}`);
      if (node) origin.set(id, { x: node.x(), y: node.y() });
    }

    groupDragRef.current = { anchorNodeId: nodeId, origin, delta: { x: 0, y: 0 } };
  }, [stageRef]);

  const syncGroupDrag = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.anchorNodeId !== event.target.id()) return;

    const anchorOrigin = drag.origin.get(drag.anchorNodeId);
    if (!anchorOrigin) return;

    const dx = event.target.x() - anchorOrigin.x;
    const dy = event.target.y() - anchorOrigin.y;
    drag.delta = { x: dx, y: dy };
    const stage = stageRef.current;
    if (!stage) return;

    for (const [nodeId, start] of drag.origin) {
      if (nodeId === drag.anchorNodeId) continue;
      const node = stage.findOne(`#${nodeId}`);
      if (!node) continue;
      node.x(start.x + dx);
      node.y(start.y + dy);
    }
  }, [stageRef]);

  return {
    groupDragRef,
    committedGroupDragNodeIdsRef,
    beginGroupDrag,
    syncGroupDrag,
  };
}
