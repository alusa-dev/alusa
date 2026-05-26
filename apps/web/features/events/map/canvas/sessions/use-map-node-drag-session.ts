'use client';

import {
  cloneEventMap,
  getSelectableItems,
  isItemSelected,
  resolveCorridorDragMode,
  resolveDragTarget,
  type MapSelectionItem,
} from '@alusa/domain';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import type Konva from 'konva';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { applyCanvasTransformPayload } from '../commit/apply-canvas-transform';
import { buildGroupDragCommit } from '../commit/group-drag-commit';
import type { GroupDragState } from './use-drag-session';

export function useMapNodeDragSession({
  activeLevelId,
  levelObjects,
  levelSeats,
  map,
  groupDragRef,
  committedGroupDragNodeIdsRef,
  beginGroupDrag,
  syncGroupDrag,
  flushCorridorDragPreview,
  clearSmartCorridorPreview,
  corridorPreviewBaseMapRef,
  corridorPreviewWorkingMapRef,
  corridorDragCorridorNodeIdsRef,
  corridorDragModeRef,
  isCorridorLivePreviewRef,
  setActiveUnionDragIds,
  lastTransformCommitRef,
  setSelection,
  individualSeatDragId,
  setIndividualSeatDragId,
  clearGuides,
  handleSnapDragMove,
  isSmartCorridorPreviewDrag,
  scheduleCorridorDragPreview,
}: {
  activeLevelId: string | null;
  levelObjects: EventMapObjectDTO[];
  levelSeats: EventMapDTO['seats'];
  map: EventMapDTO | null;
  groupDragRef: MutableRefObject<GroupDragState | null>;
  committedGroupDragNodeIdsRef: MutableRefObject<Set<string>>;
  beginGroupDrag: (nodeId: string, nodeIds: string[]) => void;
  syncGroupDrag: (event: Konva.KonvaEventObject<DragEvent>) => void;
  flushCorridorDragPreview: () => void;
  clearSmartCorridorPreview: () => void;
  corridorPreviewBaseMapRef: MutableRefObject<EventMapDTO | null>;
  corridorPreviewWorkingMapRef: MutableRefObject<EventMapDTO | null>;
  corridorDragCorridorNodeIdsRef: MutableRefObject<string[]>;
  corridorDragModeRef: MutableRefObject<ReturnType<typeof resolveCorridorDragMode> | null>;
  isCorridorLivePreviewRef: MutableRefObject<boolean>;
  setActiveUnionDragIds: Dispatch<SetStateAction<Set<string>>>;
  lastTransformCommitRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  setSelection: (selection: MapSelectionItem | MapSelectionItem[] | null) => void;
  individualSeatDragId: string | null;
  setIndividualSeatDragId: Dispatch<SetStateAction<string | null>>;
  clearGuides: () => void;
  handleSnapDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  isSmartCorridorPreviewDrag: (event: Konva.KonvaEventObject<DragEvent>) => boolean;
  scheduleCorridorDragPreview: () => void;
}) {
  const getSectionGroupNodeIds = useCallback(
    (sectionId: string) => {
      const linkedObject = levelObjects.find((object) => object.sectionId === sectionId && object.type === 'SECTION');
      const seatNodeIds = levelSeats
        .filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD')
        .map((seat) => `node-${seat.id}`);

      return linkedObject ? [`node-${linkedObject.id}`, ...seatNodeIds] : seatNodeIds;
    },
    [levelObjects, levelSeats],
  );

  const commitGroupDrag = useCallback(() => {
    const drag = groupDragRef.current;
    groupDragRef.current = null;
    if (!drag) return;

    committedGroupDragNodeIdsRef.current = new Set(drag.origin.keys());

    const { payload, forceCorridor } = buildGroupDragCommit({
      drag,
      map,
      baseMap: corridorPreviewBaseMapRef.current,
      previewWorkingMap: corridorPreviewWorkingMapRef.current,
      corridorDragMode: corridorDragModeRef.current,
    });
    applyCanvasTransformPayload(payload, { forceCorridor });
    clearSmartCorridorPreview();
  }, [
    clearSmartCorridorPreview,
    committedGroupDragNodeIdsRef,
    corridorDragModeRef,
    corridorPreviewBaseMapRef,
    corridorPreviewWorkingMapRef,
    groupDragRef,
    map,
  ]);

  const handleResponsiveDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      if (isSmartCorridorPreviewDrag(event)) {
        if (corridorDragModeRef.current === 'rigid') {
          handleSnapDragMove(event);
          scheduleCorridorDragPreview();
          return;
        }

        clearGuides();
        syncGroupDrag(event);
        scheduleCorridorDragPreview();
        return;
      }

      handleSnapDragMove(event);
    },
    [clearGuides, corridorDragModeRef, handleSnapDragMove, isSmartCorridorPreviewDrag, scheduleCorridorDragPreview, syncGroupDrag],
  );

  const handleNodeDragStart = useCallback(
    (nodeId: string, item?: MapSelectionItem) => {
      clearGuides();
      const currentState = useEventMapEditorStore.getState();
      const currentSelection = currentState.selection;
      const currentObjects =
        currentState.map?.objects.filter((object) => object.levelId === activeLevelId && !object.hidden) ?? levelObjects;
      const dragTarget = resolveDragTarget(nodeId, item, currentSelection, currentObjects);
      const draggedSeat = item?.type === 'seat' ? currentState.map?.seats.find((seat) => seat.id === item.id) : null;
      const shouldDragSeatSection =
        item?.type === 'seat' && item.id !== individualSeatDragId && Boolean(draggedSeat?.sectionId);
      const sectionNodeIds =
        item?.type === 'section'
          ? getSectionGroupNodeIds(item.id)
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? getSectionGroupNodeIds(draggedSeat.sectionId)
            : [];
      const resolvedNodeIds = sectionNodeIds.length > 0 ? sectionNodeIds : dragTarget.nodeIds;
      const resolvedSelectionItems =
        item?.type === 'section'
          ? [item]
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? [{ type: 'section' as const, id: draggedSeat.sectionId }]
            : dragTarget.selectionItems;
      const selectableSelection = getSelectableItems(currentSelection);
      const selectionChanged =
        resolvedSelectionItems.length !== selectableSelection.length ||
        !resolvedSelectionItems.every((entry) => isItemSelected(currentSelection, entry));

      if (selectionChanged) {
        setSelection(resolvedSelectionItems);
      }

      beginGroupDrag(nodeId, resolvedNodeIds);

      const corridorIds = new Set(
        (currentState.map?.objects ?? []).filter((object) => object.type === 'CORRIDOR').map((object) => object.id),
      );
      const draggingCorridorIds = resolvedNodeIds
        .map((id) => id.replace(/^node-/, ''))
        .filter((id) => corridorIds.has(id));

      if (draggingCorridorIds.length > 0) {
        const base = currentState.map ? cloneEventMap(currentState.map) : null;
        corridorPreviewBaseMapRef.current = base;
        corridorPreviewWorkingMapRef.current = base ? cloneEventMap(base) : null;
        corridorDragCorridorNodeIdsRef.current = draggingCorridorIds.map((id) => `node-${id}`);
        isCorridorLivePreviewRef.current = true;
        setActiveUnionDragIds(new Set(draggingCorridorIds));

        const drag = groupDragRef.current;
        if (base && drag) {
          corridorDragModeRef.current = resolveCorridorDragMode(base, drag, draggingCorridorIds);
        }
      }
    },
    [
      activeLevelId,
      beginGroupDrag,
      clearGuides,
      corridorDragCorridorNodeIdsRef,
      corridorDragModeRef,
      corridorPreviewBaseMapRef,
      corridorPreviewWorkingMapRef,
      getSectionGroupNodeIds,
      groupDragRef,
      individualSeatDragId,
      isCorridorLivePreviewRef,
      levelObjects,
      setActiveUnionDragIds,
      setSelection,
    ],
  );

  const handleNodeDragEnd = useCallback(
    (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => {
      clearGuides();

      const drag = groupDragRef.current;
      if (drag?.origin.has(nodeId)) {
        if (corridorPreviewBaseMapRef.current) {
          syncGroupDrag(event);
          flushCorridorDragPreview();
        }
        commitGroupDrag();
        return;
      }

      if (committedGroupDragNodeIdsRef.current.has(nodeId)) {
        committedGroupDragNodeIdsRef.current.delete(nodeId);
        clearSmartCorridorPreview();
        return;
      }

      groupDragRef.current = null;
      const entityId = nodeId.replace('node-', '');
      const nx = event.target.x();
      const ny = event.target.y();
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        groupDragRef.current = null;
        clearSmartCorridorPreview();
        return;
      }
      const last = lastTransformCommitRef.current.get(entityId);
      if (last && Math.abs(last.x - nx) < 0.5 && Math.abs(last.y - ny) < 0.5) {
        lastTransformCommitRef.current.delete(entityId);
        clearSmartCorridorPreview();
        return;
      }
      onCommit(nx, ny);
      clearSmartCorridorPreview();
    },
    [
      clearGuides,
      clearSmartCorridorPreview,
      commitGroupDrag,
      committedGroupDragNodeIdsRef,
      corridorPreviewBaseMapRef,
      flushCorridorDragPreview,
      groupDragRef,
      lastTransformCommitRef,
      syncGroupDrag,
    ],
  );

  return {
    handleNodeDragStart,
    handleNodeDragEnd,
    handleResponsiveDragMove,
    commitGroupDrag,
  };
}
