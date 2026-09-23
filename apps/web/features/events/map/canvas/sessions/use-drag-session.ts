'use client';

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type Konva from 'konva';
import type { BoundingBox } from '@alusa/domain';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { computeUnionBoundsFromNodes } from '../adapters/konva-snap-adapter';
import type { MapSelectionItem } from '@alusa/domain';

export type GroupDragState = {
  anchorNodeId: string;
  origin: Map<string, { x: number; y: number }>;
  nodes: Map<string, Konva.Node>;
  bounds: BoundingBox | null;
  delta: { x: number; y: number };
  parametricItems?: Array<Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>>;
};

type DragSessionInput = {
  stageRef: RefObject<Konva.Stage | null>;
};

function getNodeEntityId(nodeId: string) {
  return nodeId.replace(/^node-/, '');
}

export function useDragSession({ stageRef }: DragSessionInput) {
  const groupDragRef = useRef<GroupDragState | null>(null);
  const committedGroupDragNodeIdsRef = useRef<Set<string>>(new Set());

  const beginGroupDrag = useCallback((nodeId: string, nodeIds: string[], parametricItems?: GroupDragState['parametricItems']) => {
    committedGroupDragNodeIdsRef.current.clear();
    if (!nodeIds.includes(nodeId)) {
      groupDragRef.current = null;
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;

    const currentMap = useEventMapEditorStore.getState().map;
    const objectsById = new Map(currentMap?.objects.map((entry) => [entry.id, entry]) ?? []);
    const seatsById = new Map(currentMap?.seats.map((entry) => [entry.id, entry]) ?? []);
    const requestedNodeIds = new Set(nodeIds);
    const nodes = new Map<string, Konva.Node>();
    for (const node of stage.find((candidate: Konva.Node) => requestedNodeIds.has(candidate.id()))) {
      nodes.set(node.id(), node);
    }
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of nodeIds) {
      const entityId = getNodeEntityId(id);
      const object = objectsById.get(entityId);
      if (object) {
        origin.set(id, { x: object.x, y: object.y });
        continue;
      }

      const seat = seatsById.get(entityId);
      if (seat) {
        origin.set(id, { x: seat.x, y: seat.y });
        continue;
      }

      const node = nodes.get(id);
      if (node) origin.set(id, { x: node.x(), y: node.y() });
    }

    const dragNodes = [...origin.keys()].flatMap((id) => {
      const node = nodes.get(id);
      return node ? [node] : [];
    });
    groupDragRef.current = {
      anchorNodeId: nodeId,
      origin,
      nodes,
      bounds: dragNodes.length > 0 ? computeUnionBoundsFromNodes(dragNodes) : null,
      delta: { x: 0, y: 0 },
      parametricItems,
    };
  }, [stageRef]);

  const syncGroupDrag = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.anchorNodeId !== event.target.id()) return;

    const anchorOrigin = drag.origin.get(drag.anchorNodeId);
    if (!anchorOrigin) return;

    const dx = event.target.x() - anchorOrigin.x;
    const dy = event.target.y() - anchorOrigin.y;
    drag.delta = { x: dx, y: dy };
    for (const [nodeId, start] of drag.origin) {
      if (nodeId === drag.anchorNodeId) continue;
      const node = drag.nodes.get(nodeId);
      if (!node) continue;
      node.x(start.x + dx);
      node.y(start.y + dy);
    }
  }, []);

  return {
    groupDragRef,
    committedGroupDragNodeIdsRef,
    beginGroupDrag,
    syncGroupDrag,
  };
}
