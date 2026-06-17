import {
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
  sortLevelsForPanel,
  type EventMapLevelDTO,
} from '@alusa/domain';

export type PublicMapLevelView = Pick<EventMapLevelDTO, 'id' | 'name' | 'sortOrder' | 'widthPx' | 'heightPx'>;

const FALLBACK_LEVEL: PublicMapLevelView = {
  id: 'fallback',
  name: 'Ambiente principal',
  sortOrder: 0,
  widthPx: MAP_AREA_WIDTH_PX,
  heightPx: MAP_AREA_HEIGHT_PX,
};

export function resolvePublicMapLevels(levels: PublicMapLevelView[]): PublicMapLevelView[] {
  if (levels.length === 0) return [FALLBACK_LEVEL];
  return sortLevelsForPanel(levels as EventMapLevelDTO[]) as PublicMapLevelView[];
}

export function getDefaultPublicMapLevelId(levels: PublicMapLevelView[]): string {
  return resolvePublicMapLevels(levels)[0]?.id ?? FALLBACK_LEVEL.id;
}

export function getPublicMapLevelById(levels: PublicMapLevelView[], levelId: string | null): PublicMapLevelView {
  const sorted = resolvePublicMapLevels(levels);
  return sorted.find((level) => level.id === levelId) ?? sorted[0] ?? FALLBACK_LEVEL;
}

export function filterPublicMapObjectsByLevel<T extends { levelId?: string | null; hidden?: boolean }>(
  objects: T[],
  levelId: string,
): T[] {
  return objects.filter((object) => object.levelId === levelId && !object.hidden);
}

export function filterPublicMapSeatsByLevel<T extends { levelId?: string | null }>(seats: T[], levelId: string): T[] {
  return seats.filter((seat) => seat.levelId === levelId);
}

type PublicMapRenderableSource = {
  seatGroups?: Array<{ id: string }>;
  seats: Array<{ groupId?: string | null; sectionId?: string | null }>;
};

export function filterPublicMapRenderableObjects<
  T extends { levelId?: string | null; hidden?: boolean; type?: string; sectionId?: string | null },
>(map: PublicMapRenderableSource, objects: T[], levelId: string): T[] {
  const groupedSectionIds = new Set(
    map.seats
      .filter((seat) => seat.groupId && seat.sectionId)
      .map((seat) => seat.sectionId as string),
  );

  return filterPublicMapObjectsByLevel(objects, levelId).filter((object) => {
    if (object.type !== 'SECTION' || !object.sectionId) return true;
    return !groupedSectionIds.has(object.sectionId);
  });
}
