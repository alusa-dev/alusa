import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSafeGetServerSession = vi.hoisted(() => vi.fn());
const mockAlunoFindFirst = vi.hoisted(() => vi.fn());
const mockCobrancaFindMany = vi.hoisted(() => vi.fn());
const mockChargeFindMany = vi.hoisted(() => vi.fn());
const mockSaleFindMany = vi.hoisted(() => vi.fn());
const mockSyncPaymentStateFromAsaas = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: mockSafeGetServerSession,
}));

vi.mock('@alusa/finance', () => ({
  isAsaasEnabled: vi.fn(() => true),
  syncPaymentStateFromAsaas: mockSyncPaymentStateFromAsaas,
  mapAsaasPaymentStatusToCobranca: vi.fn((status: string) => {
    switch (status) {
      case 'CONFIRMED':
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
        return 'PAGO';
      case 'OVERDUE':
        return 'ATRASADO';
      case 'REFUNDED':
        return 'ESTORNADO';
      default:
        return 'PENDENTE';
    }
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aluno: {
      findFirst: mockAlunoFindFirst,
    },
    cobranca: {
      findMany: mockCobrancaFindMany,
    },
    charge: {
      findMany: mockChargeFindMany,
    },
    sale: {
      findMany: mockSaleFindMany,
    },
  },
}));

import { GET } from '@/app/api/financeiro/pagamentos/aluno/[alunoId]/route';

describe('GET /api/financeiro/pagamentos/aluno/[alunoId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeGetServerSession.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    });
    mockAlunoFindFirst.mockResolvedValue({
      id: 'aluno-1',
      nome: 'Aluno Financeiro',
      email: 'aluno@test.dev',
      telefone: null,
      cpf: null,
      foto: null,
    });
    mockSyncPaymentStateFromAsaas.mockResolvedValue({ success: true });
    mockChargeFindMany.mockResolvedValue([]);
    mockSaleFindMany.mockResolvedValue([]);
    mockCobrancaFindMany.mockResolvedValue([
      {
        id: 'cb1',
        tipo: 'MENSALIDADE',
        descricao: 'Mensalidade Abril',
        valor: 150,
        vencimento: new Date('2026-04-10T00:00:00.000Z'),
        dataPagamento: new Date('2026-04-09T00:00:00.000Z'),
        formaPagamento: 'PIX',
        status: 'PENDENTE',
        pagoEm: null,
        pagoPor: 'PIX',
        asaasPaymentId: 'pay_1',
        asaasStatus: 'CONFIRMED',
        asaasValue: 150,
        asaasNetValue: 148,
        lastAsaasFetchAt: null,
        matriculaId: 'mat-1',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        pagamentos: [],
        matricula: {
          responsavelFinanceiro: { nome: 'Responsável Financeiro' },
        },
      },
    ]);
  });

  it('retorna 404 quando aluno nao existe no escopo', async () => {
    mockAlunoFindFirst.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/financeiro/pagamentos/aluno/aluno-1'),
      { params: { alunoId: 'aluno-1' } },
    );

    expect(response.status).toBe(404);
  });

  it('retorna historico reconciliado por aluno com status oficial', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/financeiro/pagamentos/aluno/aluno-1'),
      { params: { alunoId: 'aluno-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.aluno.nome).toBe('Aluno Financeiro');
    expect(json.data.cobrancas).toHaveLength(1);
    expect(json.data.cobrancas[0].status).toBe('PAGO');
    expect(json.data.cobrancas[0].payerName).toBe('Responsável Financeiro');
    expect(json.data.cobrancas[0].pagamento.status).toBe('CONFIRMED');
    expect(json.data.cobrancas[0].pagamento.valorPago).toBe(150);
    expect(json.data.resumo.totalPago).toBe(150);
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
    });
    expect(mockCobrancaFindMany).toHaveBeenCalledTimes(2);
    expect(mockChargeFindMany).toHaveBeenCalledTimes(1);
    expect(mockSaleFindMany).toHaveBeenCalledTimes(1);
  });

  it('inclui cobranças standalone e vendas de loja pagas do aluno', async () => {
    mockCobrancaFindMany.mockResolvedValue([]);
    mockChargeFindMany.mockResolvedValue([
      {
        id: 'ch_1',
        status: 'PAID',
        externalReference: 'alusa:standalone:ch_1',
        asaasPaymentId: 'pay_charge',
        value: 90,
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
        billingType: 'PIX',
        payerName: 'Aluno Financeiro',
        description: 'Cobrança avulsa',
        standaloneInstallmentPlanId: null,
        standaloneSubscriptionId: null,
        invoiceUrl: 'https://invoice.test',
        statusUpdatedAt: new Date('2026-05-11T00:00:00.000Z'),
        createdAt: new Date('2026-05-09T00:00:00.000Z'),
        updatedAt: new Date('2026-05-11T00:00:00.000Z'),
        sale: null,
      },
    ]);
    mockSaleFindMany.mockResolvedValue([
      {
        id: 'sale_1',
        saleNumber: 8,
        total: 150,
        paymentMethod: 'DINHEIRO',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-12T00:00:00.000Z'),
      },
    ]);

    const response = await GET(
      new NextRequest('http://localhost/api/financeiro/pagamentos/aluno/aluno-1'),
      { params: { alunoId: 'aluno-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.cobrancas).toHaveLength(2);
    expect(json.data.cobrancas.map((item: { sourceKind: string }) => item.sourceKind)).toEqual([
      'sale',
      'charge',
    ]);
    expect(json.data.cobrancas[0]).toMatchObject({
      tipo: 'LOJA',
      description: 'Loja #0008',
      pagamento: { status: 'PAGO', valorPago: 150 },
    });
    expect(json.data.cobrancas[1]).toMatchObject({
      tipo: 'AVULSA',
      pagamento: { status: 'PAID', valorPago: 90, comprovante: 'https://invoice.test' },
    });
    expect(json.data.resumo.totalPago).toBe(240);
  });
});
