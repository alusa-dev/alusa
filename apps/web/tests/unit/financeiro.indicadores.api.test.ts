import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockGetFinanceiroKpisFromAsaas = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getFinanceiroKpisFromAsaas: mockGetFinanceiroKpisFromAsaas,
}));

import { GET } from '@/app/api/financeiro/indicadores/route';

describe('GET /api/financeiro/indicadores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mockGetFinanceiroKpisFromAsaas.mockResolvedValue({
      data: {
        recebidas: { valorBruto: 120, valorLiquido: 115, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        recebidasEmDinheiro: { valorBruto: 80, valorLiquido: 80, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        confirmadas: { valorBruto: 60, valorLiquido: 57, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        aguardandoPagamento: { valorBruto: 300, valorLiquido: 300, quantidadeDeCobrancas: 2, quantidadeDeClientes: 2 },
        vencidas: { valorBruto: 90, valorLiquido: 90, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        receitaDoMes: {
          valorBruto: 200,
          valorLiquido: 195,
          quantidadeDeCobrancas: 2,
          quantidadeDeClientes: 2,
          periodo: {
            inicio: '2026-04-01T00:00:00.000Z',
            fim: '2026-05-01T00:00:00.000Z',
          },
        },
        resumo: {
          totalReceitaReal: 195,
          totalAReceber: 360,
          totalInadimplente: 90,
          taxaInadimplencia: 23.1,
        },
      },
      paymentIdsForReconcile: ['pay_1'],
    });
  });

  it('retorna 401 quando usuario nao autenticado', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('retorna 403 para role sem permissao', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ALUNO' },
    });

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it('mapeia indicadores a partir do snapshot oficial do Asaas', async () => {
    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.cobrancas.pendentes).toBe(2);
    expect(json.data.cobrancas.atrasadas).toBe(1);
    expect(json.data.cobrancas.pagas).toBe(3);
    expect(json.data.cobrancas.valorPendentes).toBe(300);
    expect(json.data.cobrancas.valorPagos).toBe(260);
    expect(mockGetFinanceiroKpisFromAsaas).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        mesAtual: expect.any(Date),
        proximoMes: expect.any(Date),
        startOfToday: expect.any(Date),
        endOfNext30Days: expect.any(Date),
      }),
    );
  });
});