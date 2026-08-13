/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  criarMatriculaMock,
  buscarMatriculaPorIdMock,
  createImmediateEnrollmentMock,
  processEnrollmentBillingOutboxEventMock,
  createChargeMock,
  createSubscriptionMock,
  syncInitialSubscriptionPaymentFromAsaasMock,
  syncPaymentStateFromAsaasMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  criarMatriculaMock: vi.fn(),
  buscarMatriculaPorIdMock: vi.fn(),
  createImmediateEnrollmentMock: vi.fn(),
  processEnrollmentBillingOutboxEventMock: vi.fn(),
  createChargeMock: vi.fn(),
  createSubscriptionMock: vi.fn(),
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
  buscarMatriculaPorId: buscarMatriculaPorIdMock,
  listarMatriculas: vi.fn(),
  MatriculaConflictError: class MatriculaConflictError extends Error {
    code = 'MATRICULA_DUPLICADA_TURMA';
  },
}));

vi.mock('@/src/server/matriculas/enrollment-billing-outbox.service', () => ({
  processEnrollmentBillingOutboxEvent: processEnrollmentBillingOutboxEventMock,
}));

vi.mock('@/src/server/matriculas/create-immediate-enrollment.use-case', () => ({
  createImmediateEnrollment: createImmediateEnrollmentMock,
  ImmediateEnrollmentCreationError: class ImmediateEnrollmentCreationError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly requiresReconciliation = false,
      readonly reasonCode?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock('@alusa/finance', () => ({
  createCharge: createChargeMock,
  createSubscription: createSubscriptionMock,
  ensureCustomer: vi.fn(),
  syncPaymentStateFromAsaas: syncPaymentStateFromAsaasMock,
  syncCustomerNotificationChannels: vi.fn(),
}));

vi.mock('@alusa/lib', () => ({
}));

vi.mock('@/src/server/matriculas/subscription-payment-materialization', () => ({
  syncInitialSubscriptionPaymentFromAsaas: syncInitialSubscriptionPaymentFromAsaasMock,
}));

const { POST } = await import('@/app/api/matriculas/route');

const previewHash = 'a'.repeat(64);
const sourceVersion = 'b'.repeat(64);
const previewExpiresAt = '2099-12-31T00:00:00.000Z';

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    contaId: 'conta-1',
    alunoId: 'aluno-1',
    planoId: 'plano-1',
    modeloId: 'modelo-1',
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
    uiRequestId: 'ui-request-1',
    previewHash,
    sourceVersion,
    previewExpiresAt,
    billingStrategy: { kind: 'SEPARATE' },
    ...overrides,
  };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/matriculas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildBody(overrides)),
  });
}

