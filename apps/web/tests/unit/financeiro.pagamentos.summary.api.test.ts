import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSafeGetServerSession = vi.hoisted(() => vi.fn());
const mockListPersonPaymentLedgerIndex = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: mockSafeGetServerSession,
}));

vi.mock('@/src/server/finance/person-payment-ledger', () => ({
  listPersonPaymentLedgerIndex: mockListPersonPaymentLedgerIndex,
}));

import { GET } from '@/app/api/financeiro/pagamentos/summary/route';

describe('GET /api/financeiro/pagamentos/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeGetServerSession.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mockListPersonPaymentLedgerIndex.mockResolvedValue({
      data: [
        {
          id: 'aluno-1',
          tipo: 'ALUNO',
          nome: 'Aluno Financeiro',
          cpf: null,
          foto: null,
          alunosVinculados: [{ id: 'aluno-1', nome: 'Aluno Financeiro' }],
          totalPagamentos: 120,
          valorTotal: 120,
          valorEmAberto: 80,
          ultimoPagamento: '2026-04-08T00:00:00.000Z',
          pagamentosCount: 1,
          cobrancasAbertasCount: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it('retorna 401 quando nao autenticado', async () => {
    mockSafeGetServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/financeiro/pagamentos/summary'));
    expect(response.status).toBe(401);
  });

  it('retorna índice financeiro por pessoa usando o ledger local', async () => {
    const response = await GET(new NextRequest('http://localhost/api/financeiro/pagamentos/summary?status=PAGO'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.total).toBe(1);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(20);
    expect(json.totalPages).toBe(1);
    expect(json.data[0].id).toBe('aluno-1');
    expect(json.data[0].tipo).toBe('ALUNO');
    expect(json.data[0].nome).toBe('Aluno Financeiro');
    expect(json.data[0].valorTotal).toBe(120);
    expect(json.data[0].valorEmAberto).toBe(80);
    expect(json.data[0].pagamentosCount).toBe(1);
    expect(mockListPersonPaymentLedgerIndex).toHaveBeenCalledWith({
      contaId: 'conta-1',
      search: undefined,
      statusFilters: ['PAGO'],
      page: 1,
      pageSize: 20,
    });
  });
});
