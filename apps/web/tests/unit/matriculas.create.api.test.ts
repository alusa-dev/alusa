/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  criarMatriculaMock,
  prismaMock,
  createChargeMock,
  createSubscriptionMock,
  getAsaasPaymentDetailsMock,
  createEnrollmentCreatedNotificationMock,
  syncInitialSubscriptionPaymentFromAsaasMock,
  syncPaymentStateFromAsaasMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  criarMatriculaMock: vi.fn(),
  prismaMock: {
    matricula: {
      findUnique: vi.fn(),
    },
    cobranca: {
      update: vi.fn(),
    },
  },
  createChargeMock: vi.fn(),
  createSubscriptionMock: vi.fn(),
  getAsaasPaymentDetailsMock: vi.fn(),
  createEnrollmentCreatedNotificationMock: vi.fn(),
  syncInitialSubscriptionPaymentFromAsaasMock: vi.fn(),
  syncPaymentStateFromAsaasMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/server/matriculas/matricula.service', () => ({
  criarMatricula: criarMatriculaMock,
  listarMatriculas: vi.fn(),
  MatriculaConflictError: class MatriculaConflictError extends Error {
    code = 'MATRICULA_DUPLICADA_TURMA';
  },
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  createCharge: createChargeMock,
  createSubscription: createSubscriptionMock,
  ensureCustomer: vi.fn(),
  getAsaasPaymentDetails: getAsaasPaymentDetailsMock,
  syncPaymentStateFromAsaas: syncPaymentStateFromAsaasMock,
  syncCustomerNotificationChannels: vi.fn(),
}));

vi.mock('@alusa/lib', () => ({
  createEnrollmentCreatedNotification: createEnrollmentCreatedNotificationMock,
}));

vi.mock('@/src/server/matriculas/subscription-payment-materialization', () => ({
  syncInitialSubscriptionPaymentFromAsaas: syncInitialSubscriptionPaymentFromAsaasMock,
}));

const { POST } = await import('@/app/api/matriculas/route');

