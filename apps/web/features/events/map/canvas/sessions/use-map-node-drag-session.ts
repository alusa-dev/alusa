'use client';

import { findMapBlockOwner, findMapSeatOwner, getSelectableItems, isItemSelected, resolveDragTarget, type MapSelectionItem } from '@alusa/domain';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import type Konva from 'konva';
import type { EventMapDTO, EventMapObjectDTO } from '../../api/event-map-service';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { applyCanvasTransformPayload } from '../commit/apply-canvas-transform';
import { buildGroupDragCommit } from '../commit/group-drag-commit';
import type { GroupDragState } from './use-drag-session';

export function useMapNodeDragSession({
  activeLevelId,
  transformerRef,
  levelObjects,
  levelSeats,
  map,
  groupDragRef,
  committedGroupDragNodeIdsRef,
  beginGroupDrag,
  syncGroupDrag,
  lastTransformCommitRef,
  setSelection,
  individualSeatDragId,
  clearGuides,
  handleSnapDragMove,
}: {
  activeLevelId: string | null;
  transformerRef: import('react').RefObject<Konva.Transformer | null>;
  levelObjects: EventMapObjectDTO[];
  levelSeats: EventMapDTO['seats'];
  map: EventMapDTO | null;
  groupDragRef: MutableRefObject<GroupDragState | null>;
  committedGroupDragNodeIdsRef: MutableRefObject<Set<string>>;
  beginGroupDrag: (nodeId: string, nodeIds: string[], parametricItems?: GroupDragState['parametricItems']) => void;
  syncGroupDrag: (event: Konva.KonvaEventObject<DragEvent>) => void;
  lastTransformCommitRef: MutableRefObject<Map<string, { x: number; y: number }>>;
  setSelection: (selection: MapSelectionItem | MapSelectionItem[] | null) => void;
  individualSeatDragId: string | null;
  clearGuides: () => void;
  handleSnapDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
}) {
  const getSectionGroupNodeIds = useCallback(
    (sectionId: string) => {
      const currentMap = useEventMapEditorStore.getState().map ?? map;
      const linkedObject = levelObjects.find((object) => object.sectionId === sectionId && object.type === 'SECTION');
      const sectionSeats = currentMap?.seats.filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD') ?? levelSeats.filter((seat) => seat.sectionId === sectionId && seat.status !== 'SOLD');
      const seatNodeIds = sectionSeats.map((seat) => `node-${seat.id}`);
      return linkedObject
        ? [`node-${linkedObject.id}`, ...seatNodeIds]
        : seatNodeIds;
    },
    [levelObjects, levelSeats, map],
  );

  const getBlockGroupNodeIds = useCallback(
    (blockId: string) => {
      const currentMap = useEventMapEditorStore.getState().map ?? map;
      const document = currentMap?.document;
      const owner = document ? findMapBlockOwner(document, blockId) : null;
      if (!owner) return [];
      const selected = useEventMapEditorStore.getState().selection;
      const selectedBlocks = selected.length > 1 && selected.every((item) => item.type === 'seatblock')
        ? selected.filter((item) => item.type === 'seatblock')
        : [{ type: 'seatblock' as const, id: blockId }];
      if (!selectedBlocks.some((item) => item.id === blockId)) selectedBlocks.splice(0, selectedBlocks.length, { type: 'seatblock', id: blockId });
      const blockOwners = selectedBlocks.flatMap((item) => {
        const selectedOwner = findMapBlockOwner(document!, item.id);
        return selectedOwner ? [{ item, owner: selectedOwner }] : [];
      });
      if (blockOwners.length > 1) {
        const selectedSeatIds = new Set(blockOwners.flatMap(({ owner }) => owner.block.rows.flatMap((row) => row.seatIds)));
        return (currentMap?.seats ?? levelSeats)
          .filter((seat) => selectedSeatIds.has(seat.id))
          .map((seat) => `node-${seat.id}`)
          .concat(blockOwners.flatMap(({ owner }) => owner.block.rows.flatMap((row) => [`node-seatrow-line-${row.id}`, `node-seatrow-label-${row.id}`, `node-seatrow-${row.id}`])))
          .concat(blockOwners.map(({ item }) => `node-seatblock-${item.id}`));
      }
      const selectedRow = selected.length === 1 && selected[0]?.type === 'seatrow' && owner.block.rows.some((row) => row.id === selected[0]?.id)
        ? owner.block.rows.find((row) => row.id === selected[0]?.id)
        : null;
      const rows = selectedRow ? [selectedRow] : owner.block.rows;
      const seatIds = new Set(rows.flatMap((row) => row.seatIds));
      return (currentMap?.seats ?? levelSeats)
        .filter((seat) => seat.levelId === owner.section.levelId && seatIds.has(seat.id))
        .map((seat) => `node-${seat.id}`)
        .concat(rows.flatMap((row) => [`node-seatrow-line-${row.id}`, `node-seatrow-label-${row.id}`, `node-seatrow-${row.id}`]))
        .concat(selectedRow ? [] : [`node-seatblock-${owner.block.id}`]);
    },
    [levelSeats, map],
  );

  const commitGroupDrag = useCallback(() => {
    const drag = groupDragRef.current;
    groupDragRef.current = null;
    if (!drag) return;
    committedGroupDragNodeIdsRef.current = new Set(drag.origin.keys());
    if (drag.parametricItems?.length) {
        useEventMapEditorStore.getState().transformParametricSelections(drag.parametricItems.map((item) => ({ item, matrix: [1, 0, 0, 1, drag.delta.x, drag.delta.y] })));
        for (const [nodeId, origin] of drag.origin) {
          if (nodeId.startsWith('node-seatrow-line-') || nodeId.startsWith('node-seatrow-label-') || nodeId.startsWith('node-seatrow-') || nodeId.startsWith('node-seatblock-')) {
            drag.nodes.get(nodeId)?.position(origin);
          }
        }
      } else {
        applyCanvasTransformPayload(buildGroupDragCommit({ drag, map }).payload);
      }
  }, [committedGroupDragNodeIdsRef, groupDragRef, map]);

  const handleNodeDragStart = useCallback(
    (nodeId: string, item?: MapSelectionItem) => {
      clearGuides();
      if (groupDragRef.current?.origin.has(nodeId)) return;
      const currentState = useEventMapEditorStore.getState();
      const currentSelection = currentState.selection;
      const selectedItems = getSelectableItems(currentSelection);
      const currentObjects =
        currentState.map?.objects.filter((object) => object.levelId === activeLevelId && !object.hidden) ?? levelObjects;
      const dragTarget = resolveDragTarget(
        nodeId,
        item,
        currentSelection,
        currentState.map ?? { objects: currentObjects, seats: [] },
      );
      const draggedSeat = item?.type === 'seat' ? currentState.map?.seats.find((seat) => seat.id === item.id) : null;
      const draggedSeatOwner = item?.type === 'seat' && currentState.map?.document ? findMapSeatOwner(currentState.map.document, item.id) : null;
      const itemIsPartOfSelection = item !== undefined && (
        isItemSelected(currentSelection, item) ||
        (item.type === 'seat' && draggedSeatOwner !== null && (
          isItemSelected(currentSelection, { type: 'seatblock', id: draggedSeatOwner.block.id }) ||
          isItemSelected(currentSelection, { type: 'seatrow', id: draggedSeatOwner.row.id })
        ))
      );
      const isDraggingExistingMultiSelection = selectedItems.length > 1 && itemIsPartOfSelection;
      const shouldDragSeatSection =
        !isDraggingExistingMultiSelection && item?.type === 'seat' && item.id !== individualSeatDragId && Boolean(draggedSeat?.sectionId);
      const shouldDragSeatBlock =
        !isDraggingExistingMultiSelection && item?.type === 'seat' && item.id !== individualSeatDragId && Boolean(draggedSeatOwner);
      const blockNodeIds = shouldDragSeatBlock && draggedSeatOwner ? getBlockGroupNodeIds(draggedSeatOwner.block.id) : [];
      const selectedRow = currentSelection.length === 1 && currentSelection[0]?.type === 'seatrow' && draggedSeatOwner?.row.id === currentSelection[0].id
        ? currentSelection[0]
        : null;
      const parametricItem = shouldDragSeatBlock && draggedSeatOwner
        ? selectedRow ?? { type: 'seatblock' as const, id: draggedSeatOwner.block.id }
        : undefined;
      const selectedParametricItems = shouldDragSeatBlock && draggedSeatOwner
        ? currentSelection.length > 1 && currentSelection.every((entry) => entry.type === 'seatblock') && currentSelection.some((entry) => entry.id === draggedSeatOwner.block.id)
          ? currentSelection.filter((entry): entry is Extract<MapSelectionItem, { type: 'seatblock' }> => entry.type === 'seatblock')
          : [parametricItem!]
        : undefined;
      const sectionNodeIds =
        !isDraggingExistingMultiSelection && item?.type === 'section'
          ? getSectionGroupNodeIds(item.id)
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? getSectionGroupNodeIds(draggedSeat.sectionId)
            : [];
      const resolvedNodeIds = blockNodeIds.length > 0 ? blockNodeIds : sectionNodeIds.length > 0 ? sectionNodeIds : dragTarget.nodeIds;
      const preserveSelectedBlocks = Boolean(selectedParametricItems && selectedParametricItems.length > 1);
      const resolvedSelectionItems = isDraggingExistingMultiSelection
        ? selectedItems
        : preserveSelectedBlocks
        ? selectedParametricItems!
        : !isDraggingExistingMultiSelection && item?.type === 'section'
          ? [item]
          : shouldDragSeatBlock && draggedSeatOwner
            ? [parametricItem!]
          : shouldDragSeatSection && draggedSeat?.sectionId
            ? [{ type: 'section' as const, id: draggedSeat.sectionId }]
            : dragTarget.selectionItems;
      const selectableSelection = getSelectableItems(currentSelection);
      const selectionChanged =
        resolvedSelectionItems.length !== selectableSelection.length ||
        !resolvedSelectionItems.every((entry) => isItemSelected(currentSelection, entry));
      if (selectionChanged) setSelection(resolvedSelectionItems);
      beginGroupDrag(nodeId, resolvedNodeIds, selectedParametricItems);
    },
    [
      activeLevelId,
      beginGroupDrag,
      clearGuides,
      getSectionGroupNodeIds,
      getBlockGroupNodeIds,
      groupDragRef,
      individualSeatDragId,
      levelObjects,
      setSelection,
    ],
  );

  const handleResponsiveDragMove = useCallback(
    (event: Konva.KonvaEventObject<DragEvent>) => {
      handleSnapDragMove(event);
      syncGroupDrag(event);
      transformerRef.current?.forceUpdate();
      transformerRef.current?.getLayer()?.batchDraw();
    },
    [handleSnapDragMove, syncGroupDrag, transformerRef],
  );

  const handleNodeDragEnd = useCallback(
    (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => {
      clearGuides();
      const drag = groupDragRef.current;
      if (drag?.origin.has(nodeId)) {
        syncGroupDrag(event);
        commitGroupDrag();
        return;
      }
      if (committedGroupDragNodeIdsRef.current.has(nodeId)) {
        committedGroupDragNodeIdsRef.current.delete(nodeId);
        return;
      }
      groupDragRef.current = null;
      const entityId = nodeId.replace('node-', '');
      const x = event.target.x();
      const y = event.target.y();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const last = lastTransformCommitRef.current.get(entityId);
      if (last && Math.abs(last.x - x) < 0.5 && Math.abs(last.y - y) < 0.5) {
        lastTransformCommitRef.current.delete(entityId);
        return;
      }
      onCommit(x, y);
    },
    [clearGuides, commitGroupDrag, committedGroupDragNodeIdsRef, groupDragRef, lastTransformCommitRef, syncGroupDrag],
  );

  return { handleNodeDragStart, handleNodeDragEnd, handleResponsiveDragMove, commitGroupDrag };
}
