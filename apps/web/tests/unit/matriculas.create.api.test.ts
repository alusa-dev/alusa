/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  criarMatriculaMock,
  createChargeMock,
  createSubscriptionMock,
  createEnrollmentCreatedNotificationMock,
  syncInitialSubscriptionPaymentFromAsaasMock,
  syncPaymentStateFromAsaasMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  criarMatriculaMock: vi.fn(),
  createChargeMock: vi.fn(),
  createSubscriptionMock: vi.fn(),
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

vi.mock('@alusa/finance', () => ({
  createCharge: createChargeMock,
  createSubscription: createSubscriptionMock,
  ensureCustomer: vi.fn(),
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

const previewHash = 'a'.repeat(64);
const sourceVersion = 'b'.repeat(64);
const previewExpiresAt = '2099-12-31T00:00:00.000Z';

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
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
      statusContrato: null,
      dataInicio: new Date('2026-04-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'ISENTO',
      taxaIsenta: true,
      taxaJustificativa: null,
      vencimentoDia: 5,
      asaasId: null,
      asaasSubscriptionId: null,
      billingProvisionStatus: 'NAO_APLICAVEL',
      billingProvisionError: null,
      createdAt: new Date('2026-03-31T00:00:00.000Z'),
      updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      ...overrides,
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
    createEnrollmentCreatedNotificationMock.mockResolvedValue(undefined);
  });

  it('salva a matricula local e agenda provisionamento financeiro sem chamar Asaas no commit', async () => {
    mockMatriculaResult();

    const response = await POST(buildRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(criarMatriculaMock).toHaveBeenCalledWith(
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
    expect(data.cobrancas.mensalidade).toBeNull();
    expect(data.matricula.asaasSubscriptionId).toBeNull();
    expect(data.matricula.billingProvisionStatus).toBe('PENDENTE');
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: false,
        error: 'FINANCEIRO_PENDENTE',
        expectedWebhooks: ['PAYMENT_CREATED', 'SUBSCRIPTION_CREATED'],
      }),
    );
    expect(data.operationalWarnings).toContainEqual(
      expect.objectContaining({
        type: 'FINANCIAL_PROVISION_PENDING',
        code: 'FINANCEIRO_PENDENTE',
        severity: 'INFO',
      }),
    );
    expect(createEnrollmentCreatedNotificationMock).toHaveBeenCalledWith({
      contaId: 'conta-1',
      matriculaId: 'mat-1',
      actorUserId: 'user-1',
    });
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

  it('aceita data final igual ao primeiro vencimento e mantem o financeiro assíncrono', async () => {
    mockMatriculaResult({
      dataInicio: new Date('2099-07-01T00:00:00.000Z'),
      dataFimContrato: new Date('2099-07-05T00:00:00.000Z'),
      createdAt: new Date('2099-06-30T00:00:00.000Z'),
      updatedAt: new Date('2099-06-30T00:00:00.000Z'),
    });

    const response = await POST(
      buildRequest({
        dataInicio: '2099-07-01',
        dataFimContrato: '2099-07-05',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.matricula.billingProvisionStatus).toBe('PENDENTE');
    expect(data.asaasSync.subscription?.error).toBe('FINANCEIRO_PENDENTE');
  });

  it('agenda taxa e recorrencia juntas quando ha taxa de matricula', async () => {
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
        statusContrato: null,
        dataInicio: new Date('2026-04-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-03-31T00:00:00.000Z'),
        taxaMatricula: 50,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        taxaJustificativa: null,
        vencimentoDia: 5,
        asaasId: null,
        asaasSubscriptionId: null,
        billingProvisionStatus: 'NAO_APLICAVEL',
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

    const response = await POST(
      buildRequest({
        taxaMatricula: 50,
        taxaIsenta: false,
        gerarCobrancaTaxa: true,
        formaPagamentoTaxa: 'PIX',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(createChargeMock).not.toHaveBeenCalled();
    expect(createSubscriptionMock).not.toHaveBeenCalled();
    expect(data.matricula.billingProvisionStatus).toBe('PENDENTE');
    expect(data.asaasSync.taxa).toEqual(
      expect.objectContaining({
        success: false,
        error: 'FINANCEIRO_PENDENTE',
      }),
    );
    expect(data.asaasSync.subscription).toEqual(
      expect.objectContaining({
        success: false,
        error: 'FINANCEIRO_PENDENTE',
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
});
