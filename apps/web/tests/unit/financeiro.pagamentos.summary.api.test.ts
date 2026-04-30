import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSafeGetServerSession = vi.hoisted(() => vi.fn());
const mockCobrancaFindMany = vi.hoisted(() => vi.fn());
const mockSyncPaymentStateFromAsaas = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: mockSafeGetServerSession,
}));

vi.mock('@alusa/finance', () => ({
  isAsaasEnabled: vi.fn(() => true),
  syncPaymentStateFromAsaas: mockSyncPaymentStateFromAsaas,
  mapAsaasPaymentStatusToCobranca: vi.fn((status: string) => {
    switch (status) {
      case 'RECEIVED':
      case 'CONFIRMED':
      case 'RECEIVED_IN_CASH':
      case 'DUNNING_RECEIVED':
        return 'PAGO';
      case 'OVERDUE':
      case 'DUNNING_REQUESTED':
        return 'ATRASADO';
      case 'REFUNDED':
      case 'REFUND_IN_PROGRESS':
      case 'REFUND_REQUESTED':
      case 'CHARGEBACK_REQUESTED':
      case 'CHARGEBACK_DISPUTE':
      case 'AWAITING_CHARGEBACK_REVERSAL':
        return 'ESTORNADO';
      case 'DELETED':
        return 'CANCELADO';
      default:
        return 'PENDENTE';
    }
  }),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    cobranca: {
      findMany: mockCobrancaFindMany,
    },
  },
}));

import { GET } from '@/app/api/financeiro/pagamentos/summary/route';

describe('GET /api/financeiro/pagamentos/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeGetServerSession.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mockSyncPaymentStateFromAsaas.mockResolvedValue({ success: true });
    mockCobrancaFindMany.mockResolvedValue([
      {
        id: 'cb1',
        status: 'PENDENTE',
        valor: 120,
        vencimento: new Date('2026-04-10T00:00:00.000Z'),
        dataPagamento: new Date('2026-04-08T00:00:00.000Z'),
        pagoEm: null,
        pagoPor: 'PIX',
        formaPagamento: 'PIX',
        asaasPaymentId: 'pay_1',
        asaasStatus: 'RECEIVED',
        asaasValue: 120,
        asaasNetValue: 118,
        lastAsaasFetchAt: null,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        pagamentos: [],
        matricula: {
          aluno: {
            id: 'aluno-1',
            nome: 'Aluno Financeiro',
            cpf: null,
            foto: null,
          },
        },
      },
    ]);
  });

  it('retorna 401 quando nao autenticado', async () => {
    mockSafeGetServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest('http://localhost/api/financeiro/pagamentos/summary'));
    expect(response.status).toBe(401);
  });

  it('agrega historico por aluno usando snapshot oficial reconciliado', async () => {
    const response = await GET(new NextRequest('http://localhost/api/financeiro/pagamentos/summary?status=PAGO'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.total).toBe(1);
    expect(json.data[0].id).toBe('aluno-1');
    expect(json.data[0].nome).toBe('Aluno Financeiro');
    expect(json.data[0].valorTotal).toBe(120);
    expect(json.data[0].pagamentosCount).toBe(1);
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
    });
    expect(mockCobrancaFindMany).toHaveBeenCalledTimes(2);
  });
});