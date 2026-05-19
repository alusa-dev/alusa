import type { DashboardFinanceKpisDataDTO, DashboardMetricsDataDTO } from '@/features/dashboard/dtos';

import type { DashboardPrefetchData } from './prefetch-dashboard-data';

export type SerializableDashboardPrefetch = {
  metrics: DashboardMetricsDataDTO | null;
  financeKpis: DashboardFinanceKpisDataDTO | null;
};

export function serializeDashboardPrefetch(
  data: DashboardPrefetchData,
): SerializableDashboardPrefetch {
  return {
    metrics: data.metrics?.success ? data.metrics.data : null,
    financeKpis: data.financeKpis?.success ? data.financeKpis.data : null,
  };
}
