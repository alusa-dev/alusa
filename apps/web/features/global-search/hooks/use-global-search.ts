'use client';

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { GLOBAL_SEARCH_MIN_QUERY_LENGTH } from '../constants';
import type { GlobalSearchGroupDTO, GlobalSearchItemDTO } from '../dtos';
import { buildPresetSearchGroups } from '../presets';
import { fetchGlobalSearch } from '../services/search-service';
import { useGlobalSearchRecents } from './use-global-search-recents';

type UseGlobalSearchParams = {
  role?: string | null;
};

export function useGlobalSearch(params: UseGlobalSearchParams) {
  const role = params.role ?? null;
  const { items: recentItems, addRecentItem, clearRecentItems } = useGlobalSearchRecents();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GlobalSearchGroupDTO[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const deferredQuery = useDeferredValue(query);

  const presetGroups = useMemo(
    () => buildPresetSearchGroups({ query: deferredQuery, role, recentItems }),
    [deferredQuery, recentItems, role],
  );

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();
    if (trimmedQuery.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setLoading(false);
      setError(null);
      startTransition(() => {
        setGroups(presetGroups);
      });
      return undefined;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await fetchGlobalSearch(trimmedQuery, controller.signal);
        startTransition(() => {
          setGroups(result.groups);
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Não foi possível carregar a busca.');
        startTransition(() => {
          setGroups(presetGroups);
        });
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [deferredQuery, presetGroups]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const selectItem = useCallback(
    (item: GlobalSearchItemDTO) => {
      addRecentItem(item);
      setOpen(false);
      setQuery('');
      setError(null);
    },
    [addRecentItem],
  );

  return {
    query,
    setQuery,
    open,
    setOpen,
    loading,
    error,
    groups,
    items,
    selectItem,
    clearRecentItems,
  };
}