function mockMatriculaResult(overrides: Record<string, unknown> = {}) {
  createImmediateEnrollmentMock.mockResolvedValue({
    matricula: {
      id: 'mat-1',
      alunoId: 'aluno-1',
      responsavelFinanceiroId: null,
      planoId: 'plano-1',
      turmaId: 'turma-1',
      comboId: null,
      status: 'ATIVA',
      statusFinanceiro: 'ADIMPLENTE',
      statusContrato: null,
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'ISENTO',
      taxaIsenta: true,
      taxaJustificativa: null,
      vencimentoDia: 5,
      asaasId: null,
      asaasSubscriptionId: 'sub-1',
      billingProvisionStatus: 'PROVISIONADO',
      billingProvisionError: null,
      createdAt: new Date('2026-03-31T00:00:00.000Z'),
      updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      ...overrides,
    },
    cobrancas: {
      taxa: null,
      mensalidade: {
        id: 'cob-mensal-1',
        asaasPaymentId: 'pay-monthly-1',
        status: 'PENDENTE',
        formaPagamento: 'CARTAO_CREDITO',
        tipo: 'MENSALIDADE',
      },
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
    immediateFinancialSync: {
      subscription: {
        asaasSubscriptionId: 'sub-1',
        externalReference: 'enrollment-op:op-1:subscription',
        firstPayment: {
          asaasPaymentId: 'pay-monthly-1',
          externalReference: 'enrollment-op:op-1:subscription',
          value: 75,
          dueDate: '2026-04-05',
          status: 'PENDING',
          invoiceUrl: 'https://example.test/monthly',
          bankSlipUrl: null,
        },
      },
      enrollmentFee: null,
    },
  });
}

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
  });

  it('só retorna sucesso depois de confirmar assinatura e primeira mensalidade', async () => {
    mockMatriculaResult();

    const response = await POST(buildRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createImmediateEnrollmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        uiRequestId: 'ui-request-1',
        billingStrategy: { kind: 'SEPARATE' },
        billingPreview: expect.objectContaining({
          previewHash,
          sourceVersion,
          billingStrategy: { kind: 'SEPARATE' },
        }),
      }),
    );
    expect(createChargeMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(syncPaymentStateFromAsaasMock).not.toHaveBeenCalled();
    expect(syncInitialSubscriptionPaymentFromAsaasMock).not.toHaveBeenCalled();
    expect(data.cobrancas.mensalidade.asaasPaymentId).toBe('pay-monthly-1');
    expect(data.matricula.asaasSubscriptionId).toBe('sub-1');
    expect(data.matricula.billingProvisionStatus).toBe('PROVISIONADO');
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub-1',
        asaasPaymentId: 'pay-monthly-1',
      }),
    );
    expect(data.operationalWarnings).toEqual([]);
  });

  it('confirma sincronamente a inclusão em assinatura existente antes de retornar sucesso', async () => {
    const matricula = {
      id: 'mat-merge-1',
      alunoId: 'aluno-1',
      responsavelFinanceiroId: null,
      planoId: 'plano-1',
      turmaId: 'turma-1',
      comboId: null,
      status: 'AGUARDANDO_CONFIRMACAO',
      statusFinanceiro: 'ADIMPLENTE',
      statusContrato: 'AGUARDANDO_ASSINATURA',
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'ISENTO',
      taxaIsenta: true,
      taxaJustificativa: null,
      vencimentoDia: 5,
      asaasId: null,
      asaasSubscriptionId: null,
      billingProvisionStatus: 'PENDENTE',
      billingProvisionError: null,
      createdAt: new Date('2026-03-31T00:00:00.000Z'),
      updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      cobrancas: [],
    };
    criarMatriculaMock.mockResolvedValue({
      matricula,
      cobrancas: { taxa: null, mensalidade: null },
      preco: { plano: 150, planoLiquido: 150, taxa: 0, descontosAplicados: [], total: 150 },
      responsavelFinanceiro: null,
      primeiroVencimento: new Date('2026-04-05T00:00:00.000Z'),
      billingOutboxEventId: 'outbox-merge-1',
      contratoId: 'contract-merge-1',
    });
    processEnrollmentBillingOutboxEventMock.mockResolvedValue({
      eventId: 'outbox-merge-1',
      matriculaId: 'mat-merge-1',
      status: 'PROCESSED',
    });
    buscarMatriculaPorIdMock.mockResolvedValue({
      ...matricula,
      status: 'ATIVA',
      billingProvisionStatus: 'PROVISIONADO',
      cobrancas: [],
    });

    const response = await POST(buildRequest({
      billingStrategy: {
        kind: 'JOIN_EXISTING_CURRENT_CYCLE',
        financialGroupId: 'subscription:subscription-1',
        effectiveAt: '2026-04-01T00:00:00.000Z',
      },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createImmediateEnrollmentMock).not.toHaveBeenCalled();
    expect(criarMatriculaMock).toHaveBeenCalledWith(expect.objectContaining({
      billingStrategy: expect.objectContaining({ kind: 'JOIN_EXISTING_CURRENT_CYCLE' }),
    }));
    expect(processEnrollmentBillingOutboxEventMock).toHaveBeenCalledWith('outbox-merge-1');
    expect(data.matricula.status).toBe('ATIVA');
    expect(data.matricula.billingProvisionStatus).toBe('PROVISIONADO');
  });

  it('bloqueia assinatura quando a data final vem antes do primeiro vencimento calculado', async () => {
    const response = await POST(
      buildRequest({
        dataFimContrato: '2026-04-04',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toEqual(
      expect.objectContaining({
        code: 'DATA_FIM_INVALIDA',
      }),
    );
    expect(criarMatriculaMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it('rejeita contrato que não comporta recorrência sem criar matrícula', async () => {
    const { ImmediateEnrollmentCreationError } = await import(
      '@/src/server/matriculas/create-immediate-enrollment.use-case'
    );
    createImmediateEnrollmentMock.mockRejectedValueOnce(
      new ImmediateEnrollmentCreationError(
        'CONTRATO_SEM_RECORRENCIA',
        'A vigência precisa comportar dois vencimentos.',
      ),
    );

    const response = await POST(
      buildRequest({
        dataInicio: '2099-07-01',
        dataFimContrato: '2099-07-05',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.error.code).toBe('CONTRATO_SEM_RECORRENCIA');
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('preserva o motivo financeiro seguro para o wizard exibir uma ação clara', async () => {
    const { ImmediateEnrollmentCreationError } = await import(
      '@/src/server/matriculas/create-immediate-enrollment.use-case'
    );
    createImmediateEnrollmentMock.mockRejectedValueOnce(
      new ImmediateEnrollmentCreationError(
        'FINANCEIRO_NAO_CONFIRMADO',
        'A primeira mensalidade não foi confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
        false,
        'FIRST_SUBSCRIPTION_PAYMENT_NOT_CONFIRMED',
      ),
    );

    const response = await POST(buildRequest());
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toEqual(
      expect.objectContaining({
        code: 'FINANCEIRO_NAO_CONFIRMADO',
        message: 'A primeira mensalidade não foi confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
        details: expect.objectContaining({
          reasonCode: 'FIRST_SUBSCRIPTION_PAYMENT_NOT_CONFIRMED',
        }),
      }),
    );
  });

  it('agenda taxa e recorrencia juntas quando ha taxa de matricula', async () => {
    createImmediateEnrollmentMock.mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: null,
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusFinanceiro: 'PENDENTE_TAXA',
        statusContrato: null,
        dataInicio: new Date('2026-04-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
        taxaMatricula: 50,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        taxaJustificativa: null,
        vencimentoDia: 5,
        asaasId: null,
        asaasSubscriptionId: 'sub-1',
        billingProvisionStatus: 'PROVISIONADO',
        billingProvisionError: null,
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
          descricao: 'Taxa de matricula',
          asaasId: null,
          asaasPaymentId: null,
          createdAt: new Date('2026-03-31T00:00:00.000Z'),
          competenciaInicio: new Date('2026-04-01T00:00:00.000Z'),
          competenciaFim: new Date('2026-04-30T00:00:00.000Z'),
          dataPagamento: null,
        },
        mensalidade: {
          id: 'cob-monthly-1',
          asaasPaymentId: 'pay-monthly-1',
          status: 'PENDENTE',
          formaPagamento: 'CARTAO_CREDITO',
          tipo: 'MENSALIDADE',
        },
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
      immediateFinancialSync: {
        subscription: {
          asaasSubscriptionId: 'sub-1',
          externalReference: 'enrollment-op:op-1:subscription',
          firstPayment: {
            asaasPaymentId: 'pay-monthly-1',
            externalReference: 'enrollment-op:op-1:subscription',
            value: 75,
            dueDate: '2026-04-05',
            status: 'PENDING',
            invoiceUrl: null,
            bankSlipUrl: null,
          },
        },
        enrollmentFee: {
          asaasPaymentId: 'pay-fee-1',
          externalReference: 'enrollment-op:op-1:fee',
          value: 50,
          dueDate: '2026-04-01',
          status: 'PENDING',
          invoiceUrl: null,
          bankSlipUrl: null,
        },
      },
    });

    const response = await POST(
      buildRequest({
        taxaMatricula: 50,
        taxaIsenta: false,
        pagarTaxaAgora: true,
        gerarCobrancaTaxa: true,
        formaPagamentoTaxa: 'PIX',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createChargeMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.matricula.billingProvisionStatus).toBe('PROVISIONADO');
    expect(data.asaasSync.taxa).toEqual(
      expect.objectContaining({
        success: true,
        asaasPaymentId: 'pay-fee-1',
      }),
    );
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: true,
        asaasSubscriptionId: 'sub-1',
      }),
    );
  });

  it('exige chave de idempotencia para confirmar a matricula', async () => {
    const response = await POST(
      buildRequest({
        uiRequestId: undefined,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toEqual(
      expect.objectContaining({
        code: 'IDEMPOTENCY_KEY_OBRIGATORIA',
      }),
    );
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('rejeita preview expirado antes de criar a matricula', async () => {
    const response = await POST(
      buildRequest({
        previewExpiresAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toEqual(
      expect.objectContaining({
        code: 'PREVIEW_EXPIRADO',
      }),
    );
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('não permite criar taxa avulsa sem a assinatura da mensalidade', async () => {
    const response = await POST(
      buildRequest({
        criarCobranca: false,
        taxaMatricula: 50,
        taxaIsenta: false,
        pagarTaxaAgora: true,
        gerarCobrancaTaxa: true,
        formaPagamentoTaxa: 'PIX',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('ASSINATURA_OBRIGATORIA_PARA_MATRICULA_FINANCEIRA');
    expect(createImmediateEnrollmentMock).not.toHaveBeenCalled();
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('não aceita contaId do payload quando a sessão não possui conta ativa', async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'ADMIN' },
    });

    const response = await POST(buildRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe('CONTA_SESSAO_OBRIGATORIA');
    expect(createImmediateEnrollmentMock).not.toHaveBeenCalled();
  });
});
