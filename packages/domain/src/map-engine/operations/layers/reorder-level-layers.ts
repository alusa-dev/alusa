import type { LevelPanelChildItem } from '../../doc/levels.js';
import type { EventMapDTO, EventMapObjectDTO } from '../../types/event-map-types.js';

export function reorderLevelPanelChildItems(
  items: LevelPanelChildItem[],
  fromIndex: number,
  toIndex: number,
): LevelPanelChildItem[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return items;
  next.splice(toIndex, 0, moved);
  return next;
}

export function buildLevelLayerSortOrderPatches(
  map: Pick<EventMapDTO, 'objects' | 'sections'>,
  orderedItems: LevelPanelChildItem[],
): {
  objects: Array<{ id: string; patch: Pick<EventMapObjectDTO, 'sortOrder'> }>;
  sections: Array<{ id: string; sortOrder: number }>;
} {
  const patches: Array<{ id: string; patch: Pick<EventMapObjectDTO, 'sortOrder'> }> = [];
  const sectionPatches: Array<{ id: string; sortOrder: number }> = [];
  const orderStride = map.objects.length + 1;

  orderedItems.forEach((item, index) => {
    const sortOrder = orderedItems.length - 1 - index;

    if (item.kind === 'section') {
      sectionPatches.push({ id: item.id, sortOrder: sortOrder * orderStride });
      const linkedObject = map.objects.find((object) => object.sectionId === item.id);
      if (linkedObject) {
        patches.push({ id: linkedObject.id, patch: { sortOrder: sortOrder * orderStride } });
      }
      return;
    }

    if (item.kind === 'object') {
      patches.push({ id: item.id, patch: { sortOrder: sortOrder * orderStride } });
      return;
    }

    const groupObjects = item.objectIds
      .map((id) => map.objects.find((object) => object.id === id))
      .filter((object): object is EventMapObjectDTO => Boolean(object))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    groupObjects.forEach((object, index) => {
      patches.push({ id: object.id, patch: { sortOrder: sortOrder * orderStride + index } });
    });
  });

  return { objects: patches, sections: sectionPatches };
}
