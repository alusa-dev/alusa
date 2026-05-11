import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockGetDashboardFinanceKpisLocal = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getDashboardFinanceKpisLocal: mockGetDashboardFinanceKpisLocal,
}));

import { GET } from '@/app/api/dashboard/finance-kpis/route';

describe('GET /api/dashboard/finance-kpis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    });
  });

  it('retorna o KPI local do dashboard com contrato enxuto', async () => {
    mockGetDashboardFinanceKpisLocal.mockResolvedValue({
      aguardandoPagamentoProximos30Dias: {
        valorBruto: 275,
        quantidadeDeCobrancas: 2,
        janela: {
          inicio: '2026-05-01T03:00:00.000Z',
          fim: '2026-06-01T02:59:59.999Z',
        },
        origemDados: 'charge_read_model',
        escopo: 'unified',
        calculadoEm: '2026-05-10T12:00:00.000Z',
        projectedAt: '2026-05-10T11:59:00.000Z',
      },
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetDashboardFinanceKpisLocal).toHaveBeenCalledWith({ contaId: 'conta-1' });
    expect(json).toEqual({
      success: true,
      data: {
        aguardandoPagamentoProximos30Dias: {
          valorBruto: 275,
          quantidadeDeCobrancas: 2,
          janela: {
            inicio: '2026-05-01T03:00:00.000Z',
            fim: '2026-06-01T02:59:59.999Z',
          },
          origemDados: 'charge_read_model',
          escopo: 'unified',
          calculadoEm: '2026-05-10T12:00:00.000Z',
          projectedAt: '2026-05-10T11:59:00.000Z',
        },
      },
    });
  });
});