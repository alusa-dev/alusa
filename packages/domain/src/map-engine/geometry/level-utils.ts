import type { EventMapLevelDTO, EventMapObjectDTO } from '../types/event-map-types.js';

import { getObjectGroupId, getObjectGroupLabel } from '../layout/object-groups.js';

export const PLATEIA_LEVEL_NAME = 'Ambiente 1';
const LEGACY_PLATEIA_LEVEL_NAMES = new Set(['Plano de fundo', 'Plateia']);
export const PLATEIA_BASE_SORT_ORDER = 0;
export const MAP_AREA_WIDTH_PX = 1440;
export const MAP_AREA_HEIGHT_PX = 900;

export function isPlateiaBaseLevel(level: Pick<EventMapLevelDTO, 'sortOrder'>) {
  return level.sortOrder === PLATEIA_BASE_SORT_ORDER;
}

function normalizeBaseLevelName(name: string) {
  const trimmed = name.trim();
  return trimmed && !LEGACY_PLATEIA_LEVEL_NAMES.has(trimmed) ? trimmed : PLATEIA_LEVEL_NAME;
}

export function normalizeMapLevels(levels: EventMapLevelDTO[]): EventMapLevelDTO[] {
  const baseLevels = levels.filter(isPlateiaBaseLevel);
  const otherLevels = levels.filter((level) => !isPlateiaBaseLevel(level));

  const normalizedOthers = otherLevels
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'pt-BR'))
    .map((level, index) => ({
      ...level,
      sortOrder: index + 1,
      widthPx: MAP_AREA_WIDTH_PX,
      heightPx: MAP_AREA_HEIGHT_PX,
      unit: 'px',
    }));

  const normalizedBase = baseLevels.map((level) => ({
    ...level,
    sortOrder: PLATEIA_BASE_SORT_ORDER,
    name: normalizeBaseLevelName(level.name),
    widthPx: MAP_AREA_WIDTH_PX,
    heightPx: MAP_AREA_HEIGHT_PX,
    unit: 'px',
  }));

  if (normalizedBase.length === 0 && normalizedOthers.length > 0) {
    const [first, ...rest] = normalizedOthers;
    return [
      {
        ...first,
        sortOrder: PLATEIA_BASE_SORT_ORDER,
        name: normalizeBaseLevelName(first.name),
        widthPx: MAP_AREA_WIDTH_PX,
        heightPx: MAP_AREA_HEIGHT_PX,
        unit: 'px',
      },
      ...rest.map((level, index) => ({ ...level, sortOrder: index + 1 })),
    ];
  }

  return [...normalizedOthers, ...normalizedBase];
}

export function sortLevelsForPanel(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const baseLevels = normalized.filter(isPlateiaBaseLevel);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));

  return [...otherLevels.sort((left, right) => right.sortOrder - left.sortOrder), ...baseLevels];
}

export function getNextLevelSortOrder(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const highest = normalized.reduce((max, level) => Math.max(max, level.sortOrder), PLATEIA_BASE_SORT_ORDER);
  return highest + 1;
}

export type LevelPanelChildItem =
  | { kind: 'section'; id: string; sortOrder: number }
  | { kind: 'object'; id: string; sortOrder: number }
  | { kind: 'group'; id: string; sortOrder: number; objectIds: string[]; label: string };

export function sortLevelPanelChildren(
  sections: Array<{ id: string; levelId: string }>,
  objects: EventMapObjectDTO[],
  levelId: string,
) {
  const levelObjects = objects.filter((object) => object.levelId === levelId && !object.sectionId);
  const groupedObjectIds = new Set<string>();
  const groupItems: LevelPanelChildItem[] = [];
  const groups = new Map<string, { objectIds: string[]; sortOrder: number; label: string }>();

  for (const object of levelObjects) {
    const groupId = getObjectGroupId(object);
    if (!groupId) continue;

    const current = groups.get(groupId) ?? {
      objectIds: [],
      sortOrder: object.sortOrder,
      label: getObjectGroupLabel(object) ?? 'Grupo 01',
    };
    current.objectIds.push(object.id);
    current.sortOrder = Math.max(current.sortOrder, object.sortOrder);
    groups.set(groupId, current);
  }

  for (const [groupId, group] of groups) {
    for (const objectId of group.objectIds) groupedObjectIds.add(objectId);
    groupItems.push({
      kind: 'group',
      id: groupId,
      sortOrder: group.sortOrder,
      objectIds: group.objectIds,
      label: group.label,
    });
  }

  const items: LevelPanelChildItem[] = [
    ...sections
      .filter((section) => section.levelId === levelId)
      .map((section) => {
        const linkedObject = objects.find((object) => object.sectionId === section.id);
        return { kind: 'section' as const, id: section.id, sortOrder: linkedObject?.sortOrder ?? 0 };
      }),
    ...groupItems,
    ...levelObjects
      .filter((object) => !groupedObjectIds.has(object.id))
      .map((object) => ({ kind: 'object' as const, id: object.id, sortOrder: object.sortOrder })),
  ];

  return items.sort((left, right) => right.sortOrder - left.sortOrder);
}
