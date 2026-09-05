import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/server/matriculas/matricula.service', () => ({
  criarMatricula: vi.fn(),
  listarMatriculas: vi.fn(),
  MatriculaConflictError: class MatriculaConflictError extends Error {
    code = 'MATRICULA_CONFLICT';
  },
}));

vi.mock('@/src/server/matriculas/create-immediate-enrollment.use-case', () => ({
  createImmediateEnrollment: vi.fn(),
  ImmediateEnrollmentCreationError: class ImmediateEnrollmentCreationError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly requiresReconciliation = false,
    ) {
      super(message);
    }
  },
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    cobranca: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true, summary: {} })),
}));

vi.mock('@/src/server/matriculas/enrollment-billing.orchestrator', () => ({
  provisionIndividualEnrollmentBilling: vi.fn(async () => ({
    taxaSync: null,
    subscriptionSync: null,
    cobrancas: { taxa: null, mensalidade: null },
    matriculaSnapshot: { asaasSubscriptionId: null },
  })),
}));

vi.mock('@/src/server/matriculas/enrollment-billing-outbox.service', () => ({
  enqueueEnrollmentBillingOutbox: vi.fn(async () => ({ id: 'outbox-1' })),
}));

vi.mock('@/src/server/matriculas/initial-enrollment-billing-preview.service', () => ({
  previewInitialEnrollmentBilling: vi.fn(async () => ({
    previewHash: 'a'.repeat(64),
    sourceVersion: 'b'.repeat(64),
    expiresAt: '2099-01-01T00:10:00.000Z',
    strategy: 'CREATE_SEPARATE',
    billingStrategy: { kind: 'SEPARATE' },
    compatibility: { compatible: true, blockers: [], warnings: [] },
    totals: { monthlyTotal: 300, enrollmentFeeTotal: 120, itemCount: 1 },
    groups: [],
    snapshot: {},
  })),
}));

vi.mock('@alusa/lib', () => ({
  createEnrollmentCreatedNotification: vi.fn(async () => null),
}));

vi.mock('@alusa/finance', () => ({
  createCharge: vi.fn(async () => ({ success: true, data: { asaasPaymentId: 'pay_1' } })),
  getAsaasPaymentDetails: vi.fn(),
  ensureCustomer: vi.fn(async () => ({
    success: true,
    data: { customerId: 'cust_1', localCustomerId: 'local_1', externalReference: 'customer:r1' },
  })),
  syncCustomerNotificationsForUserSelection: vi.fn(async () => ({
    success: true,
    applied: { email: true, sms: true, whatsapp: false },
    warnings: [],
  })),
  channelPreferencesFromWizardSelection: vi.fn((selected: string[]) => ({
    email: selected.includes('EMAIL'),
    sms: selected.includes('SMS'),
    whatsapp: selected.includes('WHATSAPP'),
  })),
}));

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/matriculas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      previewHash: 'a'.repeat(64),
      sourceVersion: 'b'.repeat(64),
      previewExpiresAt: '2099-01-01T00:10:00.000Z',
      billingStrategy: { kind: 'SEPARATE' },
      uiRequestId: 'request-1',
      ...body,
    }),
  });
}

