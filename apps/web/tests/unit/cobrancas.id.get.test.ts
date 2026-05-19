/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/session', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
    },
    installmentPlan: {
      findFirst: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => ({
  AsaasEnvError: class AsaasEnvError extends Error {},
  KycNotApprovedError: class KycNotApprovedError extends Error {},
  buildStandaloneExternalReference: vi.fn(),
  deletePayment: vi.fn(),
  getPayment: vi.fn(),
  handlePaymentWebhook: vi.fn(),
  isAsaasEnabled: vi.fn(() => false),
  recordAsaasReadIntent: vi.fn(),
  mapAsaasPaymentStatusToCobranca: vi.fn((status: string) => {
    if (status === 'PENDING') return 'A_VENCER';
    if (status === 'OVERDUE') return 'ATRASADO';
    if (status === 'CONFIRMED' || status === 'RECEIVED' || status === 'RECEIVED_IN_CASH') return 'PAGO';
    if (status === 'REFUNDED') return 'ESTORNADO';
    if (status === 'DELETED') return 'CANCELADO';
    return 'PENDENTE';
  }),
  updatePayment: vi.fn(),
  auditLogService: { record: vi.fn() },
  syncPaymentStateFromAsaas: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { getPayment, isAsaasEnabled } from '@alusa/finance';
import { GET } from '@/app/api/cobrancas/[id]/route';

describe('GET /api/cobrancas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializa asaasNetValue e asaasFeeValue como number no detalhe da cobranca', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    const decimalLike = (raw: string) => ({
      toString: () => raw,
      valueOf: () => raw,
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-1',
      tipo: 'MENSALIDADE',
      status: 'ESTORNADO',
      valor: decimalLike('142.50'),
      vencimento: new Date('2026-03-05T00:00:00.000Z'),
      descricao: 'Mensalidade - Plano Básico',
      formaPagamento: 'CARTAO_CREDITO',
      asaasPaymentId: 'pay_1',
      asaasNetValue: decimalLike('139.18'),
      asaasFeeValue: decimalLike('3.32'),
      liquidacaoStatus: 'NAO_APLICAVEL',
      matriculaId: 'mat-1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
      pagamentos: [],
    } as never);

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-1' } as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/cob-1'), {
      params: { id: 'cob-1' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        valor: 142.5,
        valorBruto: 142.5,
        valorLiquido: 139.18,
        taxaAsaas: 3.32,
      },
    });
  });

  it('usa snapshot local da cobranca e evita GET remoto quando já há link oficial local', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    const decimalLike = (raw: string) => ({
      toString: () => raw,
      valueOf: () => raw,
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-snapshot',
      tipo: 'MENSALIDADE',
      status: 'PENDENTE',
      valor: decimalLike('99.90'),
      vencimento: new Date('2026-03-05T00:00:00.000Z'),
      descricao: 'Mensalidade snapshot',
      formaPagamento: 'BOLETO',
      asaasPaymentId: 'pay_snapshot',
      asaasStatus: 'PENDING',
      asaasValue: decimalLike('99.90'),
      asaasNetValue: decimalLike('97.50'),
      asaasFeeValue: decimalLike('2.40'),
      lastAsaasFetchAt: new Date('2026-03-05T12:00:00.000Z'),
      liquidacaoStatus: 'NAO_APLICAVEL',
      matriculaId: 'mat-1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
      charge: {
        invoiceUrl: 'https://asaas.test/invoice/pay_snapshot',
        billingType: 'BOLETO',
      },
      pagamentos: [],
    } as never);

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-1' } as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/cob-snapshot'), {
      params: { id: 'cob-snapshot' },
    });

    expect(response.status).toBe(200);
    expect(getPayment).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'cob-snapshot',
        status: 'A_VENCER',
        valorLiquido: 97.5,
        taxaAsaas: 2.4,
        asaasData: {
          invoiceUrl: 'https://asaas.test/invoice/pay_snapshot',
          billingType: 'BOLETO',
        },
      },
    });
  });

  it('busca o payment oficial no Asaas quando a cobranca academica ainda nao tem link oficial local', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    const decimalLike = (raw: string) => ({
      toString: () => raw,
      valueOf: () => raw,
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cob-remote-link',
      tipo: 'MENSALIDADE',
      status: 'PENDENTE',
      valor: decimalLike('75.00'),
      vencimento: new Date('2026-04-05T00:00:00.000Z'),
      descricao: 'Mensalidade - Plano Mensal',
      formaPagamento: 'INDEFINIDO',
      asaasPaymentId: 'pay_remote_link',
      asaasStatus: 'PENDING',
      asaasValue: decimalLike('75.00'),
      asaasNetValue: decimalLike('72.50'),
      lastAsaasFetchAt: new Date('2026-03-31T12:00:00.000Z'),
      liquidacaoStatus: 'NAO_APLICAVEL',
      matriculaId: 'mat-1',
      matricula: {
        aluno: { contaId: 'conta-1' },
      },
      charge: {
        invoiceUrl: null,
        billingType: null,
      },
      pagamentos: [],
    } as never);

    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-1' } as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_remote_link',
      status: 'PENDING',
      value: 75,
      netValue: 72.5,
      dueDate: '2026-04-05',
      billingType: 'CREDIT_CARD',
      invoiceUrl: 'https://asaas.test/invoice/pay_remote_link',
      bankSlipUrl: 'https://asaas.test/boleto/pay_remote_link',
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/cob-remote-link'), {
      params: { id: 'cob-remote-link' },
    });

    expect(response.status).toBe(200);
    expect(getPayment).toHaveBeenCalledWith('pay_remote_link', { contaId: 'conta-1' });

    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'cob-remote-link',
        formaPagamento: 'CARTAO_CREDITO',
        asaasData: {
          id: 'pay_remote_link',
          invoiceUrl: 'https://asaas.test/invoice/pay_remote_link',
          bankSlipUrl: 'https://asaas.test/boleto/pay_remote_link',
          billingType: 'CREDIT_CARD',
        },
      },
    });
  });

  it('usa o status oficial do Asaas no detalhe de cobrança standalone enquanto o estado local ainda não for terminal', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-1',
      status: 'OPEN',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
      dueDate: new Date('2030-01-10T00:00:00.000Z'),
      description: 'Cobrança avulsa',
      billingType: 'PIX',
      value: 70.4,
      customerId: null,
      payerName: 'Cliente',
      customer: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_1',
      status: 'PENDING',
      value: 70.4,
      netValue: 69.41,
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-1'), {
      params: { id: 'chg-1' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-1',
        status: 'A_VENCER',
        liquidacaoStatus: null,
      },
    });
  });

  it('classifica cobrança standalone de assinatura como recorrente e usa billingType oficial no detalhe', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-sub-1',
      status: 'OPEN',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_sub_1',
      dueDate: new Date('2026-04-05T00:00:00.000Z'),
      description: 'Assinatura recorrente',
      billingType: null,
      value: 75,
      customerId: null,
      payerName: 'Cliente',
      customer: null,
      externalReference: 'alusa:standalone-subscription:sub_123:payment:pay_sub_1',
      standaloneInstallmentPlanId: null,
      invoiceUrl: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_sub_1',
      status: 'PENDING',
      value: 75,
      netValue: 72.5,
      dueDate: '2026-04-05',
      billingType: 'CREDIT_CARD',
      invoiceUrl: 'https://asaas.test/invoice/pay_sub_1',
      bankSlipUrl: null,
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-sub-1'), {
      params: { id: 'chg-sub-1' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-sub-1',
        tipo: 'RECORRENTE',
        formaPagamento: 'CARTAO_CREDITO',
        asaasData: {
          invoiceUrl: 'https://asaas.test/invoice/pay_sub_1',
          billingType: 'CREDIT_CARD',
        },
      },
    });
  });

  it('preserva status terminal local de cobrança standalone quando o snapshot remoto estiver defasado', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-2',
      status: 'CANCELED',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_2',
      dueDate: new Date('2026-03-05T00:00:00.000Z'),
      description: '[NEEDS_REVIEW] Payment sem vínculo local',
      billingType: 'UNDEFINED',
      value: 150,
      customerId: null,
      payerName: 'Cliente',
      customer: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_2',
      status: 'OVERDUE',
      value: 150,
      netValue: 150,
      paymentDate: null,
      clientPaymentDate: null,
      creditDate: null,
      billingType: 'UNDEFINED',
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-2'), {
      params: { id: 'chg-2' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-2',
        status: 'CANCELADO',
        atrasado: false,
      },
    });
  });

  it('mantém liquidação pendente para cobrança standalone confirmada com creditDate futura', async () => {
    const futureCreditDate = new Date();
    futureCreditDate.setUTCDate(futureCreditDate.getUTCDate() + 14);

    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-3',
      status: 'PAID',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_3',
      dueDate: new Date('2026-03-09T00:00:00.000Z'),
      description: 'Cobrança avulsa cartão',
      billingType: 'CREDIT_CARD',
      value: 150,
      customerId: null,
      payerName: 'Cliente',
      customer: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_3',
      status: 'CONFIRMED',
      value: 150,
      netValue: 146.53,
      paymentDate: '2026-03-09',
      clientPaymentDate: '2026-03-09',
      creditDate: futureCreditDate.toISOString().slice(0, 10),
      billingType: 'CREDIT_CARD',
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-3'), {
      params: { id: 'chg-3' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-3',
        status: 'PAGO',
        liquidacaoStatus: 'PENDENTE',
      },
    });
  });

  it('mantém liquidação disponível para cobrança standalone recebida em dinheiro', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-4',
      status: 'PAID',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_4',
      dueDate: new Date('2026-03-09T00:00:00.000Z'),
      description: 'Cobrança avulsa dinheiro',
      billingType: 'PIX',
      value: 80,
      customerId: null,
      payerName: 'Cliente',
      customer: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);
    vi.mocked(getPayment).mockResolvedValueOnce({
      id: 'pay_4',
      status: 'RECEIVED_IN_CASH',
      value: 80,
      netValue: 80,
      paymentDate: '2026-03-09',
      clientPaymentDate: '2026-03-09',
      creditDate: null,
      billingType: 'PIX',
    } as never);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-4'), {
      params: { id: 'chg-4' },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-4',
        status: 'PAGO',
        liquidacaoStatus: 'DISPONIVEL',
      },
    });
  });

  it('evita GET remoto para cobrança standalone estável fora da janela operacional', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: 'u1',
      contaId: 'conta-1',
      role: 'FINANCEIRO',
    } as never);

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-stable',
      status: 'OPEN',
      contaId: 'conta-1',
      asaasPaymentId: 'pay_stable',
      dueDate: new Date('2026-03-09T00:00:00.000Z'),
      description: 'Cobrança estável',
      billingType: 'PIX',
      value: 80,
      invoiceUrl: 'https://asaas.test/invoice/pay_stable',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      statusUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
      customerId: null,
      payerName: 'Cliente',
      customer: null,
    } as never);

    vi.mocked(isAsaasEnabled).mockReturnValueOnce(true);

    const response = await GET(new NextRequest('http://localhost/api/cobrancas/chg-stable'), {
      params: { id: 'chg-stable' },
    });

    expect(response.status).toBe(200);
    expect(getPayment).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        id: 'chg-stable',
        status: 'PENDENTE',
        invoiceUrl: 'https://asaas.test/invoice/pay_stable',
      },
    });
  });
});
