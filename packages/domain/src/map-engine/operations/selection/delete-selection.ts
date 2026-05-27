import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { expandObjectSelectionItems, sanitizeGroupMembership } from '../../layout/object-groups.js';
import { applyCorridorReflow } from '../../layout/corridor/index.js';
import { cloneMap, updateCounts } from '../../reducer/reducer-context.js';

export type DeleteSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
};

export type DeleteSelectionResult = {
  map: EventMapDTO;
  selection: MapSelection;
  warnings: string[];
  blocked: boolean;
};

export function deleteSelection(input: DeleteSelectionInput): DeleteSelectionResult {
  const nextMap = cloneMap(input.map);
  const items = expandObjectSelectionItems(getSelectableItems(input.selection), nextMap.objects);
  const warnings: string[] = [];

  const hasLockedItem = items.some((item) => {
    if (item.type === 'object') {
      return nextMap.objects.some((object) => object.id === item.id && object.locked);
    }
    if (item.type === 'section') {
      return nextMap.objects.some((object) => object.sectionId === item.id && object.locked);
    }
    if (item.type === 'seatgroup') {
      return nextMap.seatGroups?.some((group) => group.id === item.id && group.locked) ?? false;
    }
    return false;
  });

  const hasSoldSeat = items.some((item) => {
    if (item.type === 'seat') {
      return nextMap.seats.some((seat) => seat.id === item.id && seat.status === 'SOLD');
    }
    if (item.type === 'section') {
      return nextMap.seats.some((seat) => seat.sectionId === item.id && seat.status === 'SOLD');
    }
    if (item.type === 'seatgroup') {
      return nextMap.seats.some((seat) => seat.groupId === item.id && seat.status === 'SOLD');
    }
    return false;
  });

  if (hasLockedItem) {
    return {
      map: input.map,
      selection: input.selection,
      warnings: ['A seleção contém item bloqueado.'],
      blocked: true,
    };
  }

  if (hasSoldSeat) {
    return {
      map: input.map,
      selection: input.selection,
      warnings: ['A seleção contém assento vendido.'],
      blocked: true,
    };
  }

  let removedCorridor = false;

  for (const item of items) {
    if (item.type === 'seat') {
      nextMap.seats = nextMap.seats.filter((entry) => entry.id !== item.id);
    }

    if (item.type === 'object') {
      removedCorridor = removedCorridor || nextMap.objects.some((entry) => entry.id === item.id && entry.type === 'CORRIDOR');
      nextMap.objects = nextMap.objects.filter((entry) => entry.id !== item.id);
    }

    if (item.type === 'section') {
      nextMap.seats = nextMap.seats.filter((seat) => seat.sectionId !== item.id);
      nextMap.objects = nextMap.objects.filter((object) => object.sectionId !== item.id);
      nextMap.sections = nextMap.sections.filter((section) => section.id !== item.id);
    }

    if (item.type === 'seatgroup') {
      const removedSeatSectionIds = new Set(
        nextMap.seats
          .filter((seat) => seat.groupId === item.id)
          .map((seat) => seat.sectionId)
          .filter((sectionId): sectionId is string => Boolean(sectionId)),
      );
      nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((group) => group.id !== item.id);
      nextMap.seats = nextMap.seats.filter((seat) => seat.groupId !== item.id);
      for (const sectionId of removedSeatSectionIds) {
        if (!nextMap.seats.some((seat) => seat.sectionId === sectionId)) {
          nextMap.objects = nextMap.objects.filter((object) => !object.sectionId || object.sectionId !== sectionId);
          nextMap.sections = nextMap.sections.filter((section) => section.id !== sectionId);
        }
      }
    }
  }

  const usedGroupIds = new Set(nextMap.seats.map((seat) => seat.groupId).filter((groupId): groupId is string => Boolean(groupId)));
  nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((group) => usedGroupIds.has(group.id));
  nextMap.objects = sanitizeGroupMembership(nextMap.objects);
  if (removedCorridor) applyCorridorReflow(nextMap);
  updateCounts(nextMap);

  return { map: nextMap, selection: [], warnings, blocked: false };
}
