import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import {
  dashboardFinanceKpisResultDTOSchema,
  dashboardMetricsResultDTOSchema,
} from '@/features/dashboard/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';

import { loadDashboardMetricsBody } from './load-dashboard-metrics';
import { logRuntimeOperationalEvent } from '@/lib/observability/runtime-operational-log';

export type DashboardPrefetchData = {
  metrics: ReturnType<typeof dashboardMetricsResultDTOSchema.parse> | null;
  financeKpis: ReturnType<typeof dashboardFinanceKpisResultDTOSchema.parse> | null;
};

export async function prefetchDashboardData(contaId: string): Promise<DashboardPrefetchData> {
  try {
    const [metrics, financeSnapshot] = await Promise.all([
      loadDashboardMetricsBody(contaId),
      runWithTenant(contaId, (tx) => getDashboardFinanceKpisLocal({ contaId, db: tx })),
    ]);

    const financeKpis = dashboardFinanceKpisResultDTOSchema.parse({
      success: true,
      data: financeSnapshot,
    });

    return {
      metrics: dashboardMetricsResultDTOSchema.parse(metrics),
      financeKpis,
    };
  } catch (error) {
    logRuntimeOperationalEvent({ eventName: 'dashboard.prefetch.failed', error, severity: 'warn' });
    return { metrics: null, financeKpis: null };
  }
}
