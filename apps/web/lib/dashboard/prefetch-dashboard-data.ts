import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import {
  dashboardFinanceKpisResultDTOSchema,
  dashboardMetricsResultDTOSchema,
} from '@/features/dashboard/dtos';
import { runWithTenant } from '@/lib/prisma-tenant';

import { loadDashboardMetricsBody } from './load-dashboard-metrics';

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
    console.warn('[dashboard][prefetch] failed', {
      contaId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { metrics: null, financeKpis: null };
  }
}
