'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  delinquencyReportDTOSchema,
  financialOverviewReportDTOSchema,
  receiptsReportDTOSchema,
  type DelinquencyReport,
  type FinancialOverviewReport,
  type ReceiptsReport,
} from '../dtos';
import type { ReportFiltersState } from './useReportFilters';

export type FinancialReportData =
  | FinancialOverviewReport
  | DelinquencyReport
  | ReceiptsReport;

function toQueryString(filters: ReportFiltersState) {
  const params = new URLSearchParams({
    startDate: filters.startDate,
    endDate: filters.endDate,
    dateBasis: filters.dateBasis,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    sort: filters.sort,
    direction: filters.direction,
  });
  if (filters.turmaId) params.set('turmaId', filters.turmaId);
  if (filters.planoId) params.set('planoId', filters.planoId);
  if (filters.chargeType.length) params.set('chargeType', filters.chargeType.join(','));
  if (filters.paymentMethod.length) params.set('paymentMethod', filters.paymentMethod.join(','));
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.origin.length) params.set('origin', filters.origin.join(','));
  if (filters.search) params.set('search', filters.search);
  return params.toString();
}

export function useReportsQuery(filters: ReportFiltersState) {
  const [data, setData] = useState<FinancialReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const queryString = useMemo(() => toQueryString(filters), [filters]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/financeiro/relatorios/${filters.view}?${queryString}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(
            body?.error === 'TURMA_INVALIDA' || body?.error === 'PLANO_INVALIDO'
              ? 'Um dos filtros selecionados não pertence à conta ativa.'
              : 'Não foi possível carregar este relatório.',
          );
        }
        const body: unknown = await response.json();
        if (filters.view === 'delinquency') return delinquencyReportDTOSchema.parse(body);
        if (filters.view === 'receipts') return receiptsReportDTOSchema.parse(body);
        return financialOverviewReportDTOSchema.parse(body);
      })
      .then(setData)
      .catch((reason) => {
        if ((reason as { name?: string }).name !== 'AbortError') {
          setError(reason instanceof Error ? reason.message : 'Não foi possível carregar este relatório.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters.view, queryString, refreshKey]);

  return { data, loading, error, refresh, queryString };
}
