'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { FinancialReportQuery, FinancialReportView } from '../dtos';

export type ReportFiltersState = FinancialReportQuery & { view: FinancialReportView };

export function getCurrentMonthRange(now = new Date()) {
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const month = String(monthIndex + 1).padStart(2, '0');
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(new Date(year, monthIndex + 1, 0).getDate()).padStart(2, '0')}`,
  };
}

export function normalizeCivilDate(value: string | null, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? value
    : fallback;
}

function parseList(value: string | null) {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
}

export function useReportFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const month = useMemo(getCurrentMonthRange, []);

  const filters = useMemo<ReportFiltersState>(() => {
    const view = (searchParams.get('view') ?? 'overview') as FinancialReportView;
    const dateBasis =
      searchParams.get('dateBasis') ??
      (view === 'receipts' ? 'PAID_AT' : 'DUE_DATE');
    return {
      view,
      startDate: normalizeCivilDate(searchParams.get('startDate'), month.startDate),
      endDate: normalizeCivilDate(searchParams.get('endDate'), month.endDate),
      dateBasis: dateBasis as FinancialReportQuery['dateBasis'],
      turmaId: searchParams.get('turmaId') ?? undefined,
      planoId: searchParams.get('planoId') ?? undefined,
      chargeType: parseList(searchParams.get('chargeType')),
      paymentMethod: parseList(searchParams.get('paymentMethod')),
      status: parseList(searchParams.get('status')) as FinancialReportQuery['status'],
      origin: parseList(searchParams.get('origin')) as FinancialReportQuery['origin'],
      search: searchParams.get('search') ?? '',
      page: Math.max(1, Number(searchParams.get('page') ?? 1)),
      pageSize: Math.min(50, Math.max(1, Number(searchParams.get('pageSize') ?? 20))),
      sort: (searchParams.get('sort') ?? (view === 'receipts' ? 'paidAt' : 'dueDate')) as FinancialReportQuery['sort'],
      direction: (searchParams.get('direction') ?? 'desc') as 'asc' | 'desc',
    };
  }, [month.endDate, month.startDate, searchParams]);

  const replace = useCallback(
    (next: ReportFiltersState) => {
      const params = new URLSearchParams();
      params.set('view', next.view);
      params.set('startDate', next.startDate);
      params.set('endDate', next.endDate);
      params.set('dateBasis', next.dateBasis);
      if (next.turmaId) params.set('turmaId', next.turmaId);
      if (next.planoId) params.set('planoId', next.planoId);
      if (next.chargeType.length) params.set('chargeType', next.chargeType.join(','));
      if (next.paymentMethod.length) params.set('paymentMethod', next.paymentMethod.join(','));
      if (next.status.length) params.set('status', next.status.join(','));
      if (next.origin.length) params.set('origin', next.origin.join(','));
      if (next.search) params.set('search', next.search);
      if (next.page > 1) params.set('page', String(next.page));
      if (next.pageSize !== 20) params.set('pageSize', String(next.pageSize));
      if (next.sort !== (next.view === 'receipts' ? 'paidAt' : 'dueDate')) params.set('sort', next.sort);
      if (next.direction !== 'desc') params.set('direction', next.direction);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router],
  );

  const setFilters = useCallback(
    (patch: Partial<ReportFiltersState>) => {
      const view = patch.view ?? filters.view;
      const changedView = patch.view && patch.view !== filters.view;
      replace({
        ...filters,
        ...patch,
        view,
        page: patch.page ?? (Object.keys(patch).length ? 1 : filters.page),
        dateBasis: changedView
          ? view === 'receipts'
            ? 'PAID_AT'
            : 'DUE_DATE'
          : (patch.dateBasis ?? filters.dateBasis),
        sort: changedView
          ? view === 'receipts'
            ? 'paidAt'
            : 'dueDate'
          : (patch.sort ?? filters.sort),
      });
    },
    [filters, replace],
  );

  const clearFilters = useCallback(() => {
    replace({
      ...filters,
      startDate: month.startDate,
      endDate: month.endDate,
      dateBasis: filters.view === 'receipts' ? 'PAID_AT' : 'DUE_DATE',
      turmaId: undefined,
      planoId: undefined,
      chargeType: [],
      paymentMethod: [],
      status: [],
      origin: [],
      search: '',
      page: 1,
      pageSize: 20,
      sort: filters.view === 'receipts' ? 'paidAt' : 'dueDate',
      direction: 'desc',
    });
  }, [filters, month.endDate, month.startDate, replace]);

  return { filters, setFilters, clearFilters };
}
