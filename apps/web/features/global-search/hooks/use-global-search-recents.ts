'use client';

import { useCallback, useEffect, useState } from 'react';

import type { GlobalSearchItemDTO } from '../dtos';
import type { GlobalSearchRecentItem } from '../presets';

const STORAGE_KEY = 'alusa.global-search.recent-items';
const MAX_RECENT_ITEMS = 6;

function parseRecentItems(raw: string | null): GlobalSearchRecentItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Array<GlobalSearchRecentItem>;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GlobalSearchRecentItem =>
        Boolean(
          item &&
            typeof item.id === 'string' &&
            typeof item.title === 'string' &&
            typeof item.href === 'string' &&
            typeof item.visitedAt === 'string',
        ),
    );
  } catch {
    return [];
  }
}

export function useGlobalSearchRecents() {
  const [items, setItems] = useState<GlobalSearchRecentItem[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setItems(parseRecentItems(window.localStorage.getItem(STORAGE_KEY)));
  }, []);

  const persist = useCallback((nextItems: GlobalSearchRecentItem[]) => {
    setItems(nextItems);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextItems));
    }
  }, []);

  const addRecentItem = useCallback(
    (item: GlobalSearchItemDTO) => {
      const recentItem: GlobalSearchRecentItem = {
        ...item,
        visitedAt: new Date().toISOString(),
      };

      const deduped = [recentItem, ...items.filter((entry) => entry.href !== item.href)].slice(
        0,
        MAX_RECENT_ITEMS,
      );

      persist(deduped);
    },
    [items, persist],
  );

  const clearRecentItems = useCallback(() => {
    setItems([]);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return {
    items,
    addRecentItem,
    clearRecentItems,
  };
}