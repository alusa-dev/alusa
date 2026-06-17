import type { EventMapDTO, EventMapSectionDTO, EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';
import type { MapSelection, MapSelectionItem } from './selection-utils.js';
import { getPrimarySelection, isItemSelected } from './selection-utils.js';

export type SeatedSectorContext = {
  section: EventMapSectionDTO;
  seatGroup: EventSeatGroupDTO;
  sectionObjectId: string | null;
};

export function getSeatGroupSectionId(group: EventSeatGroupDTO, seats: EventSeatDTO[]): string | null {
  const sectionIds = seats
    .filter((seat) => seat.groupId === group.id)
    .map((seat) => seat.sectionId)
    .filter((sectionId): sectionId is string => Boolean(sectionId));
  return sectionIds[0] ?? null;
}

export function findSeatGroupForSection(
  map: Pick<EventMapDTO, 'seatGroups' | 'seats'>,
  sectionId: string,
): EventSeatGroupDTO | null {
  for (const group of map.seatGroups ?? []) {
    if (getSeatGroupSectionId(group, map.seats) === sectionId) return group;
  }
  return null;
}

export function resolveSeatedSectorContext(
  map: EventMapDTO,
  item: MapSelectionItem,
): SeatedSectorContext | null {
  if (item.type === 'section') {
    const section = map.sections.find((entry) => entry.id === item.id);
    if (!section) return null;
    const seatGroup = findSeatGroupForSection(map, section.id);
    if (!seatGroup) return null;
    const sectionObject = map.objects.find((object) => object.type === 'SECTION' && object.sectionId === section.id);
    return { section, seatGroup, sectionObjectId: sectionObject?.id ?? null };
  }

  if (item.type === 'seatgroup') {
    const seatGroup = map.seatGroups?.find((group) => group.id === item.id);
    if (!seatGroup) return null;
    const sectionId = getSeatGroupSectionId(seatGroup, map.seats);
    if (!sectionId) return null;
    const section = map.sections.find((entry) => entry.id === sectionId);
    if (!section) return null;
    const sectionObject = map.objects.find((object) => object.type === 'SECTION' && object.sectionId === section.id);
    return { section, seatGroup, sectionObjectId: sectionObject?.id ?? null };
  }

  return null;
}

export function resolveSeatedSectorFromSelection(map: EventMapDTO, selection: MapSelection): SeatedSectorContext | null {
  const primary = getPrimarySelection(selection);
  if (!primary) return null;
  return resolveSeatedSectorContext(map, primary);
}

export function isSeatedSectorLayerSelected(map: EventMapDTO, selection: MapSelection, sectionId: string): boolean {
  if (isItemSelected(selection, { type: 'section', id: sectionId })) return true;
  const seatGroup = findSeatGroupForSection(map, sectionId);
  if (!seatGroup) return false;
  return isItemSelected(selection, { type: 'seatgroup', id: seatGroup.id });
}
