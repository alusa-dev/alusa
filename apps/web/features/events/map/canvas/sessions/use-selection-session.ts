'use client';

import {
  expandObjectSelectionItems,
  getObjectBounds,
  getSeatBounds,
  getSeatGroupWorldBounds,
  intersectsRect,
  isItemSelected,
  isObjectInSelectedGroup,
  isSameSelectionItem,
  normalizeBoundsRect,
  resolveGroupSelectionItem,
} from '@alusa/domain';
import type { MapSelectionItem } from '@alusa/domain';
import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../api/event-map-service';

import { useCallback, useMemo } from 'react';
import type Konva from 'konva';

type SelectionSessionInput = {
  map: EventMapDTO | null;
  selection: MapSelectionItem[];
  levelObjects: EventMapObjectDTO[];
  levelSeats: EventSeatDTO[];
  levelSeatGroups: EventSeatGroupDTO[];
  setSelection: (selection: MapSelectionItem[] | MapSelectionItem) => void;
  clearIndividualSeatDrag: () => void;
};

export function isAdditiveSelect(event: Konva.KonvaEventObject<MouseEvent>) {
  return event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey;
}

function findItemsInMarquee(
  box: ReturnType<typeof normalizeBoundsRect>,
  objects: EventMapObjectDTO[],
  seats: EventSeatDTO[],
  seatGroups: EventSeatGroupDTO[],
): MapSelectionItem[] {
  const items: MapSelectionItem[] = [];
  const seen = new Set<string>();

  for (const object of objects) {
    if (object.locked) continue;
    const bounds = getObjectBounds(object);
    if (!intersectsRect(box, bounds)) continue;

    const item: MapSelectionItem =
      object.sectionId && object.type === 'SECTION'
        ? { type: 'section', id: object.sectionId }
        : { type: 'object', id: object.id };
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  for (const seat of seats) {
    if (seat.groupId != null) continue;
    if (seat.status === 'SOLD') continue;
    if (!intersectsRect(box, getSeatBounds(seat))) continue;
    const key = `seat:${seat.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: 'seat', id: seat.id });
  }

  for (const group of seatGroups) {
    if (group.locked) continue;
    const bounds = getSeatGroupWorldBounds(group, seats);
    if (!intersectsRect(box, bounds)) continue;
    const key = `seatgroup:${group.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: 'seatgroup', id: group.id });
  }

  return items;
}

export function useSelectionSession({
  map,
  selection,
  levelObjects,
  levelSeats,
  levelSeatGroups,
  setSelection,
  clearIndividualSeatDrag,
}: SelectionSessionInput) {
  const selectedNodeIds = useMemo(() => {
    if (!map || selection.length === 0) return [];

    const items = selection.flatMap((item) => {
      if (item.type === 'object' || item.type === 'seat' || item.type === 'seatgroup') return [item];
      if (item.type === 'section') {
        const object = map.objects.find((entry) => entry.sectionId === item.id && entry.type === 'SECTION');
        const seats = map.seats
          .filter((seat) => seat.sectionId === item.id && seat.status !== 'SOLD')
          .map((seat) => ({ type: 'seat' as const, id: seat.id }));
        return object ? [{ type: 'object' as const, id: object.id }, ...seats] : seats;
      }
      return [];
    });

    return expandObjectSelectionItems(items, map.objects).flatMap((item) => {
      if (item.type === 'object' || item.type === 'seat') return [`node-${item.id}`];
      if (item.type === 'seatgroup') return [`node-seatgroup-${item.id}`];
      return [];
    });
  }, [selection, map]);

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

  const selectedSeatGroupIds = useMemo(() => {
    if (!map) return [];
    const seatGroupIds = new Set((map.seatGroups ?? []).map((group) => group.id));
    return selectedNodeIds
      .filter((nodeId) => nodeId.startsWith('node-seatgroup-'))
      .map((nodeId) => nodeId.replace('node-seatgroup-', ''))
      .filter((id) => seatGroupIds.has(id));
  }, [selectedNodeIds, map]);

  const selectedAnyCorridor = useMemo(() => {
    if (!map) return false;
    return selectedObjectIds.some((id) =>
      map.objects.some((object) => object.id === id && object.type === 'CORRIDOR'),
    );
  }, [map, selectedObjectIds]);

  const selectionContainsSeatsOrSections = useMemo(() => {
    if (selectedSeatIds.length > 0) return true;
    return selection.some((item) => item.type === 'section' || item.type === 'seatgroup');
  }, [selectedSeatIds, selection]);

  const handleSelectItem = useCallback(
    (item: MapSelectionItem, event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      clearIndividualSeatDrag();
      const groupItems = item.type === 'object' ? resolveGroupSelectionItem(item, levelObjects) : [item];

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
    [clearIndividualSeatDrag, levelObjects, selection, setSelection],
  );

  const getMarqueeSelection = useCallback(
    (box: ReturnType<typeof normalizeBoundsRect>) =>
      expandObjectSelectionItems(
        findItemsInMarquee(box, levelObjects, levelSeats, levelSeatGroups),
        levelObjects,
      ),
    [levelObjects, levelSeats, levelSeatGroups],
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
    selectedSeatGroupIds,
    selectedAnyCorridor,
    selectionContainsSeatsOrSections,
    handleSelectItem,
    getMarqueeSelection,
    isObjectSelected,
  };
}