describe('POST /api/matriculas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna aviso diferido para canais escolhidos sem chamar customer financeiro inline', async () => {
    const { getServerSession } = await import('next-auth');
    const { criarMatricula } = await import('@/src/server/matriculas/matricula.service');
    const { ensureCustomer, syncCustomerNotificationsForUserSelection } =
      await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    vi.mocked(criarMatricula).mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        modeloId: 'modelo-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusContrato: null,
        statusFinanceiro: 'ADIMPLENTE',
        dataInicio: new Date('2099-01-10T00:00:00.000Z'),
        dataFimContrato: new Date('2099-12-10T00:00:00.000Z'),
        taxaMatricula: 120,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        taxaJustificativa: null,
        vencimentoDia: 10,
        asaasId: null,
        asaasSubscriptionId: null,
        createdAt: new Date('2099-01-01T00:00:00.000Z'),
        updatedAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      cobrancas: { taxa: null, mensalidade: null },
      preco: { plano: 300, planoLiquido: 300, taxa: 120, descontosAplicados: [], total: 420 },
      responsavelFinanceiro: {
        id: 'resp-1',
        nome: 'Responsável 1',
        email: 'resp@example.com',
        telefone: '11999999999',
      },
      primeiroVencimento: new Date('2099-02-10T00:00:00.000Z'),
    } as never);

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        modeloId: 'modelo-1',
        turmaId: 'turma-1',
        dataInicio: '2099-01-10',
        dataFimContrato: '2099-12-10',
        vencimentoDia: 10,
        taxaMatricula: 120,
        taxaIsenta: false,
        criarCobranca: false,
        formaPagamento: 'PIX',
        notificationChannels: ['EMAIL', 'SMS'],
        notificationChannelsConfigured: true,
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.notificationSync).toEqual(expect.objectContaining({
      applied: expect.any(Object),
      warnings: expect.any(Array),
    }));
    expect(json.operationalWarnings).toEqual([]);
    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(syncCustomerNotificationsForUserSelection).not.toHaveBeenCalled();
  });

  it('mantem canais desabilitados como aviso assíncrono quando o wizard confirmou a configuração', async () => {
    const { getServerSession } = await import('next-auth');
    const { criarMatricula } = await import('@/src/server/matriculas/matricula.service');
    const { ensureCustomer, syncCustomerNotificationsForUserSelection } =
      await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    vi.mocked(criarMatricula).mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        modeloId: 'modelo-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusContrato: null,
        statusFinanceiro: 'ADIMPLENTE',
        dataInicio: new Date('2099-01-10T00:00:00.000Z'),
        dataFimContrato: new Date('2099-12-10T00:00:00.000Z'),
        taxaMatricula: 120,
        taxaStatus: 'PENDENTE',
        taxaIsenta: false,
        taxaJustificativa: null,
        vencimentoDia: 10,
        asaasId: null,
        asaasSubscriptionId: null,
        createdAt: new Date('2099-01-01T00:00:00.000Z'),
        updatedAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      cobrancas: { taxa: null, mensalidade: null },
      preco: { plano: 300, planoLiquido: 300, taxa: 120, descontosAplicados: [], total: 420 },
      responsavelFinanceiro: {
        id: 'resp-1',
        nome: 'Responsável 1',
        email: 'resp@example.com',
        telefone: '11999999999',
      },
      primeiroVencimento: new Date('2099-02-10T00:00:00.000Z'),
    } as never);

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        modeloId: 'modelo-1',
        turmaId: 'turma-1',
        dataInicio: '2099-01-10',
        dataFimContrato: '2099-12-10',
        vencimentoDia: 10,
        taxaMatricula: 120,
        taxaIsenta: false,
        criarCobranca: false,
        formaPagamento: 'PIX',
        notificationChannels: [],
        notificationChannelsConfigured: true,
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.notificationSync).toEqual(expect.objectContaining({
      applied: expect.any(Object),
      warnings: expect.any(Array),
    }));
    expect(json.operationalWarnings).toEqual([]);
    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(syncCustomerNotificationsForUserSelection).not.toHaveBeenCalled();
  });

  it('confirma o financeiro inline antes de retornar a matrícula', async () => {
    const { getServerSession } = await import('next-auth');
    const { createImmediateEnrollment } = await import(
      '@/src/server/matriculas/create-immediate-enrollment.use-case'
    );
    const { guardFinancialAccountOr412 } = await import('@/lib/finance/financial-account-gate');
    const { enqueueEnrollmentBillingOutbox } = await import(
      '@/src/server/matriculas/enrollment-billing-outbox.service'
    );

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);
    vi.mocked(guardFinancialAccountOr412).mockResolvedValue({
      ok: false,
      response: Response.json(
        {
          code: 'KYC_REQUIRED',
          financialAccount: { status: 'PENDING_ACTIVATION' },
          redirectTo: '/conta/verificacao',
        },
        { status: 412 },
      ) as never,
    });
    vi.mocked(createImmediateEnrollment).mockResolvedValue({
      matricula: {
        id: 'mat-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        comboId: null,
        status: 'ATIVA',
        statusContrato: null,
        statusFinanceiro: 'ADIMPLENTE',
        dataInicio: new Date('2099-01-10T00:00:00.000Z'),
        dataFimContrato: new Date('2099-12-10T00:00:00.000Z'),
        taxaMatricula: 120,
        taxaStatus: 'ISENTO',
        taxaIsenta: true,
        taxaJustificativa: null,
        vencimentoDia: 10,
        asaasId: null,
        asaasSubscriptionId: 'sub-1',
        billingProvisionStatus: 'PROVISIONADO',
        createdAt: new Date('2099-01-01T00:00:00.000Z'),
        updatedAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      cobrancas: {
        taxa: null,
        mensalidade: {
          id: 'cob-1',
          asaasPaymentId: 'pay-1',
          status: 'PENDENTE',
          formaPagamento: 'PIX',
          tipo: 'MENSALIDADE',
        },
      },
      preco: { plano: 300, planoLiquido: 300, taxa: 0, descontosAplicados: [], total: 300 },
      responsavelFinanceiro: {
        id: 'resp-1',
        nome: 'Responsável 1',
        email: 'resp@example.com',
        telefone: '11999999999',
      },
      primeiroVencimento: new Date('2099-02-10T00:00:00.000Z'),
      immediateFinancialSync: {
        subscription: {
          asaasSubscriptionId: 'sub-1',
          externalReference: 'enrollment-op:op-1:subscription',
          firstPayment: {
            asaasPaymentId: 'pay-1',
            externalReference: 'enrollment-op:op-1:subscription',
            value: 300,
            dueDate: '2099-02-10',
            status: 'PENDING',
            invoiceUrl: null,
            bankSlipUrl: null,
          },
        },
        enrollmentFee: null,
      },
    } as never);

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        alunoId: 'aluno-1',
        responsavelFinanceiroId: 'resp-1',
        planoId: 'plano-1',
        modeloId: 'modelo-1',
        turmaId: 'turma-1',
        dataInicio: '2099-01-10',
        dataFimContrato: '2099-12-10',
        vencimentoDia: 10,
        taxaMatricula: 120,
        taxaIsenta: true,
        criarCobranca: true,
        formaPagamento: 'PIX',
      }),
    );

    expect(response.status).toBe(200);
    expect(createImmediateEnrollment).toHaveBeenCalled();
    expect(guardFinancialAccountOr412).not.toHaveBeenCalled();
    expect(enqueueEnrollmentBillingOutbox).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.matricula.billingProvisionStatus).toBe('PROVISIONADO');
    expect(json.asaasSync.subscription).toMatchObject({
      success: true,
      asaasSubscriptionId: 'sub-1',
      asaasPaymentId: 'pay-1',
    });
    expect(json.operationalWarnings).toEqual([]);
  });
});
