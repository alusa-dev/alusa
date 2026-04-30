import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockProcessAsaasWebhookQueue = vi.hoisted(() => vi.fn());
const mockSyncPaymentStateFromAsaas = vi.hoisted(() => vi.fn());
const mockGetFinanceiroKpisFromAsaas = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  processAsaasWebhookQueue: mockProcessAsaasWebhookQueue,
  syncPaymentStateFromAsaas: mockSyncPaymentStateFromAsaas,
  getFinanceiroKpisFromAsaas: mockGetFinanceiroKpisFromAsaas,
}));

import { GET } from '@/app/api/financeiro/kpis/route';

describe('GET /api/financeiro/kpis', () => {
  const mockUser = {
    id: 'user-1',
    contaId: 'conta-1',
    role: 'ADMIN',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: mockUser });
    mockProcessAsaasWebhookQueue.mockResolvedValue({ processedPayments: [] });
    mockSyncPaymentStateFromAsaas.mockResolvedValue({ success: true });
    mockGetFinanceiroKpisFromAsaas.mockResolvedValue({
      data: {
        recebidas: { valorBruto: 120, valorLiquido: 95, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        recebidasEmDinheiro: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        confirmadas: { valorBruto: 160, valorLiquido: 142, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        aguardandoPagamento: { valorBruto: 300, valorLiquido: 300, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        vencidas: { valorBruto: 100, valorLiquido: 100, quantidadeDeCobrancas: 1, quantidadeDeClientes: 1 },
        receitaDoMes: {
          valorBruto: 120,
          valorLiquido: 95,
          quantidadeDeCobrancas: 1,
          quantidadeDeClientes: 1,
          periodo: {
            inicio: '2026-03-01T00:00:00.000Z',
            fim: '2026-04-01T00:00:00.000Z',
          },
        },
        resumo: {
          totalReceitaReal: 95,
          totalAReceber: 460,
          totalInadimplente: 100,
          taxaInadimplencia: 50,
        },
      },
      paymentIdsForReconcile: ['pay_1', 'pay_2'],
    });
  });

  it('deve retornar 401 se usuário não autenticado', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = new Request('http://localhost/api/financeiro/kpis');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe('NAO_AUTENTICADO');
  });

  it('deve retornar 403 para roles não permitidos', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { ...mockUser, role: 'PROFESSOR' },
    });

    const request = new Request('http://localhost/api/financeiro/kpis');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('SEM_PERMISSAO');
  });

  it('deve retornar KPIs calculados a partir do snapshot oficial do Asaas', async () => {
    const request = new Request('http://localhost/api/financeiro/kpis');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.recebidas.valorLiquido).toBe(95);
    expect(json.data.confirmadas.valorLiquido).toBe(142);
    expect(json.data.vencidas.valorBruto).toBe(100);
    expect(json.data.resumo.taxaInadimplencia).toBe(50);
  });

  it('deve drenar webhooks antes de calcular e reconciliar pagamentos oficiais retornados', async () => {
    const request = new Request('http://localhost/api/financeiro/kpis');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockProcessAsaasWebhookQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        statuses: ['PENDENTE', 'ERRO'],
        source: 'WEBHOOK',
      }),
    );
    expect(mockGetFinanceiroKpisFromAsaas).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        mesAtual: expect.any(Date),
        proximoMes: expect.any(Date),
        startOfToday: expect.any(Date),
        endOfNext30Days: expect.any(Date),
      }),
    );
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledTimes(2);
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenNthCalledWith(1, {
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
    });
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenNthCalledWith(2, {
      contaId: 'conta-1',
      asaasPaymentId: 'pay_2',
    });
  });

  it('deve limitar a reconciliação aos primeiros 25 pagamentos oficiais', async () => {
    mockGetFinanceiroKpisFromAsaas.mockResolvedValueOnce({
      data: {
        recebidas: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        recebidasEmDinheiro: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        confirmadas: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        aguardandoPagamento: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        vencidas: { valorBruto: 0, valorLiquido: 0, quantidadeDeCobrancas: 0, quantidadeDeClientes: 0 },
        receitaDoMes: {
          valorBruto: 0,
          valorLiquido: 0,
          quantidadeDeCobrancas: 0,
          quantidadeDeClientes: 0,
          periodo: {
            inicio: '2026-03-01T00:00:00.000Z',
            fim: '2026-04-01T00:00:00.000Z',
          },
        },
        resumo: {
          totalReceitaReal: 0,
          totalAReceber: 0,
          totalInadimplente: 0,
          taxaInadimplencia: 0,
        },
      },
      paymentIdsForReconcile: Array.from({ length: 30 }, (_, index) => `pay_${index + 1}`),
    });

    const request = new Request('http://localhost/api/financeiro/kpis');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledTimes(25);
  });
});
