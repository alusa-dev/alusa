import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSafeGetServerSession = vi.hoisted(() => vi.fn());
const mockAlunoFindFirst = vi.hoisted(() => vi.fn());
const mockGetStudentPaymentHistory = vi.hoisted(() => vi.fn());

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: mockSafeGetServerSession,
}));

vi.mock('@/src/server/finance/student-payment-history', () => ({
  getStudentPaymentHistory: mockGetStudentPaymentHistory,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aluno: {
      findFirst: mockAlunoFindFirst,
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
    mockGetStudentPaymentHistory.mockResolvedValue({
      cobrancas: [
        {
          id: 'cb1',
          sourceKind: 'cobranca',
          sourceId: 'cb1',
          chargeType: 'MENSALIDADE',
          origin: 'ACADEMICO',
          tipo: 'MENSALIDADE',
          category: 'MENSALIDADE',
          description: 'Mensalidade Abril',
          payerName: 'Responsável Financeiro',
          payerRole: 'RESPONSAVEL',
          valor: 150,
          vencimento: '2026-04-10T00:00:00.000Z',
          billingType: 'PIX',
          status: 'PAGO',
          asaasPaymentId: 'pay_1',
          matriculaId: 'mat-1',
          groupId: null,
          isGroup: false,
          installmentCount: null,
          installmentsPaid: null,
          installmentLabel: null,
          planName: 'Plano Básico',
          detailHref: '/cobrancas/cb1',
          createdAt: '2026-04-01T00:00:00.000Z',
          pagamento: {
            id: 'pay-local',
            status: 'CONFIRMED',
            valorPago: 150,
            dataPagamento: '2026-04-09T00:00:00.000Z',
            formaPagamento: 'PIX',
            comprovante: null,
            asaasPaymentId: 'pay_1',
            createdAt: '2026-04-09T00:00:00.000Z',
          },
        },
      ],
      resumo: {
        total: 1,
        totalPago: 150,
        totalValor: 150,
        porCategoria: {
          TAXA_MATRICULA: { count: 0, totalPago: 0 },
          MENSALIDADE: { count: 1, totalPago: 150 },
          PARCELAMENTO: { count: 0, totalPago: 0 },
          ASSINATURA: { count: 0, totalPago: 0 },
          LOJA: { count: 0, totalPago: 0 },
          OUTROS: { count: 0, totalPago: 0 },
        },
      },
    });
  });

  it('retorna 404 quando aluno nao existe no escopo', async () => {
    mockAlunoFindFirst.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/financeiro/pagamentos/aluno/aluno-1'),
      { params: { alunoId: 'aluno-1' } },
    );

    expect(response.status).toBe(404);
  });

  it('retorna historico consolidado com categorias e resumo', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/financeiro/pagamentos/aluno/aluno-1'),
      { params: { alunoId: 'aluno-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.aluno.nome).toBe('Aluno Financeiro');
    expect(json.data.cobrancas).toHaveLength(1);
    expect(json.data.cobrancas[0]).toMatchObject({
      category: 'MENSALIDADE',
      payerRole: 'RESPONSAVEL',
      detailHref: '/cobrancas/cb1',
    });
    expect(json.data.resumo.totalPago).toBe(150);
    expect(json.data.resumo.porCategoria.MENSALIDADE.totalPago).toBe(150);
    expect(mockGetStudentPaymentHistory).toHaveBeenCalledWith('conta-1', 'aluno-1', 'Aluno Financeiro');
  });
});
