import type { EventMapLevelDTO, EventMapObjectDTO } from '../types/event-map-types.js';

import { getObjectGroupId, getObjectGroupLabel } from '../layout/object-groups.js';

export const PLATEIA_LEVEL_NAME = 'Ambiente 1';
const LEGACY_PLATEIA_LEVEL_NAMES = new Set(['Plano de fundo', 'Plateia']);
export const PLATEIA_BASE_SORT_ORDER = 0;
export const MAP_AREA_WIDTH_PX = 1440;
export const MAP_AREA_HEIGHT_PX = 900;
export const MAP_ARTBOARD_STROKE = '#94a3b8';
export const MAP_ARTBOARD_STROKE_WIDTH = 1;
export const MAP_AREA_MIN_WIDTH_PX = 320;
export const MAP_AREA_MIN_HEIGHT_PX = 240;
export const MAP_AREA_MAX_WIDTH_PX = 20000;
export const MAP_AREA_MAX_HEIGHT_PX = 20000;

export type ArtboardOrientation = 'landscape' | 'portrait';

export function clampArtboardWidth(widthPx: number) {
  return Math.min(MAP_AREA_MAX_WIDTH_PX, Math.max(MAP_AREA_MIN_WIDTH_PX, Math.round(widthPx)));
}

export function clampArtboardHeight(heightPx: number) {
  return Math.min(MAP_AREA_MAX_HEIGHT_PX, Math.max(MAP_AREA_MIN_HEIGHT_PX, Math.round(heightPx)));
}

export function normalizeArtboardDimensions(widthPx: number, heightPx: number) {
  return {
    widthPx: clampArtboardWidth(widthPx),
    heightPx: clampArtboardHeight(heightPx),
  };
}

export function resolveLevelArtboardSize(level: Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>) {
  const rawWidth = Number.isFinite(level.widthPx) && level.widthPx > 0 ? level.widthPx : MAP_AREA_WIDTH_PX;
  const rawHeight = Number.isFinite(level.heightPx) && level.heightPx > 0 ? level.heightPx : MAP_AREA_HEIGHT_PX;
  return normalizeArtboardDimensions(rawWidth, rawHeight);
}

export function getArtboardOrientation(level: Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>): ArtboardOrientation {
  return level.widthPx >= level.heightPx ? 'landscape' : 'portrait';
}

export function swapArtboardOrientation(level: Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>) {
  return normalizeArtboardDimensions(level.heightPx, level.widthPx);
}

export function applyArtboardOrientation(
  level: Pick<EventMapLevelDTO, 'widthPx' | 'heightPx'>,
  orientation: ArtboardOrientation,
) {
  const current = getArtboardOrientation(level);
  if (current === orientation) {
    return resolveLevelArtboardSize(level);
  }
  return swapArtboardOrientation(level);
}

function withNormalizedArtboard<T extends EventMapLevelDTO>(level: T): T {
  const { widthPx, heightPx } = resolveLevelArtboardSize(level);
  return {
    ...level,
    widthPx,
    heightPx,
    unit: 'px',
  };
}

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
    .map((level, index) => withNormalizedArtboard({
      ...level,
      sortOrder: index + 1,
    }));

  const normalizedBase = baseLevels.map((level) => withNormalizedArtboard({
    ...level,
    sortOrder: PLATEIA_BASE_SORT_ORDER,
    name: normalizeBaseLevelName(level.name),
  }));

  if (normalizedBase.length === 0 && normalizedOthers.length > 0) {
    const [first, ...rest] = normalizedOthers;
    return [
      withNormalizedArtboard({
        ...first,
        sortOrder: PLATEIA_BASE_SORT_ORDER,
        name: normalizeBaseLevelName(first.name),
      }),
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
