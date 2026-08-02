import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormaPagamento, PeriodicidadePlano } from '@prisma/client';

const {
  prismaMock,
  stageMock,
  compensateMock,
  previewMock,
  criarMatriculaMock,
} = vi.hoisted(() => ({
  prismaMock: {
    aluno: { findFirst: vi.fn() },
    plano: { findFirst: vi.fn() },
    combo: { findFirst: vi.fn() },
    matricula: { findFirst: vi.fn() },
    enrollmentCreationOperation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  stageMock: vi.fn(),
  compensateMock: vi.fn(),
  previewMock: vi.fn(),
  criarMatriculaMock: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: vi.fn(async (_contaId: string, callback: (tx: unknown) => Promise<unknown>) =>
    callback(prismaMock),
  ),
}));
vi.mock('@alusa/domain', () => ({
  resolvePayer: vi.fn(() => ({ success: true, payer: { type: 'RESPONSAVEL', id: 'resp-1' } })),
}));
vi.mock('@alusa/finance', () => ({
  stageEnrollmentFinancialResources: stageMock,
  compensateStagedEnrollmentFinancialResources: compensateMock,
}));
vi.mock('./initial-enrollment-billing-preview.service', () => ({
  previewInitialEnrollmentBilling: previewMock,
}));
vi.mock('./matricula.service', () => ({
  criarMatricula: criarMatriculaMock,
}));

import {
  createImmediateEnrollment,
  ImmediateEnrollmentCreationError,
} from './create-immediate-enrollment.use-case';

function input(overrides: Record<string, unknown> = {}) {
  return {
    contaId: 'conta-1',
    alunoId: 'aluno-1',
    planoId: 'plano-1',
    turmaId: 'turma-1',
    comboId: null,
    responsavelFinanceiroId: 'resp-1',
    dataInicio: new Date('2099-01-01T12:00:00.000Z'),
    dataFimContrato: new Date('2099-12-31T12:00:00.000Z'),
    vencimentoDia: 5,
    taxaMatricula: 80,
    taxaIsenta: false,
    pagarTaxaAgora: false,
    gerarCobrancaTaxa: true,
    criarCobranca: true,
    formaPagamento: FormaPagamento.BOLETO,
    formaPagamentoTaxa: FormaPagamento.PIX,
    createdById: 'user-1',
    modeloId: 'modelo-1',
    descontoIds: [],
    uiRequestId: 'request-1',
    billingStrategy: { kind: 'SEPARATE' as const },
    ...overrides,
  };
}

const staged = {
  operationId: 'op-1',
  customer: { localCustomerId: 'customer-local-1', asaasCustomerId: 'cus-1' },
  subscription: {
    asaasSubscriptionId: 'sub-1',
    externalReference: 'enrollment-op:op-1:subscription',
    firstPayment: {
      asaasPaymentId: 'pay-monthly-1',
      externalReference: 'enrollment-op:op-1:subscription',
      value: 150,
      dueDate: '2099-01-05',
      status: 'PENDING',
      invoiceUrl: 'https://example.test/monthly',
      bankSlipUrl: null,
    },
  },
  enrollmentFee: {
    asaasPaymentId: 'pay-fee-1',
    externalReference: 'enrollment-op:op-1:fee',
    value: 80,
    dueDate: '2099-01-01',
    status: 'PENDING',
    invoiceUrl: 'https://example.test/fee',
    bankSlipUrl: null,
  },
};

describe('createImmediateEnrollment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.enrollmentCreationOperation.findFirst.mockResolvedValue(null);
    prismaMock.matricula.findFirst.mockResolvedValue(null);
    prismaMock.aluno.findFirst.mockResolvedValue({
      id: 'aluno-1',
      dataNasc: new Date('2010-01-01T00:00:00.000Z'),
    });
    prismaMock.plano.findFirst.mockResolvedValue({
      id: 'plano-1',
      nome: 'Plano mensal',
      periodicidade: PeriodicidadePlano.MENSAL,
    });
    prismaMock.combo.findFirst.mockResolvedValue(null);
    prismaMock.enrollmentCreationOperation.create.mockResolvedValue({ id: 'op-1' });
    prismaMock.enrollmentCreationOperation.updateMany.mockResolvedValue({ count: 1 });
    previewMock.mockResolvedValue({
      previewHash: 'a'.repeat(64),
      sourceVersion: 'b'.repeat(64),
      compatibility: { compatible: true, blockers: [] },
      totals: { monthlyTotal: 150, enrollmentFeeTotal: 80 },
    });
    stageMock.mockResolvedValue({ success: true, data: staged });
    criarMatriculaMock.mockResolvedValue({
      matricula: { id: 'matricula-1', billingProvisionStatus: 'PROVISIONADO' },
      cobrancas: {},
    });
    compensateMock.mockResolvedValue({
      complete: true,
      deletedPaymentIds: ['pay-monthly-1', 'pay-fee-1'],
      deletedFirstSubscriptionPaymentId: 'pay-monthly-1',
      deletedEnrollmentFeePaymentId: 'pay-fee-1',
      deletedSubscriptionId: 'sub-1',
      errors: [],
    });
  });

  it('só publica a matrícula depois de confirmar assinatura, primeira mensalidade e taxa', async () => {
    const result = await createImmediateEnrollment(input());

    expect(stageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-1',
        subscription: expect.objectContaining({ value: 150 }),
        enrollmentFee: expect.objectContaining({ value: 80 }),
      }),
    );
    expect(criarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preprovisionedBilling: expect.objectContaining({
          subscription: expect.objectContaining({ asaasSubscriptionId: 'sub-1' }),
        }),
      }),
    );
    expect(result.matricula.id).toBe('matricula-1');
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMMITTED' }) }),
    );
  });

  it('não cria matrícula quando o provisionamento remoto falha e foi compensado', async () => {
    stageMock.mockResolvedValueOnce({
      success: false,
      error: 'ENROLLMENT_FEE_RESULT_UNKNOWN',
      resultUnknown: false,
      compensation: { complete: true, errors: [] },
    });

    await expect(createImmediateEnrollment(input())).rejects.toMatchObject({
      code: 'FINANCEIRO_NAO_CONFIRMADO',
      reasonCode: 'ENROLLMENT_FEE_RESULT_UNKNOWN',
      message: 'A taxa de matrícula não pôde ser confirmada pelo financeiro. Nenhuma matrícula foi concluída.',
    });
    expect(criarMatriculaMock).not.toHaveBeenCalled();
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPENSATED' }) }),
    );
  });

  it('compensa os recursos remotos quando o commit local falha', async () => {
    criarMatriculaMock.mockRejectedValueOnce(new Error('DB_COMMIT_FAILED'));

    await expect(createImmediateEnrollment(input())).rejects.toMatchObject({
      code: 'MATRICULA_COMMIT_FALHOU',
    });
    expect(compensateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        asaasSubscriptionId: 'sub-1',
        firstSubscriptionPaymentId: 'pay-monthly-1',
        enrollmentFeePaymentId: 'pay-fee-1',
      }),
    );
    expect(prismaMock.enrollmentCreationOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPENSATED' }) }),
    );
  });

  it('preserva os recursos se não conseguir adquirir o fencing de compensação', async () => {
    criarMatriculaMock.mockRejectedValueOnce(new Error('DB_COMMIT_FAILED'));
    prismaMock.enrollmentCreationOperation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('COMPENSATING_STATE_FAILED'));

    await expect(createImmediateEnrollment(input())).rejects.toMatchObject({
      code: 'CRIACAO_EM_PROCESSAMENTO',
    });
    expect(compensateMock).not.toHaveBeenCalled();
  });

  it('compensa quando não consegue registrar os IDs remotos antes do commit local', async () => {
    prismaMock.enrollmentCreationOperation.updateMany.mockRejectedValueOnce(
      new Error('REMOTE_STATE_DB_FAILED'),
    );

    await expect(createImmediateEnrollment(input())).rejects.toMatchObject({
      code: 'MATRICULA_COMMIT_FALHOU',
    });
    expect(criarMatriculaMock).not.toHaveBeenCalled();
    expect(compensateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        asaasSubscriptionId: 'sub-1',
        firstSubscriptionPaymentId: 'pay-monthly-1',
        enrollmentFeePaymentId: 'pay-fee-1',
      }),
    );
  });

  it('não compensa se apenas a finalização da saga falhar depois do commit local', async () => {
    prismaMock.enrollmentCreationOperation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('COMMITTED_STATE_DB_FAILED'));

    const result = await createImmediateEnrollment(input());

    expect(result.matricula.id).toBe('matricula-1');
    expect(compensateMock).not.toHaveBeenCalled();
  });

  it('não compensa quando o commit respondeu com erro mas a matrícula foi persistida', async () => {
    criarMatriculaMock.mockRejectedValueOnce(new Error('CONNECTION_LOST_AFTER_COMMIT'));
    prismaMock.matricula.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'matricula-1', asaasSubscriptionId: 'sub-1' });

    const recovered = await createImmediateEnrollment(input());

    expect(recovered.matricula.id).toBe('matricula-1');
    expect(compensateMock).not.toHaveBeenCalled();
  });

  it('bloqueia assinatura cuja vigência não comporta o segundo ciclo', async () => {
    await expect(
      createImmediateEnrollment(
        input({ dataFimContrato: new Date('2099-01-05T12:00:00.000Z') }),
      ),
    ).rejects.toMatchObject({ code: 'CONTRATO_SEM_RECORRENCIA' });
    expect(stageMock).not.toHaveBeenCalled();
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('bloqueia estratégia de agrupamento para não criar uma segunda assinatura por engano', async () => {
    await expect(
      createImmediateEnrollment(
        input({ billingStrategy: { kind: 'JOIN_EXISTING', subscriptionId: 'sub-local-1' } }),
      ),
    ).rejects.toMatchObject({
      code: 'ESTRATEGIA_FINANCEIRA_NAO_SUPORTADA_NO_COMMIT_IMEDIATO',
    });
    expect(stageMock).not.toHaveBeenCalled();
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });

  it('trata disputa pela mesma chave idempotente sem provisionar duas vezes', async () => {
    let concurrentFingerprint = '';
    prismaMock.enrollmentCreationOperation.findFirst
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async () => ({ requestFingerprint: concurrentFingerprint }));
    prismaMock.enrollmentCreationOperation.create.mockImplementationOnce(async (args) => {
      concurrentFingerprint = args.data.requestFingerprint;
      throw { code: 'P2002' };
    });

    await expect(createImmediateEnrollment(input())).rejects.toMatchObject({
      code: 'CRIACAO_EM_PROCESSAMENTO',
    });
    expect(stageMock).not.toHaveBeenCalled();
    expect(criarMatriculaMock).not.toHaveBeenCalled();
  });
});
