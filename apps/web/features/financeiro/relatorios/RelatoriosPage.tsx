'use client';

import { useMemo } from 'react';

import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { Download, Refresh } from '@/components/icons/icons';
import { TableLayout } from '@/components/layout/TableLayout';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { Button } from '@/components/ui/button';
import { ExecutiveFinancialOverview } from './components/ExecutiveFinancialOverview';
import { ReportsDataQualityNotice } from './components/ReportsDataQualityNotice';
import { ReportsFiltersBar } from './components/ReportsFiltersBar';
import { ReportsErrorState } from './components/ReportsStates';
import { useReportFilters } from './hooks/useReportFilters';
import { useReportsQuery } from './hooks/useReportsQuery';

export function RelatoriosPage() {
  const { filters, setFilters } = useReportFilters();
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
  const { data, loading, error, refresh, queryString } = useReportsQuery(overviewFilters);
  const overview = data?.view === 'overview' ? data : null;
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
  const annualEnrollmentFilters = useMemo(() => {
    const end = new Date();
    return {
      ...overviewFilters,
      startDate: `${end.getUTCFullYear()}-01-01`,
      endDate: end.toISOString().slice(0, 10),
      dateBasis: 'DUE_DATE' as const,
    };
  }, [overviewFilters]);
  const {
    data: annualEnrollmentData,
    loading: annualEnrollmentLoading,
    refresh: refreshAnnualEnrollment,
  } = useReportsQuery(annualEnrollmentFilters);
  const annualEnrollment = annualEnrollmentData?.view === 'overview' ? annualEnrollmentData : null;
  const refreshAll = () => {
    refresh();
    refreshBusinessHealth();
    refreshAnnualEnrollment();
  };
  const refreshing = loading || businessHealthLoading || annualEnrollmentLoading;

  const generatedLabel = useMemo(() => {
    if (!overview?.generatedAt) return 'Aguardando atualização';
    return `Atualizado em ${new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: overview.timeZone,
    }).format(new Date(overview.generatedAt))}`;
  }, [overview]);

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
            <ReportsFiltersBar filters={overviewFilters} onChange={setFilters} />
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
              <Button asChild={!loading && !error} size="sm" disabled={loading || Boolean(error)}>
                {!loading && !error ? (
                  <a
                    href={`/api/financeiro/relatorios/export?view=overview&${queryString}`}
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

        {error ? (
          <ReportsErrorState message={error} onRetry={refreshAll} />
        ) : (
          <ExecutiveFinancialOverview
            data={overview}
            loading={loading}
            businessHealthData={businessHealth}
            businessHealthLoading={businessHealthLoading}
            annualEnrollmentData={annualEnrollment}
            annualEnrollmentLoading={annualEnrollmentLoading}
          />
        )}

        <ReportsDataQualityNotice dataQuality={overview?.dataQuality} />

        <div className="flex justify-center pt-1">
          <AsaasSeal variant="negativo-preto" />
        </div>
      </div>
    </TableLayout>
  );
}
