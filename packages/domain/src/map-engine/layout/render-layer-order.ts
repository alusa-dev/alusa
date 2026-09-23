import type { EventMapDTO, EventMapObjectDTO } from '../types/event-map-types.js';

export type LevelRenderStackItem =
  | { kind: 'object'; id: string; sortOrder: number }
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

function compareRenderStackItem(left: LevelRenderStackItem, right: LevelRenderStackItem) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  const priority: Record<LevelRenderStackItem['kind'], number> = {
    object: 0,
    seat: 1,
  };
  if (priority[left.kind] !== priority[right.kind]) {
    return priority[left.kind] - priority[right.kind];
  }
  return left.id.localeCompare(right.id);
}

export function buildLevelRenderStack(map: EventMapDTO, levelId: string): LevelRenderStackItem[] {
  const levelObjects = map.objects.filter((object) => object.levelId === levelId && !object.hidden);
  const levelSeats = map.seats.filter((seat) => seat.levelId === levelId && seat.publicVisible);
  const sectionObjects = getSectionObjectById(levelObjects);
  const items: LevelRenderStackItem[] = [];

  for (const object of levelObjects) {
    items.push({ kind: 'object', id: object.id, sortOrder: object.sortOrder });
  }

  for (const seat of levelSeats) {
    items.push({
      kind: 'seat',
      id: seat.id,
      sectionId: seat.sectionId,
      sortOrder: sectionObjects.get(seat.sectionId)?.sortOrder ?? 0,
    });
  }

  return items.sort(compareRenderStackItem);
}
