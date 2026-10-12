/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getServerSessionMock,
  getSubscriptionMock,
  updateSubscriptionMock,
  projectConfirmedBillingAgreementSnapshotMock,
  atualizarStatusMatriculaMock,
  atualizarDetalhesMatriculaMock,
  buscarMatriculaPorIdMock,
  prismaMock,
  findCustomerForPayerMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  updateSubscriptionMock: vi.fn(),
  projectConfirmedBillingAgreementSnapshotMock: vi.fn(),
  atualizarStatusMatriculaMock: vi.fn(),
  atualizarDetalhesMatriculaMock: vi.fn(),
  buscarMatriculaPorIdMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    cobranca: {
      updateMany: vi.fn(),
    },
    charge: {
      updateMany: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    billingAllocation: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  findCustomerForPayerMock: vi.fn(async () => null),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  findCustomerForPayer: findCustomerForPayerMock,
  getSubscription: getSubscriptionMock,
  updateSubscription: updateSubscriptionMock,
  projectConfirmedBillingAgreementSnapshot: projectConfirmedBillingAgreementSnapshotMock,
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/enrollments/enrollment.service', () => ({
  atualizarStatusMatricula: atualizarStatusMatriculaMock,
  atualizarDetalhesMatricula: atualizarDetalhesMatriculaMock,
  buscarMatriculaPorId: buscarMatriculaPorIdMock,
}));