describe('POST /api/matriculas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: {
        id: 'user-1',
        contaId: 'conta-1',
        role: 'ADMIN',
      },
    });
    createEnrollmentCreatedNotificationMock.mockResolvedValue(undefined);
    createChargeMock.mockResolvedValue({ success: true, data: { asaasPaymentId: 'pay_taxa_1' } });
    getAsaasPaymentDetailsMock.mockResolvedValue({
      payment: {
        id: 'pay_taxa_1',
        invoiceUrl: 'https://sandbox.asaas.com/i/pay_taxa_1',
        bankSlipUrl: null,
      },
    });
    syncPaymentStateFromAsaasMock.mockResolvedValue({
      success: true,
      paymentStatus: 'PENDING',
      appliedEvent: 'PAYMENT_CREATED',
    });
    syncInitialSubscriptionPaymentFromAsaasMock.mockResolvedValue({
      found: false,
      processed: false,
      matchedBy: null,
      payment: null,
      localCharge: null,
    });
  });

  it('cria a assinatura no ato da matrícula sem fabricar mensalidade local', async () => {
    criarMatriculaMock.mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: null,
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusFinanceiro: 'ADIMPLENTE',
        dataInicio: new Date('2026-04-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
        taxaMatricula: 0,
        taxaStatus: 'ISENTO',
        taxaIsenta: true,
        taxaJustificativa: null,
        vencimentoDia: 5,
        asaasId: null,
        asaasSubscriptionId: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      },
      cobrancas: {
        taxa: null,
        mensalidade: null,
      },
      preco: {
        plano: 150,
        planoLiquido: 75,
        taxa: 0,
        descontosAplicados: [75],
        total: 75,
      },
      responsavelFinanceiro: null,
      primeiroVencimento: new Date('2026-04-05T00:00:00.000Z'),
    });

    prismaMock.matricula.findUnique.mockResolvedValue({
      id: 'mat-1',
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
      vencimentoDia: 5,
      formaPagamento: 'CARTAO_CREDITO',
      descontoAntecipado: null,
      prazoDesconto: null,
      descontoTipo: 'PERCENTAGE',
      jurosMensal: null,
      multaPercentual: null,
      multaTipo: 'PERCENTAGE',
      plano: {
        id: 'plano-1',
        nome: 'Plano Mensal',
        periodicidade: 'MENSAL',
      },
      combo: null,
    });

    createSubscriptionMock.mockResolvedValue({
      success: true,
      data: {
        asaasSubscriptionId: 'sub_asaas_1',
        subscriptionId: 'sub-local-1',
        externalReference: 'alusa:subscription:mat-1:plano-1',
        status: 'ACTIVE',
        createdAt: '2026-03-31T00:00:00.000Z',
        statusUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    });

    const req = new Request('http://localhost/api/matriculas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        dataInicio: '2026-04-01',
        dataFimContrato: '2027-03-31',
        vencimentoDia: 5,
        taxaMatricula: 0,
        taxaIsenta: true,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: false,
        criarCobranca: true,
        formaPagamento: 'CARTAO_CREDITO',
        formaPagamentoTaxa: 'BOLETO',
        notificationChannels: [],
      }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSubscriptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        contratoId: null,
        matriculaId: 'mat-1',
        value: 75,
        billingType: 'CREDIT_CARD',
      }),
    );
    expect(data.cobrancas.mensalidade).toBeNull();
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub_asaas_1',
        expectedWebhooks: ['SUBSCRIPTION_CREATED', 'PAYMENT_CREATED'],
      }),
    );
    expect(data.matricula.asaasSubscriptionId).toBe('sub_asaas_1');
    expect(syncInitialSubscriptionPaymentFromAsaasMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        asaasSubscriptionId: 'sub_asaas_1',
        intent: 'RECONCILIATION',
        targetDueDate: expect.any(Date),
      }),
    );
    const syncCall = syncInitialSubscriptionPaymentFromAsaasMock.mock.calls[0]?.[0];
    expect(syncCall?.targetDueDate.toISOString().slice(0, 10)).toBe('2026-04-05');
  });

  it('materializa o primeiro ciclo oficial do Asaas ainda no fechamento da matrícula quando ele já existe', async () => {
    criarMatriculaMock.mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: null,
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusFinanceiro: 'ADIMPLENTE',
        dataInicio: new Date('2026-04-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
        taxaMatricula: 0,
        taxaStatus: 'ISENTO',
        taxaIsenta: true,
        taxaJustificativa: null,
        vencimentoDia: 5,
        asaasId: null,
        asaasSubscriptionId: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      },
      cobrancas: {
        taxa: null,
        mensalidade: null,
      },
      preco: {
        plano: 150,
        planoLiquido: 75,
        taxa: 0,
        descontosAplicados: [75],
        total: 75,
      },
      responsavelFinanceiro: null,
      primeiroVencimento: new Date('2026-04-05T00:00:00.000Z'),
    });

    prismaMock.matricula.findUnique.mockResolvedValue({
      id: 'mat-1',
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
      vencimentoDia: 5,
      formaPagamento: 'CARTAO_CREDITO',
      descontoAntecipado: null,
      prazoDesconto: null,
      descontoTipo: 'PERCENTAGE',
      jurosMensal: null,
      multaPercentual: null,
      multaTipo: 'PERCENTAGE',
      plano: {
        id: 'plano-1',
        nome: 'Plano Mensal',
        periodicidade: 'MENSAL',
      },
      combo: null,
    });

    createSubscriptionMock.mockResolvedValue({
      success: true,
      data: {
        asaasSubscriptionId: 'sub_asaas_1',
        subscriptionId: 'sub-local-1',
        externalReference: 'alusa:subscription:mat-1:plano-1',
        status: 'ACTIVE',
        createdAt: '2026-03-31T00:00:00.000Z',
        statusUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    });

    syncInitialSubscriptionPaymentFromAsaasMock.mockResolvedValue({
      found: true,
      processed: true,
      matchedBy: 'EXACT_DUE_DATE',
      payment: {
        id: 'pay_asaas_1',
        status: 'PENDING',
        dueDate: '2026-04-05',
        value: 75,
        netValue: 72,
        invoiceUrl: 'https://sandbox.asaas.com/i/pay_asaas_1',
        bankSlipUrl: null,
      },
      localCharge: {
        id: 'cobr-1',
        valor: 75,
        status: 'PENDENTE',
        formaPagamento: 'CARTAO_CREDITO',
        tipo: 'MENSALIDADE',
        vencimento: new Date('2026-04-05T00:00:00.000Z'),
        descricao: 'Mensalidade',
        asaasPaymentId: 'pay_asaas_1',
        asaasId: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        competenciaInicio: new Date('2026-04-01T00:00:00.000Z'),
        competenciaFim: new Date('2026-04-30T00:00:00.000Z'),
        dataPagamento: null,
      },
    });

    const req = new Request('http://localhost/api/matriculas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        dataInicio: '2026-04-01',
        dataFimContrato: '2027-03-31',
        vencimentoDia: 5,
        taxaMatricula: 0,
        taxaIsenta: true,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: false,
        criarCobranca: true,
        formaPagamento: 'CARTAO_CREDITO',
        formaPagamentoTaxa: 'BOLETO',
        notificationChannels: [],
      }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.cobrancas.mensalidade).toMatchObject({
      id: 'cobr-1',
      asaasPaymentId: 'pay_asaas_1',
      valor: 75,
    });
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub_asaas_1',
        asaasPaymentId: 'pay_asaas_1',
        invoiceUrl: 'https://sandbox.asaas.com/i/pay_asaas_1',
        expectedWebhooks: [],
      }),
    );
  });

  it('bloqueia a assinatura quando a taxa nao materializa pelo payment oficial do Asaas', async () => {
    criarMatriculaMock.mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: null,
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusFinanceiro: 'PENDENTE_TAXA',
        dataInicio: new Date('2026-04-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
        taxaMatricula: 50,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        taxaJustificativa: null,
        vencimentoDia: 5,
        asaasId: null,
        asaasSubscriptionId: null,
        createdAt: new Date('2026-03-31T00:00:00.000Z'),
        updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      },
      cobrancas: {
        taxa: {
          id: 'cob_taxa_1',
          matriculaId: 'mat-1',
          valor: 50,
          vencimento: new Date('2026-04-01T00:00:00.000Z'),
          status: 'PENDENTE',
          formaPagamento: 'PIX',
          tipo: 'TAXA_MATRICULA',
          descricao: 'Taxa de matrícula',
          asaasId: null,
          asaasPaymentId: null,
          createdAt: new Date('2026-03-31T00:00:00.000Z'),
          competenciaInicio: new Date('2026-04-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-04-30T00:00:00.000Z'),
          dataPagamento: null,
        },
        mensalidade: null,
      },
      preco: {
        plano: 150,
        planoLiquido: 75,
        taxa: 50,
        descontosAplicados: [],
        total: 125,
      },
      responsavelFinanceiro: null,
      primeiroVencimento: new Date('2026-04-05T00:00:00.000Z'),
    });

    createChargeMock.mockResolvedValue({
      success: true,
      data: {
        cobrancaId: 'cob_taxa_1',
        chargeId: 'cob_taxa_1',
        asaasPaymentId: 'pay_taxa_1',
        externalReference: 'charge:cob_taxa_1',
      },
    });
    syncPaymentStateFromAsaasMock.mockResolvedValue({
      success: false,
      error: 'SYNC_PIPELINE_FAILED',
    });

    const req = new Request('http://localhost/api/matriculas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        dataInicio: '2026-04-01',
        dataFimContrato: '2027-03-31',
        vencimentoDia: 5,
        taxaMatricula: 50,
        taxaIsenta: false,
        pagarTaxaAgora: false,
        gerarCobrancaTaxa: true,
        criarCobranca: true,
        formaPagamento: 'CARTAO_CREDITO',
        formaPagamentoTaxa: 'PIX',
        notificationChannels: [],
      }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(syncPaymentStateFromAsaasMock).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_taxa_1',
      eventName: 'PAYMENT_CREATED',
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.cobrancas.taxa).toMatchObject({
      id: 'cob_taxa_1',
      asaasPaymentId: 'pay_taxa_1',
    });
    expect(data.asaasSync.taxa).toEqual(
      expect.objectContaining({
        success: false,
        error: 'SYNC_PIPELINE_FAILED',
        asaasPaymentId: 'pay_taxa_1',
        invoiceUrl: 'https://sandbox.asaas.com/i/pay_taxa_1',
      }),
    );
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: false,
        error: 'TAXA_ASAAS_NAO_CONFIRMADA',
      }),
    );
  });
});
