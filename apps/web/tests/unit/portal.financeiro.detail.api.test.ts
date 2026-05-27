import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  prismaMock,
  getPaymentMock,
  isAsaasEnabledMock,
  requirePortalUserMock,
  resolvePortalAlunoIdsMock,
  resolvePortalScopedPayerIdsMock,
  recordAsaasReadDecisionMock,
} = vi.hoisted(() => ({
  prismaMock: {
    cobranca: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
  },
  getPaymentMock: vi.fn(),
  isAsaasEnabledMock: vi.fn(),
  requirePortalUserMock: vi.fn(),
  resolvePortalAlunoIdsMock: vi.fn(),
  resolvePortalScopedPayerIdsMock: vi.fn(),
  recordAsaasReadDecisionMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  AsaasEnvError: class AsaasEnvError extends Error {},
  getPayment: getPaymentMock,
  isAsaasEnabled: isAsaasEnabledMock,
}));

vi.mock('@/features/portal/api-helpers', () => ({
  requirePortalUser: requirePortalUserMock,
  resolvePortalAlunoIds: resolvePortalAlunoIdsMock,
}));

vi.mock('@/features/portal/finance-standalone', () => ({
  mapChargeStatusToPortalStatus: vi.fn((status: string) => (status === 'OPEN' ? 'PENDENTE' : status)),
  resolvePortalScopedPayerIds: resolvePortalScopedPayerIdsMock,
}));

vi.mock('@/src/server/finance/asaas-read-observability', () => ({
  recordAsaasReadDecision: recordAsaasReadDecisionMock,
}));

import { GET } from '@/app/api/portal/financeiro/[id]/route';

function buildRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/portal/financeiro/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAsaasEnabledMock.mockReturnValue(true);
    requirePortalUserMock.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'RESPONSAVEL' },
    });
    resolvePortalAlunoIdsMock.mockResolvedValue(['aluno-1']);
  });

  it('usa snapshot local para cobrança avulsa estável sem consultar o Asaas', async () => {
    prismaMock.cobranca.findFirst.mockResolvedValue(null);
    resolvePortalScopedPayerIdsMock.mockResolvedValue({
      alunoIds: ['aluno-1'],
      responsavelIds: [],
    });
    prismaMock.charge.findFirst.mockResolvedValue({
      id: 'charge-1',
      status: 'OPEN',
      value: new Prisma.Decimal('123.45'),
      dueDate: new Date('2025-01-10T00:00:00.000Z'),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2025-01-01T00:00:00.000Z'),
      billingType: 'PIX',
      asaasPaymentId: 'pay-1',
      invoiceUrl: 'https://local.example/invoice/charge-1',
      payerName: 'Aluno 1',
      description: 'Cobrança avulsa',
    });

    const res = await GET(buildRequest('http://localhost/api/portal/financeiro/charge-1'), {
      params: { id: 'charge-1' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(getPaymentMock).not.toHaveBeenCalled();
    expect(recordAsaasReadDecisionMock).toHaveBeenCalledWith('portal_financeiro_detail', 'local');
    expect(json).toMatchObject({
      id: 'charge-1',
      invoiceUrl: 'https://local.example/invoice/charge-1',
      asaasPaymentId: 'pay-1',
      asaasData: {
        id: 'pay-1',
        invoiceUrl: 'https://local.example/invoice/charge-1',
      },
    });
  });

  it('faz leitura remota quando fresh=1 é solicitado', async () => {
    prismaMock.cobranca.findFirst.mockResolvedValue({
      id: 'cob-1',
      tipo: 'MENSALIDADE',
      valor: new Prisma.Decimal('200.00'),
      vencimento: new Date('2025-03-10T00:00:00.000Z'),
      status: 'PENDENTE',
      formaPagamento: 'BOLETO',
      asaasId: null,
      asaasPaymentId: 'pay-remote-1',
      descricao: 'Mensalidade',
      juros: null,
      multa: null,
      desconto: null,
      asaasStatus: 'PENDING',
      asaasValue: new Prisma.Decimal('200.00'),
      asaasNetValue: null,
      asaasOriginalValue: null,
      asaasFeeValue: null,
      asaasCreditDate: null,
      asaasEstimatedCreditDate: null,
      lastAsaasFetchAt: new Date('2025-03-01T00:00:00.000Z'),
      matricula: {
        aluno: {
          id: 'aluno-1',
          usuarioId: 'user-aluno',
          nome: 'Aluno 1',
          cpf: '12345678900',
          email: 'aluno@example.com',
          telefone: '11999999999',
        },
        turma: {
          nome: 'Turma A',
          modalidade: {
            nome: 'Jazz',
          },
        },
        responsavelFinanceiro: null,
      },
      pagamentos: [],
    });
    getPaymentMock.mockResolvedValue({
      id: 'pay-remote-1',
      status: 'PENDING',
      value: 200,
      dueDate: '2025-03-10',
      billingType: 'BOLETO',
      invoiceUrl: 'https://remote.example/invoice/pay-remote-1',
      transactionReceiptUrl: 'https://remote.example/receipt/pay-remote-1',
    });

    const res = await GET(buildRequest('http://localhost/api/portal/financeiro/cob-1?fresh=1'), {
      params: { id: 'cob-1' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(getPaymentMock).toHaveBeenCalledWith('pay-remote-1', { contaId: 'conta-1' });
    expect(recordAsaasReadDecisionMock).toHaveBeenCalledWith('portal_financeiro_detail', 'fresh_remote');
    expect(json).toMatchObject({
      id: 'cob-1',
      invoiceUrl: 'https://remote.example/invoice/pay-remote-1',
      transactionReceiptUrl: 'https://remote.example/receipt/pay-remote-1',
      asaasData: {
        id: 'pay-remote-1',
        invoiceUrl: 'https://remote.example/invoice/pay-remote-1',
      },
    });
  });

  it('expõe apenas metadados do cartão, sem vazar token sensível', async () => {
    isAsaasEnabledMock.mockReturnValue(false);
    prismaMock.cobranca.findFirst.mockResolvedValue({
      id: 'cob-2',
      tipo: 'MENSALIDADE',
      valor: new Prisma.Decimal('150.00'),
      vencimento: new Date('2025-03-10T00:00:00.000Z'),
      status: 'PENDENTE',
      formaPagamento: 'CARTAO_CREDITO',
      asaasId: null,
      asaasPaymentId: 'pay-local-2',
      descricao: 'Mensalidade cartão',
      juros: null,
      multa: null,
      desconto: null,
      asaasStatus: 'PENDING',
      asaasValue: new Prisma.Decimal('150.00'),
      asaasNetValue: null,
      asaasOriginalValue: null,
      asaasFeeValue: null,
      asaasCreditDate: null,
      asaasEstimatedCreditDate: null,
      lastAsaasFetchAt: new Date('2025-03-01T00:00:00.000Z'),
      matricula: {
        aluno: {
          id: 'aluno-1',
          usuarioId: 'user-aluno',
          nome: 'Aluno 1',
          cpf: '12345678900',
          email: 'aluno@example.com',
          telefone: '11999999999',
        },
        turma: null,
        responsavelFinanceiro: {
          id: 'resp-1',
          creditCardBrand: 'VISA',
          creditCardLast4: '4242',
          creditCardExpiryMonth: 12,
          creditCardExpiryYear: 2030,
        },
      },
      pagamentos: [],
    });

    const res = await GET(buildRequest('http://localhost/api/portal/financeiro/cob-2'), {
      params: { id: 'cob-2' },
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.matricula.responsavelFinanceiro).toMatchObject({
      hasSavedCard: true,
      creditCardBrand: 'VISA',
      creditCardLast4: '4242',
      creditCardExpiryMonth: 12,
      creditCardExpiryYear: 2030,
    });
  });
});
