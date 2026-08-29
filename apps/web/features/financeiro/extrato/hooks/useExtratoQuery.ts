'use client';

import { useState } from 'react';
import type { ExtratoResponse } from '../dtos';
import type { ExtratoFiltersState } from './useExtratoFilters';
import { fetchExtrato } from '../services/get-extrato';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';

const REFRESH_INTERVAL = 30_000;

export function useExtratoQuery(filters: ExtratoFiltersState) {
  const [data, setData] = useState<ExtratoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterDependencyKey = [
    filters.startDate,
    filters.endDate,
    filters.type.join(','),
    filters.status.join(','),
    filters.search,
    filters.page,
    filters.pageSize,
    filters.sort,
    filters.direction,
  ].join('|');

  const { isInitialLoading, isRefreshing, refresh } = useFinanceListLoad(
    async ({ signal }) => {
      const result = await fetchExtrato(
        {
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
          type: filters.type.length > 0 ? filters.type : undefined,
          status: filters.status.length > 0 ? filters.status : undefined,
          search: filters.search || undefined,
          page: filters.page,
          pageSize: filters.pageSize,
          sort: filters.sort,
          direction: filters.direction,
        },
        { signal },
      );
      if (signal.aborted) return;
      setData(result);
      setError(null);
    },
    {
      deps: [filterDependencyKey],
      intervalMs: REFRESH_INTERVAL,
      minIntervalMs: 8_000,
    },
  );

  return {
    data,
    loading: isInitialLoading,
    isRefreshing,
    error,
    refetch: refresh,
  };
}
