import type { EventMapDTO, EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';
import { getCorridorUnionGroups } from './corridor-union.js';

export type LevelRenderStackItem =
  | { kind: 'corridorUnion'; id: string; objectIds: string[]; sortOrder: number }
  | { kind: 'object'; id: string; sortOrder: number }
  | { kind: 'seatGroup'; id: string; sortOrder: number; sectionId: string | null }
  | { kind: 'seat'; id: string; sortOrder: number; sectionId: string | null };

function getSectionObjectById(objects: EventMapObjectDTO[]) {
  const bySectionId = new Map<string, EventMapObjectDTO>();
  for (const object of objects) {
    if (object.type === 'SECTION' && object.sectionId) {
      bySectionId.set(object.sectionId, object);
    }
  }
  return bySectionId;
}

function getSeatGroupSectionId(group: EventSeatGroupDTO, seats: EventSeatDTO[]) {
  const sectionIds = seats
    .filter((seat) => seat.groupId === group.id)
    .map((seat) => seat.sectionId)
    .filter((sectionId): sectionId is string => Boolean(sectionId));
  return sectionIds[0] ?? null;
}

function getSeatGroupSortOrder(
  group: EventSeatGroupDTO,
  seats: EventSeatDTO[],
  sectionObjects: Map<string, EventMapObjectDTO>,
) {
  const sectionId = getSeatGroupSectionId(group, seats);
  if (!sectionId) return 0;
  return sectionObjects.get(sectionId)?.sortOrder ?? 0;
}

function compareRenderStackItem(left: LevelRenderStackItem, right: LevelRenderStackItem) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  const priority: Record<LevelRenderStackItem['kind'], number> = {
    corridorUnion: 0,
    object: 1,
    seatGroup: 2,
    seat: 3,
  };
  if (priority[left.kind] !== priority[right.kind]) {
    return priority[left.kind] - priority[right.kind];
  }
  return left.id.localeCompare(right.id);
}

export function buildLevelRenderStack(map: EventMapDTO, levelId: string): LevelRenderStackItem[] {
  const levelObjects = map.objects.filter((object) => object.levelId === levelId && !object.hidden);
  const levelSeats = map.seats.filter((seat) => seat.levelId === levelId && seat.publicVisible);
  const levelSeatGroups = (map.seatGroups ?? []).filter((group) => group.levelId === levelId);
  const sectionObjects = getSectionObjectById(levelObjects);
  const groupedSeatIds = new Set(levelSeats.filter((seat) => seat.groupId != null).map((seat) => seat.id));
  const seatGroupSectionIds = new Set(
    levelSeatGroups
      .map((group) => getSeatGroupSectionId(group, levelSeats))
      .filter((sectionId): sectionId is string => Boolean(sectionId)),
  );
  const corridorUnionGroups = getCorridorUnionGroups(
    levelObjects.filter((object) => object.type === 'CORRIDOR'),
    1,
  ).filter((group) => group.objectIds.length >= 2);
  const corridorUnionObjectIds = new Set(corridorUnionGroups.flatMap((group) => group.objectIds));

  const items: LevelRenderStackItem[] = [];

  for (const group of corridorUnionGroups) {
    const sortOrder = Math.max(
      ...group.objectIds.map((objectId) => levelObjects.find((object) => object.id === objectId)?.sortOrder ?? 0),
    );
    items.push({ kind: 'corridorUnion', id: group.id, objectIds: group.objectIds, sortOrder });
  }

  for (const object of levelObjects) {
    if (object.type === 'SECTION' && object.sectionId && seatGroupSectionIds.has(object.sectionId)) {
      continue;
    }
    if (object.type === 'CORRIDOR' && corridorUnionObjectIds.has(object.id)) {
      items.push({ kind: 'object', id: object.id, sortOrder: object.sortOrder + 0.001 });
      continue;
    }
    items.push({ kind: 'object', id: object.id, sortOrder: object.sortOrder });
  }

  for (const group of levelSeatGroups) {
    const sectionId = getSeatGroupSectionId(group, levelSeats);
    items.push({
      kind: 'seatGroup',
      id: group.id,
      sectionId,
      sortOrder: getSeatGroupSortOrder(group, levelSeats, sectionObjects),
    });
  }

  for (const seat of levelSeats) {
    if (groupedSeatIds.has(seat.id)) continue;
    items.push({
      kind: 'seat',
      id: seat.id,
      sectionId: seat.sectionId,
      sortOrder: sectionObjects.get(seat.sectionId)?.sortOrder ?? 0,
    });
  }

  return items.sort(compareRenderStackItem);
}
