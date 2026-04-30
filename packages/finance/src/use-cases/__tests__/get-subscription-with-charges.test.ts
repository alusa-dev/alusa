import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => {
  const prisma = {
    subscription: {
      findFirst: vi.fn(),
    },
    standaloneSubscription: undefined,
    auditLog: {
      findFirst: vi.fn(),
    },
    charge: {
      findMany: vi.fn(),
    },
    cobranca: {
      findMany: vi.fn(),
    },
  };

  return { prisma };
});

import { prisma } from '@alusa/database';
import { getSubscriptionWithCharges } from '../get-subscription-with-charges';

describe('getSubscriptionWithCharges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna assinatura manual via audit log quando nao existe Subscription academica', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      entityId: 'sub_manual_1',
      createdAt: new Date('2026-02-07T00:00:00.000Z'),
      metadata: {
        externalReference: 'alusa:standalone-subscription:sub_manual_1',
        asaasSubscriptionId: 'sub_asaas_1',
        status: 'ACTIVE',
        value: 120,
        cycle: 'MONTHLY',
        billingType: 'BOLETO',
        description: 'Mensalidade manual',
        nextDueDate: '2026-03-05',
        payerName: 'Bryan',
        payerId: 'payer_1',
      },
    } as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([
      {
        id: 'ch_1',
        status: 'OPEN',
        value: 120,
        dueDate: new Date('2026-03-05T00:00:00.000Z'),
        asaasPaymentId: 'pay_1',
      },
      {
        id: 'ch_2',
        status: 'PAID',
        value: 120,
        dueDate: new Date('2026-02-05T00:00:00.000Z'),
        asaasPaymentId: 'pay_2',
      },
    ] as never);

    const result = await getSubscriptionWithCharges({
      contaId: 'conta_1',
      subscriptionId: 'sub_manual_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.id).toBe('sub_manual_1');
    expect(result.data.asaasSubscriptionId).toBe('sub_asaas_1');
    expect(result.data.cobrancas.length).toBe(2);
    expect(result.data.matriculaId).toBe('');
    expect(result.data.contratoId).toBe('');
  });

  it('retorna erro quando nao existe assinatura academica nem manual', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce(null as never);

    const result = await getSubscriptionWithCharges({
      contaId: 'conta_1',
      subscriptionId: 'inexistente',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('Assinatura não encontrada');
  });

  it('faz fallback para auditLog quando standaloneSubscription nao existe no client runtime', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      entityId: 'sub_manual_2',
      createdAt: new Date('2026-02-08T00:00:00.000Z'),
      metadata: {
        externalReference: 'alusa:standalone-subscription:sub_manual_2',
        asaasSubscriptionId: 'sub_asaas_2',
        status: 'ACTIVE',
        value: 89,
        cycle: 'MONTHLY',
        billingType: 'PIX',
        description: 'Assinatura manual fallback',
        nextDueDate: '2026-03-10',
        payerName: 'Cliente Fallback',
        payerId: 'payer_2',
      },
    } as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([] as never);

    const result = await getSubscriptionWithCharges({
      contaId: 'conta_1',
      subscriptionId: 'sub_manual_2',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe('sub_manual_2');
    expect(result.data.asaasSubscriptionId).toBe('sub_asaas_2');
  });

  it('usa o valor oficial refletido nas cobranças da assinatura acadêmica', async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'sub_1',
      asaasSubscriptionId: 'asaas_sub_1',
      externalReference: 'alusa:subscription:matricula_1:plano_1',
      status: 'ACTIVE',
      contratoId: 'contrato_1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      matriculaId: 'matricula_1',
      matricula: {
        id: 'matricula_1',
        vencimentoDia: 5,
        formaPagamento: 'CARTAO_CREDITO',
        formaPagamentoTaxa: 'BOLETO',
        aluno: {
          id: 'aluno_1',
          nome: 'Bryan de Alencar Bezerra',
          email: 'bryan@example.com',
          telefone: '11999999999',
          dataNasc: new Date('2000-01-01T00:00:00.000Z'),
        },
        responsavelFinanceiro: null,
        plano: {
          nome: 'Plano Mensal',
          valor: 150,
          periodicidade: 'MENSAL',
          descricao: 'Plano Mensal',
        },
        combo: null,
      },
    } as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([
      {
        id: 'charge_1',
        status: 'OPEN',
        value: 75,
        dueDate: new Date('2099-05-05T00:00:00.000Z'),
        asaasPaymentId: 'pay_1',
        cobranca: {
          id: 'cobranca_1',
          status: 'A_VENCER',
          valor: 75,
          vencimento: new Date('2099-05-05T00:00:00.000Z'),
          dataPagamento: null,
          asaasPaymentId: 'pay_1',
        },
      },
    ] as never);
    vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never);

    const result = await getSubscriptionWithCharges({
      contaId: 'conta_1',
      subscriptionId: 'sub_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.valor).toBe(75);
    expect(result.data.nextDueDate).toBe('2099-05-05T00:00:00.000Z');
  });
});

