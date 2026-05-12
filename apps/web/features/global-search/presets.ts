import {
  actionItems,
  GLOBAL_SEARCH_GROUP_LIMIT,
  navigationItems,
  type SearchPresetItem,
} from './constants';
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

function createGroup(key: string, label: string, items: GlobalSearchItemDTO[]): GlobalSearchGroupDTO | null {
  if (items.length === 0) return null;
  return {
    key,
    label,
    total: items.length,
    items,
  };
}

function rankPresetItem(item: SearchPresetItem, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const title = normalizeSearchText(item.title);
  const description = normalizeSearchText(item.description);
  const keywords = item.keywords.map(normalizeSearchText);

  if (title === normalizedQuery) return 120;
  if (keywords.includes(normalizedQuery)) return 110;
  if (title.startsWith(normalizedQuery)) return 100;
  if (keywords.some((keyword) => keyword.startsWith(normalizedQuery))) return 90;
  if (title.includes(normalizedQuery)) return 80;
  if (description.includes(normalizedQuery)) return 70;
  if (keywords.some((keyword) => keyword.includes(normalizedQuery))) return 60;
  return 0;
}

function mapPresetItems(
  items: SearchPresetItem[],
  query: string,
  role: string | null,
  type: 'navigation' | 'action',
) {
  const visibleItems = items.filter(
    (item) => !item.roles || (role ? item.roles.includes(role) : false),
  );

  if (!query.trim()) {
    return visibleItems.slice(0, GLOBAL_SEARCH_GROUP_LIMIT).map((item) => ({
      type,
      id: item.id,
      title: item.title,
      description: item.description,
      href: item.href,
    } satisfies GlobalSearchItemDTO));
  }

  return visibleItems
    .map((item) => ({ item, score: rankPresetItem(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
    .slice(0, GLOBAL_SEARCH_GROUP_LIMIT)
    .map(({ item }) => ({
      type,
      id: item.id,
      title: item.title,
      description: item.description,
      href: item.href,
    } satisfies GlobalSearchItemDTO));
}

export function buildPresetSearchGroups(params: {
  query: string;
  role?: string | null;
  recentItems?: GlobalSearchRecentItem[];
}) {
  const normalizedRole = params.role?.trim().toUpperCase() ?? null;
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

  const navigationGroup = createGroup(
    'navigation',
    'Navegação',
    mapPresetItems(navigationItems, query, normalizedRole, 'navigation'),
  );
  const actionGroup = createGroup(
    'actions',
    'Ações rápidas',
    mapPresetItems(actionItems, query, normalizedRole, 'action'),
  );

  if (navigationGroup) groups.push(navigationGroup);
  if (actionGroup) groups.push(actionGroup);

  return groups;
}