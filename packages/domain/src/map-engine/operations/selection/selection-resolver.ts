import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { expandObjectSelectionItems } from '../../layout/object-groups.js';

export type ResolvedSelection = {
  selection: MapSelection;
  objectIds: string[];
  seatIds: string[];
  seatGroupIds: string[];
  sectionIds: string[];
  warnings: string[];
  blocked: boolean;
};

function addUnique(target: string[], seen: Set<string>, id: string) {
  if (seen.has(id)) return;
  seen.add(id);
  target.push(id);
}

function removeFrom(target: string[], seen: Set<string>, id: string) {
  seen.delete(id);
  const index = target.indexOf(id);
  if (index >= 0) target.splice(index, 1);
}

function addSeatGroup(
  map: EventMapDTO,
  groupId: string,
  seatGroupIds: string[],
  seenSeatGroups: Set<string>,
  warnings: string[],
  blockLocked: boolean,
) {
  const group = map.seatGroups?.find((entry) => entry.id === groupId);
  if (!group) return false;
  if (group.locked && blockLocked) {
    warnings.push('A seleção contém grupo de assentos bloqueado.');
    return true;
  }
  addUnique(seatGroupIds, seenSeatGroups, group.id);
  return false;
}

export function resolveOperationSelection(
  map: EventMapDTO,
  selection: MapSelection,
  options?: {
    includeSectionSeats?: boolean;
    blockLocked?: boolean;
    blockSoldSeats?: boolean;
    preferSeatGroups?: boolean;
  },
): ResolvedSelection {
  const includeSectionSeats = options?.includeSectionSeats ?? true;
  const blockLocked = options?.blockLocked ?? true;
  const blockSoldSeats = options?.blockSoldSeats ?? true;
  const preferSeatGroups = options?.preferSeatGroups ?? true;

  const objectIds: string[] = [];
  const seatIds: string[] = [];
  const seatGroupIds: string[] = [];
  const sectionIds: string[] = [];
  const seenObjects = new Set<string>();
  const seenSeats = new Set<string>();
  const seenSeatGroups = new Set<string>();
  const seenSections = new Set<string>();
  const warnings: string[] = [];
  let blocked = false;

  const items = expandObjectSelectionItems(getSelectableItems(selection), map.objects);

  for (const item of items) {
    if (item.type === 'object') {
      const object = map.objects.find((entry) => entry.id === item.id);
      if (!object) continue;
      if (object.locked && blockLocked) {
        blocked = true;
        warnings.push('A seleção contém objeto bloqueado.');
        continue;
      }
      addUnique(objectIds, seenObjects, object.id);
      continue;
    }

    if (item.type === 'section') {
      addUnique(sectionIds, seenSections, item.id);
      const object = map.objects.find((entry) => entry.sectionId === item.id && entry.type === 'SECTION');
      if (object) {
        if (object.locked && blockLocked) {
          blocked = true;
          warnings.push('A seleção contém setor bloqueado.');
        } else {
          addUnique(objectIds, seenObjects, object.id);
        }
      }

      if (includeSectionSeats) {
        for (const seat of map.seats.filter((entry) => entry.sectionId === item.id)) {
          if (seat.status === 'SOLD' && blockSoldSeats) {
            blocked = true;
            warnings.push('A seleção contém assento vendido.');
            continue;
          }
          if (seat.groupId && preferSeatGroups) {
            blocked = addSeatGroup(map, seat.groupId, seatGroupIds, seenSeatGroups, warnings, blockLocked) || blocked;
            continue;
          }
          addUnique(seatIds, seenSeats, seat.id);
        }
      }
      continue;
    }

    if (item.type === 'seat') {
      const seat = map.seats.find((entry) => entry.id === item.id);
      if (!seat) continue;
      if (seat.status === 'SOLD' && blockSoldSeats) {
        blocked = true;
        warnings.push('A seleção contém assento vendido.');
        continue;
      }
      if (seat.groupId && preferSeatGroups) {
        blocked = addSeatGroup(map, seat.groupId, seatGroupIds, seenSeatGroups, warnings, blockLocked) || blocked;
        removeFrom(seatIds, seenSeats, seat.id);
        continue;
      }
      addUnique(seatIds, seenSeats, seat.id);
      continue;
    }

    if (item.type === 'seatgroup') {
      const group = map.seatGroups?.find((entry) => entry.id === item.id);
      if (!group) continue;
      if (group.locked && blockLocked) {
        blocked = true;
        warnings.push('A seleção contém grupo de assentos bloqueado.');
        continue;
      }
      addUnique(seatGroupIds, seenSeatGroups, group.id);
      if (preferSeatGroups) {
        for (const seat of map.seats.filter((entry) => entry.groupId === group.id)) {
          removeFrom(seatIds, seenSeats, seat.id);
        }
      }
    }
  }

  return {
    selection: [
      ...objectIds.map((id) => ({ type: 'object' as const, id })),
      ...seatIds.map((id) => ({ type: 'seat' as const, id })),
      ...seatGroupIds.map((id) => ({ type: 'seatgroup' as const, id })),
    ],
    objectIds,
    seatIds,
    seatGroupIds,
    sectionIds,
    warnings,
    blocked,
  };
}
