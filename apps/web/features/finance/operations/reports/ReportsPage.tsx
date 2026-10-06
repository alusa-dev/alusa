'use client';

import { useMemo, useState } from 'react';

import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { Download, Refresh } from '@/components/icons/icons';
import { TableLayout } from '@/components/layout/TableLayout';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { Button } from '@/components/ui/button';
import { ExecutiveFinancialOverview } from './components/ExecutiveFinancialOverview';
import { DelinquencyDetailsTable, ReportDetailsDrawer, ReportDetailsTable } from './components/ReportDetails';
import { ReportsDataQualityNotice } from './components/ReportsDataQualityNotice';
import { ReportsFiltersBar } from './components/ReportsFiltersBar';
import { ReportsErrorState } from './components/ReportsStates';
import { useReportFilters } from './hooks/useReportFilters';
import { useReportsQuery } from './hooks/useReportsQuery';
import type { FinancialReportDetailItem } from './dtos';
import { nextReportSortDirection } from './utils/report-behavior';

export function ReportsPage() {
  const { filters, setFilters } = useReportFilters();
  const [selectedItem, setSelectedItem] = useState<FinancialReportDetailItem | null>(null);
  const overviewFilters = useMemo(
    () => ({
      ...filters,
      view: 'overview' as const,
      search: '',
      turmaId: undefined,
      planoId: undefined,
      chargeType: [],
      paymentMethod: [],
      status: [],
      origin: [],
      page: 1,
    }),
    [filters],
  );
  const queryFilters = useMemo(
    () => (filters.view === 'overview' ? overviewFilters : filters),
    [filters, overviewFilters],
  );
  const { data: selectedReport, loading, error, refresh, queryString } = useReportsQuery(queryFilters);
  const overview = selectedReport?.view === 'overview' ? selectedReport : null;
  const businessHealthFilters = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 89);
    return {
      ...overviewFilters,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      dateBasis: 'DUE_DATE' as const,
    };
  }, [overviewFilters]);
  const {
    data: businessHealthData,
    loading: businessHealthLoading,
    refresh: refreshBusinessHealth,
  } = useReportsQuery(businessHealthFilters);
  const businessHealth = businessHealthData?.view === 'overview' ? businessHealthData : null;
  const refreshAll = () => {
    refresh();
    refreshBusinessHealth();
  };
  const refreshing = loading || businessHealthLoading;

  const generatedLabel = useMemo(() => {
    if (!overview?.generatedAt) return 'Aguardando atualização';
    return `Atualizado em ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: overview.timeZone,
    }).format(new Date(overview.generatedAt))}`;
  }, [overview]);
  const reportError = error;

  return (
    <TableLayout
      title="Relatórios"
      subtitle="Acompanhe os recebimentos, identifique riscos e tome decisões com mais clareza."
      className="alusa-dashboard-page"
    >
      <div className="space-y-6">
        <section
          aria-label="Período e ações do relatório"
          className={`${DASHBOARD_SECTION_CARD_CLASSNAME} rounded-2xl bg-white p-4 alusa-dark:bg-[color:var(--color-bg-card)] lg:flex lg:items-end lg:justify-between lg:gap-6`}
        >
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              Filtros do relatório
            </p>
            <ReportsFiltersBar filters={filters} onChange={setFilters} />
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center lg:mt-0 lg:justify-end">
            <p className="text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              {generatedLabel}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={refreshAll} disabled={refreshing}>
                <Refresh className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                Atualizar
              </Button>
              <Button asChild={!loading && !reportError} size="sm" disabled={loading || Boolean(reportError)}>
                {!loading && !reportError ? (
                  <a
                    href={`/api/financeiro/relatorios/export?view=${filters.view}&${queryString}`}
                    download
                  >
                    <Download className="h-4 w-4" />
                    Exportar
                  </a>
                ) : (
                  <span aria-disabled="true">
                    <Download className="h-4 w-4" />
                    Exportar
                  </span>
                )}
              </Button>
            </div>
          </div>
        </section>

        {reportError ? (
          <ReportsErrorState message={reportError} onRetry={refreshAll} />
        ) : filters.view === 'overview' ? (
          <ExecutiveFinancialOverview
            data={overview}
            loading={loading}
            businessHealthData={businessHealth}
            businessHealthLoading={businessHealthLoading}
            periodData={overview}
            periodLoading={loading}
          />
        ) : selectedReport?.view === 'receipts' ? (
          <>
            <ReportsDataQualityNotice dataQuality={selectedReport.dataQuality} />
            <ReportDetailsTable
              data={selectedReport.details}
              loading={loading}
              timeZone={selectedReport.timeZone}
              receipts
              onPageChange={(page) => setFilters({ page })}
              onSortChange={(sort) =>
                setFilters({
                  sort,
                  direction: nextReportSortDirection(filters.sort, filters.direction, sort),
                })
              }
              sort={{ columnId: filters.sort, direction: filters.direction.toUpperCase() as 'ASC' | 'DESC' }}
              onSelect={setSelectedItem}
            />
            <ReportDetailsDrawer
              item={selectedItem}
              timeZone={selectedReport.timeZone}
              onClose={() => setSelectedItem(null)}
            />
          </>
        ) : selectedReport?.view === 'delinquency' ? (
          <>
            <ReportsDataQualityNotice dataQuality={selectedReport.dataQuality} />
            <DelinquencyDetailsTable
              data={selectedReport.details}
              loading={loading}
              timeZone={selectedReport.timeZone}
              onPageChange={(page) => setFilters({ page })}
            />
          </>
        ) : null}

        {filters.view === 'overview' && <ReportsDataQualityNotice dataQuality={overview?.dataQuality} />}

        <div className="flex justify-center pt-1">
          <AsaasSeal variant="negativo-preto" />
        </div>
      </div>
    </TableLayout>
  );
}
