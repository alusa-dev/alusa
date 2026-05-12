import { GLOBAL_SEARCH_GROUP_LIMIT } from './constants';
import type { GlobalSearchGroupDTO, GlobalSearchItemDTO } from './dtos';

export type GlobalSearchRecentItem = GlobalSearchItemDTO & {
  visitedAt: string;
};

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function buildPresetSearchGroups(params: {
  query: string;
  role?: string | null;
  recentItems?: GlobalSearchRecentItem[];
}) {
  const groups: GlobalSearchGroupDTO[] = [];
  const query = params.query.trim();

  if (!query && params.recentItems?.length) {
    groups.push({
      key: 'recent',
      label: 'Recentes',
      total: Math.min(params.recentItems.length, GLOBAL_SEARCH_GROUP_LIMIT),
      items: params.recentItems
        .slice()
        .sort((left, right) => right.visitedAt.localeCompare(left.visitedAt))
        .slice(0, GLOBAL_SEARCH_GROUP_LIMIT)
        .map(({ visitedAt: _visitedAt, ...item }) => item),
    });
  }

  return groups;
}