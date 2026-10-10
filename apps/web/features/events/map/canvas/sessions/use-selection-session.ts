'use client';

import {
  expandObjectSelectionItems,
  hitTestRect,
  isItemSelected,
  isObjectInSelectedGroup,
  isSameSelectionItem,
  resolveCanvasNodeIds,
  resolveGroupSelectionItem,
  findMapBlockOwner,
  findMapRowOwner,
  findMapSeatOwner,
  type BoundsRect,
} from '@alusa/domain';
import type { MapSelectionItem } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO } from '../../api/event-map-service';
import { compactParametricSeatSelection } from './compact-seat-selection';

import { useCallback, useMemo } from 'react';
import type Konva from 'konva';

type SelectionSessionInput = {
  map: EventMapDTO | null;
  selection: MapSelectionItem[];
  levelObjects: EventMapObjectDTO[];
  levelSeats: EventSeatDTO[];
  setSelection: (selection: MapSelectionItem[] | MapSelectionItem) => void;
  clearIndividualSeatDrag: () => void;
};

export function isAdditiveSelect(event: Konva.KonvaEventObject<MouseEvent>) {
  return event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey;
}

export function useSelectionSession({
  map,
  selection,
  levelObjects,
  levelSeats,
  setSelection,
  clearIndividualSeatDrag,
}: SelectionSessionInput) {
  const selectedParametricItems = useMemo(() => {
    const parametricItems = selection.filter(
      (item): item is Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }> =>
        item.type === 'seatblock' || item.type === 'seatrow',
    );
    const selectedBlockIds = new Set(parametricItems.flatMap((item) => item.type === 'seatblock' ? [item.id] : []));
    if (!map?.document || selectedBlockIds.size === 0) return parametricItems;
    return parametricItems.filter((item) => {
      if (item.type !== 'seatrow') return true;
      const owner = findMapRowOwner(map.document!, item.id);
      return !owner || !selectedBlockIds.has(owner.block.id);
    });
  }, [map?.document, selection]);

  const selectedNodeIds = useMemo(() => {
    if (!map || selection.length === 0) return [];
    if (selection.some((item) => item.type === 'section')) return [];
    if (selectedParametricItems.length === 0) return resolveCanvasNodeIds(map, selection);

    const coveredSeatIds = new Set(
      selectedParametricItems.flatMap((item) => {
        if (!map.document) return [];
        if (item.type === 'seatblock') return findMapBlockOwner(map.document, item.id)?.block.rows.flatMap((row) => row.seatIds) ?? [];
        return findMapRowOwner(map.document, item.id)?.row.seatIds ?? [];
      }),
    );
    const regularSelection = selection.filter((item) => item.type !== 'seatblock' && item.type !== 'seatrow');
    const mapSeatIds = new Set(map.seats.map((seat) => seat.id));
    const regularNodeIds = resolveCanvasNodeIds(map, regularSelection).filter((nodeId) => {
      const seatId = nodeId.replace(/^node-/, '');
      return !mapSeatIds.has(seatId) || !coveredSeatIds.has(seatId);
    });
    const parametricNodeIds = selectedParametricItems.map((item) => `node-${item.type}-${item.id}`);
    return [...new Set([...regularNodeIds, ...parametricNodeIds])];
  }, [map, selectedParametricItems, selection]);

  const selectedObjectIds = useMemo(() => {
    if (!map) return [];
    const objectIds = new Set(map.objects.map((object) => object.id));
    return selectedNodeIds.map((nodeId) => nodeId.replace(/^node-/, '')).filter((id) => objectIds.has(id));
  }, [selectedNodeIds, map]);

  const selectedSeatIds = useMemo(() => {
    if (!map) return [];
    const seatIds = new Set(map.seats.map((seat) => seat.id));
    return selectedNodeIds.map((nodeId) => nodeId.replace(/^node-/, '')).filter((id) => seatIds.has(id));
  }, [selectedNodeIds, map]);

  const selectionContainsSeatsOrSections = useMemo(() => {
    if (selectedSeatIds.length > 0) return true;
    return selection.some((item) => item.type === 'section' || item.type === 'seatblock' || item.type === 'seatrow');
  }, [selectedSeatIds, selection]);

  const handleSelectItem = useCallback(
    (item: MapSelectionItem, event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      clearIndividualSeatDrag();
      const parametricSeatOwner = item.type === 'seat' && map?.document ? findMapSeatOwner(map.document, item.id) : null;
      const selectionItem = parametricSeatOwner ? { type: 'seatblock' as const, id: parametricSeatOwner.block.id } : item;
      const groupItems = selectionItem.type === 'object' ? resolveGroupSelectionItem(selectionItem, levelObjects) : [selectionItem];

      if (isAdditiveSelect(event)) {
        const allSelected = groupItems.every((entry) => isItemSelected(selection, entry));
        if (allSelected) {
          setSelection(selection.filter((entry) => !groupItems.some((groupItem) => isSameSelectionItem(entry, groupItem))));
          return;
        }

        const next: MapSelectionItem[] = selection.filter((entry) => entry.type !== 'level');
        for (const groupItem of groupItems) {
          if (!next.some((entry) => isSameSelectionItem(entry, groupItem))) {
            next.push(groupItem);
          }
        }
        setSelection(next);
        return;
      }

      setSelection(groupItems);
    },
    [clearIndividualSeatDrag, levelObjects, map, selection, setSelection],
  );

  const getMarqueeSelection = useCallback(
    (box: BoundsRect) => {
      const items = expandObjectSelectionItems(
        hitTestRect(box, {
          objects: levelObjects,
          seats: levelSeats,
        }),
        levelObjects,
      );
      return compactParametricSeatSelection(
        items,
        map?.document,
        map?.seats.filter((seat) => seat.status !== 'SOLD').map((seat) => seat.id),
      );
    },
    [levelObjects, levelSeats, map?.document],
  );

  const isObjectSelected = useCallback(
    (object: EventMapObjectDTO) =>
      isItemSelected(selection, { type: 'object', id: object.id }) ||
      (object.sectionId ? isItemSelected(selection, { type: 'section', id: object.sectionId }) : false) ||
      isObjectInSelectedGroup(object, selection, levelObjects),
    [selection, levelObjects],
  );

  return {
    selectedNodeIds,
    selectedObjectIds,
    selectedSeatIds,
    selectedParametricItems,
    selectionContainsSeatsOrSections,
    handleSelectItem,
    getMarqueeSelection,
    isObjectSelected,
  };
}
