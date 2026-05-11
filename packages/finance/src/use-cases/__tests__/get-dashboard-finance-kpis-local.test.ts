import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDashboardFinanceKpisLocal } from '../get-dashboard-finance-kpis-local';

const getOperationalChargesSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('../list-operational-charges', () => ({
  getOperationalChargesSummary: getOperationalChargesSummaryMock,
}));

describe('getDashboardFinanceKpisLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa o mesmo resumo da fila operacional da página Todas as Cobranças', async () => {
    getOperationalChargesSummaryMock.mockResolvedValue({
      valorBruto: 485,
      total: 5,
    });

    const result = await getDashboardFinanceKpisLocal({
      contaId: 'conta-1',
      now: new Date('2026-05-10T12:00:00.000Z'),
    });

    expect(getOperationalChargesSummaryMock).toHaveBeenCalledWith({
      contaId: 'conta-1',
      now: new Date('2026-05-10T12:00:00.000Z'),
    });
    expect(result.aguardandoPagamentoProximos30Dias).toMatchObject({
      valorBruto: 485,
      quantidadeDeCobrancas: 5,
      origemDados: 'operational_queue',
      escopo: 'operational_queue',
      projectedAt: null,
    });
  });
});