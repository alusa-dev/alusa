import { authenticatedApi } from '@/features/auth/services/auth-service';
import type { ReportPeriod, ReportResponse } from '../types/report';

export const reportService = {
  get(period: ReportPeriod) {
    const params = new URLSearchParams({ period });
    return authenticatedApi.request<ReportResponse>({
      method: 'GET',
      path: `/api/mobile/financeiro/relatorio?${params.toString()}`,
    });
  },
};
