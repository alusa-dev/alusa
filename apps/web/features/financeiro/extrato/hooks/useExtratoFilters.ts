'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { ExtratoQueryInput, LedgerEntryStatus, LedgerEntryType } from '../dtos';

export interface ExtratoFiltersState {
  startDate: string;
  endDate: string;
  type: LedgerEntryType[];
  status: LedgerEntryStatus[];
  search: string;
  page: number;
  pageSize: number;
  sort: ExtratoQueryInput['sort'];
  direction: ExtratoQueryInput['direction'];
}

const DEFAULTS: ExtratoFiltersState = {
  startDate: '',
  endDate: '',
  type: [],
  status: [],
  search: '',
  page: 1,
  pageSize: 20,
  sort: 'date',
  direction: 'desc',
};

function parseFiltersFromParams(params: URLSearchParams): ExtratoFiltersState {
  return {
    startDate: params.get('startDate') ?? '',
    endDate: params.get('endDate') ?? '',
    type: (params.get('type')?.split(',').filter(Boolean) as LedgerEntryType[] | undefined) ?? [],
    status:
      (params.get('status')?.split(',').filter(Boolean) as LedgerEntryStatus[] | undefined) ?? [],
    search: params.get('search') ?? '',
    page: Math.max(1, Number(params.get('page') ?? 1)),
    pageSize: Math.max(1, Math.min(100, Number(params.get('pageSize') ?? 20))),
    sort: (params.get('sort') ?? 'date') as ExtratoQueryInput['sort'],
    direction: (params.get('direction') ?? 'desc') as ExtratoQueryInput['direction'],
  };
}

function filtersToParams(filters: ExtratoFiltersState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.type.length > 0) params.set('type', filters.type.join(','));
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.search) params.set('search', filters.search);
  if (filters.page > 1) params.set('page', String(filters.page));
  if (filters.pageSize !== 20) params.set('pageSize', String(filters.pageSize));
  if (filters.sort !== 'date') params.set('sort', filters.sort);
  if (filters.direction !== 'desc') params.set('direction', filters.direction);

  return params;
}

export function useExtratoFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(() => parseFiltersFromParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (patch: Partial<ExtratoFiltersState>) => {
      const next = { ...filters, ...patch };
      const params = filtersToParams(next);
      const debugFixture = searchParams.get('debugFixture');
      if (debugFixture) params.set('debugFixture', debugFixture);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [filters, router, pathname, searchParams],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    const debugFixture = searchParams.get('debugFixture');
    if (debugFixture) params.set('debugFixture', debugFixture);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname, searchParams]);

  return { filters, setFilters, clearFilters };
}
