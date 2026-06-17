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
  map: Pick<EventMapDTO, 'objects'>,
  orderedItems: LevelPanelChildItem[],
): Array<{ id: string; patch: Pick<EventMapObjectDTO, 'sortOrder'> }> {
  const patches: Array<{ id: string; patch: Pick<EventMapObjectDTO, 'sortOrder'> }> = [];

  orderedItems.forEach((item, index) => {
    const sortOrder = orderedItems.length - 1 - index;

    if (item.kind === 'section') {
      const linkedObject = map.objects.find((object) => object.sectionId === item.id);
      if (linkedObject) {
        patches.push({ id: linkedObject.id, patch: { sortOrder } });
      }
      return;
    }

    if (item.kind === 'object') {
      patches.push({ id: item.id, patch: { sortOrder } });
      return;
    }

    for (const objectId of item.objectIds) {
      patches.push({ id: objectId, patch: { sortOrder } });
    }
  });

  return patches;
}
