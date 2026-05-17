import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDashboardFinanceKpisLocal } from '../get-dashboard-finance-kpis-local';

const getOperationalChargesSummaryMock = vi.hoisted(() => vi.fn());
const getFinanceSummaryReadModelMock = vi.hoisted(() => vi.fn());

vi.mock('../list-operational-charges', () => ({
  getOperationalChargesSummary: getOperationalChargesSummaryMock,
}));

vi.mock('../../read-model/finance-summary-read-model.service', () => ({
  financeSummaryReadModelService: {
    getFinanceSummaryReadModel: getFinanceSummaryReadModelMock,
  },
}));

describe('getDashboardFinanceKpisLocal', () => {
  beforeEach(() => {
    delete process.env.FIN_SUMMARY_READMODEL_ENABLED;
    delete process.env.FIN_SUMMARY_SHADOW_COMPARE;
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

  it('usa snapshot financeiro quando FIN_SUMMARY_READMODEL_ENABLED=true', async () => {
    process.env.FIN_SUMMARY_READMODEL_ENABLED = 'true';
    getFinanceSummaryReadModelMock.mockResolvedValue({
      pendingAmountCurrentWindow: 300,
      pendingCountCurrentWindow: 3,
      projectedAt: new Date('2026-05-10T12:00:00.000Z'),
    });

    const result = await getDashboardFinanceKpisLocal({
      contaId: 'conta-1',
      now: new Date('2026-05-10T12:00:00.000Z'),
    });

    expect(getOperationalChargesSummaryMock).not.toHaveBeenCalled();
    expect(result.aguardandoPagamentoProximos30Dias).toMatchObject({
      valorBruto: 300,
      quantidadeDeCobrancas: 3,
      origemDados: 'charge_read_model',
      escopo: 'unified',
      projectedAt: '2026-05-10T12:00:00.000Z',
    });
  });
});