const { PATCH } = await import('../route');

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/matriculas/mat-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/matriculas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1', contaId: 'conta-1' } });
    prismaMock.cobranca.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.charge.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.billingAllocation.findFirst.mockResolvedValue(null);
    prismaMock.billingAllocation.updateMany.mockResolvedValue({ count: 1 });
  });

  it('enfileira a mudança do dia de vencimento e aguarda confirmação financeira', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_123',
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      vencimentoDia: 5,
      aluno: { id: 'aluno-1', nome: 'Aluno', asaasCustomerId: null },
      responsavelFinanceiro: null,
    });
    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      nextDueDate: '2026-03-05',
      billingType: 'BOLETO',
      value: 200,
    });
    atualizarDetalhesMatriculaMock.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      status: 'ATIVA',
      vencimentoDia: 10,
      dataInicio: new Date('2026-03-01T00:00:00.000Z'),
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'PENDENTE',
      taxaIsenta: false,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-11T00:00:00.000Z'),
    });

    const response = await PATCH(buildRequest({ vencimentoDia: 10 }), { params: Promise.resolve({ id: 'mat-1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getSubscriptionMock).toHaveBeenCalledWith('sub_123', { contaId: 'conta-1' });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(atualizarDetalhesMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mat-1',
        contaId: 'conta-1',
        actorId: 'user-1',
        vencimentoDia: 10,
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_123',
          remotePatch: { nextDueDate: '2026-03-10', updatePendingPayments: true },
          snapshot: expect.objectContaining({ dueDay: 10, nextDueDate: '2026-03-10' }),
        }),
      }),
    );
    expect(prismaMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.charge.updateMany).not.toHaveBeenCalled();
    expect(data.asyncSync).toMatchObject({ status: 'PENDING', fields: ['nextDueDate', 'updatePendingPayments'] });
  });

  it('enfileira a data de fim no Asaas sem recalcular próximo vencimento', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_123',
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      vencimentoDia: 5,
      aluno: { id: 'aluno-1', nome: 'Aluno', asaasCustomerId: null },
      responsavelFinanceiro: null,
    });
    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      nextDueDate: '2026-03-05',
      billingType: 'BOLETO',
      value: 200,
    });
    atualizarDetalhesMatriculaMock.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      status: 'ATIVA',
      vencimentoDia: 5,
      dataInicio: new Date('2026-03-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-01-31T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'PENDENTE',
      taxaIsenta: false,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-11T00:00:00.000Z'),
    });

    const response = await PATCH(
      buildRequest({ dataFimContrato: '2027-01-31T00:00:00.000Z' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(atualizarDetalhesMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mat-1',
        contaId: 'conta-1',
        actorId: 'user-1',
        dataFimContrato: '2027-01-31T00:00:00.000Z',
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_123',
          remotePatch: { endDate: '2027-01-31' },
        }),
      }),
    );
    expect(prismaMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.charge.updateMany).not.toHaveBeenCalled();
    expect(data.asyncSync).toMatchObject({ status: 'PENDING', fields: ['endDate'] });
  });

  it('bloqueia payload Asaas quando o novo vencimento ficaria após a data de fim', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_123',
      dataFimContrato: new Date('2026-07-31T00:00:00.000Z'),
      vencimentoDia: 5,
      aluno: { id: 'aluno-1', nome: 'Aluno', asaasCustomerId: null },
      responsavelFinanceiro: null,
    });
    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      nextDueDate: '2026-07-05',
      billingType: 'BOLETO',
      value: 200,
    });

    const response = await PATCH(
      buildRequest({ dataFimContrato: '2026-07-10T00:00:00.000Z', vencimentoDia: 20 }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('ASSINATURA_PERIODO_INVALIDO');
    expect(data.error.details).toEqual({
      nextDueDate: '2026-07-20',
      endDate: '2026-07-10',
      billingDay: 20,
    });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(atualizarDetalhesMatriculaMock).not.toHaveBeenCalled();
  });

  it('bloqueia payload que mistura troca de status com edição de detalhes', async () => {
    const response = await PATCH(
      buildRequest({ status: 'ATIVA', vencimentoDia: 15 }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('PAYLOAD_INVALIDO');
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(atualizarStatusMatriculaMock).not.toHaveBeenCalled();
  });

  it('mantém a assinatura compartilhada até a maior data de fim das matrículas', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: null,
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      vencimentoDia: 5,
      subscriptions: [],
      aluno: { id: 'aluno-1', nome: 'Aluno', asaasCustomerId: null },
      responsavelFinanceiro: null,
    });
    prismaMock.matricula.findMany.mockResolvedValue([
      { id: 'mat-1', dataFimContrato: new Date('2026-12-31T00:00:00.000Z') },
      { id: 'mat-2', dataFimContrato: new Date('2026-12-31T00:00:00.000Z') },
    ]);
    prismaMock.billingAllocation.findFirst.mockResolvedValue({
      agreement: {
        id: 'agreement-1',
        asaasSubscriptionId: 'sub_shared',
        status: 'ACTIVE',
        remoteStatus: 'ACTIVE',
        confirmedValue: 300,
        nextDueDate: new Date('2026-09-05T00:00:00.000Z'),
        dueDay: 5,
        validUntil: new Date('2026-12-31T00:00:00.000Z'),
        allocations: [{ matriculaId: 'mat-1' }, { matriculaId: 'mat-2' }],
      },
    });
    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_shared',
      status: 'ACTIVE',
      deleted: false,
      nextDueDate: '2026-09-05',
      endDate: '2026-12-31',
    });
    atualizarDetalhesMatriculaMock.mockResolvedValue({
      id: 'mat-1',
      alunoId: 'aluno-1',
      status: 'ATIVA',
      vencimentoDia: 5,
      dataInicio: new Date('2026-03-01T00:00:00.000Z'),
      dataFimContrato: new Date('2026-11-30T00:00:00.000Z'),
      taxaMatricula: 0,
      taxaStatus: 'PENDENTE',
      taxaIsenta: false,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    });

    const response = await PATCH(
      buildRequest({ dataFimContrato: '2026-11-30T00:00:00.000Z' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(projectConfirmedBillingAgreementSnapshotMock).not.toHaveBeenCalled();
    expect(atualizarDetalhesMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_shared',
          affectedMatriculaIds: ['mat-1', 'mat-2'],
          remotePatch: {},
          snapshot: expect.objectContaining({ validUntil: '2027-01-01' }),
          allocationValidity: { matriculaIds: ['mat-1'], validUntil: '2026-12-01' },
        }),
      }),
    );
    expect(atualizarDetalhesMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mat-1',
        dataFimContrato: '2026-11-30T00:00:00.000Z',
      }),
    );
    expect(prismaMock.billingAllocation.updateMany).not.toHaveBeenCalled();
  });
});
