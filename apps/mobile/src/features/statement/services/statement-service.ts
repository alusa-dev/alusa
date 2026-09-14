import { authenticatedApi } from '@/features/auth/services/auth-service';
import type { StatementDirection, StatementPeriod, StatementResponse } from '../types/statement';

export const statementService = {
  get(input: {
    period: StatementPeriod;
    direction: StatementDirection;
    page?: number;
    pageSize?: number;
  }) {
    const params = new URLSearchParams({
      period: input.period,
      direction: input.direction,
      page: String(input.page ?? 1),
      pageSize: String(input.pageSize ?? 20),
    });

    return authenticatedApi.request<StatementResponse>({
      method: 'GET',
      path: `/api/mobile/financeiro/extrato?${params.toString()}`,
    });
  },
};
