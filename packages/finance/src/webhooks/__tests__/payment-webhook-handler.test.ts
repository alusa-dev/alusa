import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePaymentWebhook } from '../payment-webhook-handler';

const { mockUpdateFinanceStatusFromPayment } = vi.hoisted(() => ({
  mockUpdateFinanceStatusFromPayment: vi.fn(async () => ({ success: true })),
}));

vi.mock('@alusa/asaas-gateway', () => {
  return {
    isBillingV2FlagEnabled: vi.fn(() => false),
  };
});

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../../guards/finance-status-guard', () => ({
  updateFinanceStatusFromPayment: mockUpdateFinanceStatusFromPayment,
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => callback((await import('@alusa/database')).prisma)),
    $queryRaw: vi.fn(),
    cobranca: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    standaloneSubscription: {
      findFirst: vi.fn(),
    },
    matricula: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    customer: {
      findFirst: vi.fn(),
    },
    aluno: {
      findFirst: vi.fn(),
    },
    responsavel: {
      findFirst: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    pagamento: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    lancamento: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    logIntegracao: {
      create: vi.fn(),
    },
  },
}));

describe('handlePaymentWebhook', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    mockUpdateFinanceStatusFromPayment.mockResolvedValue({ success: true });

    const { isBillingV2FlagEnabled } = await import('@alusa/asaas-gateway');
    const { prisma } = await import('@alusa/database');
    vi.mocked(isBillingV2FlagEnabled).mockReturnValue(false);
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback: (_tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    vi.mocked(prisma.charge.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('deve promover statusFinanceiro quando a taxa de matrícula for confirmada', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c_taxa',
      matriculaId: 'm_taxa',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_taxa',
      tipo: 'TAXA_MATRICULA',
      formaPagamento: 'CARTAO_CREDITO',
    } as never);

    vi.mocked(prisma.cobranca.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pg_taxa' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_taxa',
        status: 'CONFIRMED',
        value: 80,
        netValue: 77.92,
        billingType: 'CREDIT_CARD',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.matricula.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm_taxa', taxaStatus: { not: 'PAGO' } },
        data: { taxaStatus: 'PAGO' },
      }),
    );
    expect(mockUpdateFinanceStatusFromPayment).toHaveBeenCalledWith({
      matriculaId: 'm_taxa',
      newStatus: 'ADIMPLENTE',
      eventName: 'PAYMENT_CONFIRMED',
      reason: 'Webhook Asaas: PAYMENT_CONFIRMED',
    });
  });

  it('deve registrar Pagamento quando confirmado mesmo sem liquidação', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      matriculaId: 'm1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);

    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'p1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_1',
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.pagamento.create).toHaveBeenCalledTimes(1);
    expect(prisma.lancamento.findFirst).not.toHaveBeenCalled();
    expect(prisma.lancamento.create).not.toHaveBeenCalled();
    expect(prisma.logIntegracao.create).toHaveBeenCalledTimes(1);
  });

  it('deve tratar corrida ao materializar Pagamento com mesmo asaasPaymentId', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c_race',
      matriculaId: 'm_race',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_race',
      tipo: 'MENSALIDADE',
      formaPagamento: 'PIX',
    } as never);

    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'pg_race' } as never);
    vi.mocked(prisma.pagamento.create).mockRejectedValueOnce({ code: 'P2002' });
    vi.mocked(prisma.pagamento.update).mockResolvedValueOnce({ id: 'pg_race' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_race',
        status: 'CONFIRMED',
        value: 100,
        netValue: 95,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.pagamento.create).toHaveBeenCalledTimes(1);
    expect(prisma.pagamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pg_race' },
        data: expect.objectContaining({
          valorPago: 100,
          status: 'CONFIRMADO',
        }),
      }),
    );
    expect(prisma.logIntegracao.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'pay_race',
          response: expect.objectContaining({ pagamentoId: 'pg_race' }),
        }),
      }),
    );
  });

  it('deve vincular taxa pela externalReference legada mesmo sem charge local previa', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'cobranca_legacy',
      matriculaId: 'mat_legacy',
      status: 'PENDENTE',
      asaasPaymentId: null,
      tipo: 'TAXA_MATRICULA',
      formaPagamento: 'PIX',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.create).mockResolvedValueOnce({ id: 'pg_legacy' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_taxa_legacy',
        status: 'PENDING',
        value: 80,
        netValue: 80,
        externalReference: 'charge:cobranca_legacy',
        billingType: 'PIX',
        dueDate: '2099-04-05',
        invoiceUrl: 'https://asaas.test/i/pay_taxa_legacy',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { matricula: { aluno: { contaId: 'conta-1' } } },
            {
              OR: expect.arrayContaining([
                { id: 'cobranca_legacy' },
                { asaasPaymentId: 'pay_taxa_legacy' },
                { asaasId: 'pay_taxa_legacy' },
              ]),
            },
          ],
        },
      }),
    );
    expect(prisma.cobranca.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'cobranca_legacy' },
        data: { asaasPaymentId: 'pay_taxa_legacy' },
      }),
    );
    expect(prisma.cobranca.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'cobranca_legacy' },
        data: expect.objectContaining({
          status: 'A_VENCER',
          asaasStatus: 'PENDING',
          asaasValue: 80,
          asaasNetValue: 80,
        }),
      }),
    );
  });

  it('deve criar cobranca de assinatura com forma de pagamento oficial e persistir invoiceUrl do payment', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
      id: 'sub_local_1',
      externalReference: 'subscription:matricula:m1',
      matriculaId: 'm1',
      matricula: {
        id: 'm1',
        alunoId: 'a1',
        planoId: 'p1',
        comboId: null,
        vencimentoDia: 5,
        plano: { id: 'p1', nome: 'Plano Mensal', valor: 75 },
        combo: null,
      },
    } as never);
    vi.mocked(prisma.cobranca.create).mockResolvedValueOnce({
      id: 'c_mensalidade_1',
      matriculaId: 'm1',
      status: 'PENDENTE',
      asaasPaymentId: 'pay_sub_1',
      tipo: 'MENSALIDADE',
      formaPagamento: 'CARTAO_CREDITO',
    } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'c_mensalidade_1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_sub_1',
        status: 'PENDING',
        value: 75,
        netValue: 72.5,
        subscription: 'sub_asaas_1',
        dueDate: '2026-04-05',
        billingType: 'CREDIT_CARD',
        description: 'Mensalidade - Plano Mensal',
        invoiceUrl: 'https://asaas.test/i/pay_sub_1',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formaPagamento: 'CARTAO_CREDITO',
          asaasPaymentId: 'pay_sub_1',
          asaasStatus: 'PENDING',
        }),
      }),
    );
    expect(prisma.charge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          billingType: 'CREDIT_CARD',
          invoiceUrl: 'https://asaas.test/i/pay_sub_1',
          value: 75,
        }),
        create: expect.objectContaining({
          billingType: 'CREDIT_CARD',
          invoiceUrl: 'https://asaas.test/i/pay_sub_1',
          asaasPaymentId: 'pay_sub_1',
        }),
      }),
    );
  });

  it('deve persistir invoiceUrl ao criar charge de assinatura standalone via webhook', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.standaloneSubscription.findFirst).mockResolvedValueOnce({
      id: 'sub_local_1',
      asaasSubscriptionId: 'sub_asaas_1',
      externalReference: 'alusa:standalone-subscription:sub_local_1',
      status: 'ACTIVE',
      description: 'Assinatura recorrente',
      billingType: 'CREDIT_CARD',
      customerId: 'customer_1',
    } as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValueOnce({
      payerType: 'ALUNO',
      payerId: 'aluno_1',
    } as never);
    vi.mocked(prisma.aluno.findFirst).mockResolvedValueOnce({ nome: 'Bryan de Alencar Bezerra' } as never);
    vi.mocked(prisma.charge.upsert).mockResolvedValueOnce({ id: 'charge_standalone_1' } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CREATED',
      payment: {
        id: 'pay_sub_standalone_1',
        status: 'PENDING',
        value: 80,
        netValue: 77.92,
        subscription: 'sub_asaas_1',
        dueDate: '2099-04-05',
        billingType: 'CREDIT_CARD',
        invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
        }),
        create: expect.objectContaining({
          invoiceUrl: 'https://asaas.test/i/pay_sub_standalone_1',
          standaloneSubscriptionId: 'sub_local_1',
        }),
      }),
    );
  });

  it('deve atualizar charge standalone por asaasPaymentId mesmo sem externalReference', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_1',
      cobrancaId: null,
      status: 'OPEN',
      asaasPaymentId: 'pay_1',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_DELETED',
      payment: {
        id: 'pay_1',
        status: 'PENDING',
        deleted: true,
        value: 100,
        netValue: 100,
        externalReference: undefined,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_1', contaId: 'conta-1' },
        data: expect.objectContaining({ status: 'CANCELED' }),
      }),
    );
  });

  it('deve permitir charge standalone voltar de PAID para OVERDUE ao desfazer recebimento em dinheiro', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_cash_undo',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_cash_undo',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      payment: {
        id: 'pay_cash_undo',
        status: 'OVERDUE',
        value: 150,
        netValue: 150,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ch_cash_undo', contaId: 'conta-1' },
        data: expect.objectContaining({ status: 'OVERDUE' }),
      }),
    );
  });

  it('deve auditar regressão bloqueada em charge standalone', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'ch_paid',
      cobrancaId: null,
      status: 'PAID',
      asaasPaymentId: 'pay_paid',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_OVERDUE',
      payment: {
        id: 'pay_paid',
        status: 'OVERDUE',
        value: 100,
        netValue: 100,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.charge.updateMany).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        action: 'finance.webhook.payment_status_regression_blocked',
        entity: { type: 'Charge', id: 'ch_paid' },
        metadata: expect.objectContaining({
          asaasPaymentId: 'pay_paid',
          currentStatus: 'PAID',
          attemptedStatus: 'OVERDUE',
        }),
      }),
    );
  });

  it('deve marcar cobrança como ESTORNADO_PARCIAL e registrar auditoria sensível em estorno parcial', async () => {
    const { prisma } = await import('@alusa/database');
    const { auditLogService } = await import('../../foundation/audit-log.service');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c1',
      matriculaId: 'm1',
      status: 'PAGO',
      asaasPaymentId: 'pay_partial',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce({ id: 'pg_1' } as never);
    vi.mocked(prisma.pagamento.update).mockResolvedValueOnce({ id: 'pg_1' } as never);
    vi.mocked(prisma.lancamento.findFirst)
      .mockResolvedValueOnce({
        id: 'lan_1',
        valor: 100,
        descricao: 'Pagamento confirmado (c1)',
        referencia: 'pagamento:pay_partial',
        formaPagamento: 'BOLETO',
        tipo: 'RECEITA',
        origem: 'SISTEMA',
        status: 'RECEBIDO',
      } as never)
      .mockResolvedValueOnce(null as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_PARTIALLY_REFUNDED',
      payment: {
        id: 'pay_partial',
        status: 'RECEIVED',
        value: 100,
        netValue: 80,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.cobranca.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ESTORNADO_PARCIAL',
          estornadoMotivo: 'Webhook Asaas: estorno parcial',
        }),
      }),
    );
    expect(prisma.lancamento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          valor: 20,
          externalRef: 'asaas:payment:pay_partial:partial-refund',
        }),
      }),
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'finance.webhook.payment_sensitive_event' }),
    );
  });

  it('deve estornar pagamento e lançamento quando webhook de chargeback chegar', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({
      id: 'c2',
      matriculaId: 'm2',
      status: 'PAGO',
      asaasPaymentId: 'pay_chargeback',
      tipo: 'MENSALIDADE',
      formaPagamento: 'BOLETO',
    } as never);
    vi.mocked(prisma.cobranca.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.pagamento.findFirst).mockResolvedValueOnce({ id: 'pg_2' } as never);
    vi.mocked(prisma.pagamento.update).mockResolvedValueOnce({ id: 'pg_2' } as never);
    vi.mocked(prisma.lancamento.findFirst).mockResolvedValueOnce({
      id: 'lan_2',
      valor: 95,
      descricao: 'Pagamento confirmado (c2)',
      referencia: 'pagamento:pay_chargeback',
      formaPagamento: 'BOLETO',
      tipo: 'RECEITA',
      origem: 'SISTEMA',
      status: 'RECEBIDO',
      externalRef: 'asaas:payment:pay_chargeback',
    } as never);

    const result = await handlePaymentWebhook('conta-1', {
      event: 'PAYMENT_CHARGEBACK_REQUESTED',
      payment: {
        id: 'pay_chargeback',
        status: 'CHARGEBACK_REQUESTED',
        value: 100,
        netValue: 95,
      },
    });

    expect(result.success).toBe(true);
    expect(prisma.pagamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pg_2' },
        data: { status: 'ESTORNADO' },
      }),
    );
    expect(prisma.lancamento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lan_2' },
        data: expect.objectContaining({ status: 'ESTORNADO' }),
      }),
    );
  });
});
