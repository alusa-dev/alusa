/** Prefixos de query key invalidados após webhooks de cobrança. */
export const financeRealtimeQueryKeys = {
  dashboard: ['dashboard'] as const,
  dashboardMetrics: ['dashboard', 'metrics'] as const,
  dashboardFinanceKpis: ['dashboard', 'finance-kpis'] as const,
  cobranca: ['cobranca'] as const,
  cobrancaDetail: (id: string) => ['cobranca', id] as const,
  financeiro: ['financeiro'] as const,
  portal: ['portal'] as const,
  extrato: ['extrato'] as const,
};
