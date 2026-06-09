/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getServerSessionMock,
  getSubscriptionMock,
  updateSubscriptionMock,
  editarMatriculaMock,
  prismaMock,
  resolveMatriculaFinancialContextMock,
  updateFamilyFinancialLocalStateMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  updateSubscriptionMock: vi.fn(),
  editarMatriculaMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    cobranca: {
      updateMany: vi.fn(),
    },
    charge: {
      updateMany: vi.fn(),
    },
    plano: {
      findFirst: vi.fn(),
    },
    combo: {
      findFirst: vi.fn(),
    },
  },
  resolveMatriculaFinancialContextMock: vi.fn(),
  updateFamilyFinancialLocalStateMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getSubscription: getSubscriptionMock,
  updateSubscription: updateSubscriptionMock,
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/matriculas/matricula.service', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/matriculas/matricula.service')>(
    '@/src/server/matriculas/matricula.service',
  );

  return {
    ...actual,
    editarMatricula: editarMatriculaMock,
  };
});

vi.mock('@/src/server/matriculas/financial-context.service', () => ({
  isFinancialContextEditable: vi.fn(() => true),
  resolveMatriculaFinancialContext: resolveMatriculaFinancialContextMock,
  updateFamilyFinancialLocalState: updateFamilyFinancialLocalStateMock,
}));

const { PATCH } = await import('../route');

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/matriculas/mat-1/editar', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/matriculas/[id]/editar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1', contaId: 'conta-1' } });
    prismaMock.cobranca.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.charge.updateMany.mockResolvedValue({ count: 2 });
    resolveMatriculaFinancialContextMock.mockResolvedValue({
      mode: 'INDIVIDUAL',
      sourceMatriculaId: 'mat-1',
      targetMatriculaId: 'mat-1',
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub_123',
      localSnapshot: { status: 'ACTIVE', deleted: false, value: 199.9 },
      family: null,
    });
    updateFamilyFinancialLocalStateMock.mockResolvedValue({
      matriculasUpdated: 2,
      subscriptionsUpdated: 1,
      chargesUpdated: 2,
      readModelsUpdated: 2,
    });
    editarMatriculaMock.mockResolvedValue({ id: 'mat-1' });
  });

  it('atualiza valor recorrente da assinatura quando o plano muda', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      planoId: 'plano-antigo',
      comboId: null,
      asaasSubscriptionId: 'sub_123',
    });
    prismaMock.plano.findFirst.mockResolvedValue({
      id: 'plano-novo',
      nome: 'Plano Novo',
      valor: 299.9,
      periodicidade: 'MENSAL',
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      value: 199.9,
      cycle: 'MONTHLY',
      nextDueDate: '2026-04-05',
    });

    const response = await PATCH(
      buildRequest({ contaId: 'conta-1', planoId: 'plano-novo', turmaId: 'turma-2' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getSubscriptionMock).toHaveBeenCalledWith('sub_123', { contaId: 'conta-1' });
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_123',
      {
        updatePendingPayments: true,
        value: 299.9,
      },
      { contaId: 'conta-1' },
    );
    expect(editarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'mat-1',
        contaId: 'conta-1',
        createdById: 'user-1',
        planoId: 'plano-novo',
        turmaId: 'turma-2',
        metadata: expect.objectContaining({
          subscriptionSync: expect.objectContaining({
            kind: 'PRODUCT_RECURRING_TERMS_UPDATED',
            productKind: 'PLAN',
            nextValue: 299.9,
            nextCycle: 'MONTHLY',
            updatePendingPayments: true,
          }),
        }),
      }),
    );
    expect(prismaMock.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        matriculaId: 'mat-1',
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: {
        valor: 299.9,
        valorFinal: 299.9,
      },
    });
    expect(prismaMock.charge.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        cobranca: {
          matriculaId: 'mat-1',
          status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
        },
      },
      data: {
        value: 299.9,
      },
    });
    expect(data.asyncSync.localAlignment).toEqual({ cobrancasUpdated: 2, chargesUpdated: 2 });
    expect(data.asyncSync.message).toMatch(/plano ou combo/i);
  });

  it('atualiza valor e ciclo recorrente quando o combo muda', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      planoId: null,
      comboId: 'combo-antigo',
      asaasSubscriptionId: 'sub_123',
    });
    prismaMock.combo.findFirst.mockResolvedValue({
      id: 'combo-novo',
      nome: 'Combo Trimestral',
      valor: 750,
      periodicidade: 'TRIMESTRAL',
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      value: 600,
      cycle: 'MONTHLY',
    });

    const response = await PATCH(
      buildRequest({ contaId: 'conta-1', comboId: 'combo-novo' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_123',
      {
        updatePendingPayments: true,
        value: 750,
        cycle: 'QUARTERLY',
      },
      { contaId: 'conta-1' },
    );
    expect(editarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        comboId: 'combo-novo',
        metadata: expect.objectContaining({
          subscriptionSync: expect.objectContaining({
            productKind: 'COMBO',
            nextValue: 750,
            nextCycle: 'QUARTERLY',
          }),
        }),
      }),
    );
    expect(data.asyncSync.cycle).toBe('QUARTERLY');
  });

  it('atualiza assinatura familiar consolidada com a soma dos itens da família', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      planoId: 'plano-antigo',
      comboId: null,
      asaasSubscriptionId: null,
    });
    resolveMatriculaFinancialContextMock.mockResolvedValue({
      mode: 'FAMILY',
      sourceMatriculaId: 'mat-1',
      targetMatriculaId: 'mat-1',
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub_family',
      localSnapshot: { status: 'ACTIVE', deleted: false, value: 300 },
      localSubscriptionId: 'standalone-1',
      family: {
        id: 'fam-1',
        affectedMatriculaIds: ['mat-1', 'mat-2'],
      },
    });
    prismaMock.plano.findFirst.mockResolvedValue({
      id: 'plano-novo',
      nome: 'Plano Novo',
      valor: 250,
      periodicidade: 'MENSAL',
    });
    prismaMock.matricula.findMany.mockResolvedValue([
      { id: 'mat-1', plano: { id: 'plano-antigo', nome: 'Plano Antigo', valor: 100, periodicidade: 'MENSAL' }, combo: null },
      { id: 'mat-2', plano: { id: 'plano-2', nome: 'Plano Dois', valor: 150, periodicidade: 'MENSAL' }, combo: null },
    ]);
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_family',
      status: 'ACTIVE',
      deleted: false,
      value: 300,
      cycle: 'MONTHLY',
    });

    const response = await PATCH(
      buildRequest({ contaId: 'conta-1', planoId: 'plano-novo' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_family',
      {
        updatePendingPayments: true,
        value: 400,
      },
      { contaId: 'conta-1' },
    );
    expect(updateFamilyFinancialLocalStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 400,
        cycle: 'MONTHLY',
      }),
    );
    expect(prismaMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(data.asyncSync.localAlignment).toEqual({
      matriculasUpdated: 2,
      subscriptionsUpdated: 1,
      chargesUpdated: 2,
      readModelsUpdated: 2,
    });
  });

  it('bloqueia assinatura familiar com periodicidades divergentes', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      planoId: 'plano-antigo',
      comboId: null,
      asaasSubscriptionId: null,
    });
    resolveMatriculaFinancialContextMock.mockResolvedValue({
      mode: 'FAMILY',
      sourceMatriculaId: 'mat-1',
      targetMatriculaId: 'mat-1',
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub_family',
      localSnapshot: { status: 'ACTIVE', deleted: false, value: 300 },
      family: {
        id: 'fam-1',
        affectedMatriculaIds: ['mat-1', 'mat-2'],
      },
    });
    prismaMock.plano.findFirst.mockResolvedValue({
      id: 'plano-novo',
      nome: 'Plano Novo',
      valor: 250,
      periodicidade: 'TRIMESTRAL',
    });
    prismaMock.matricula.findMany.mockResolvedValue([
      { id: 'mat-1', plano: { id: 'plano-antigo', nome: 'Plano Antigo', valor: 100, periodicidade: 'MENSAL' }, combo: null },
      { id: 'mat-2', plano: { id: 'plano-2', nome: 'Plano Dois', valor: 150, periodicidade: 'MENSAL' }, combo: null },
    ]);
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_family',
      status: 'ACTIVE',
      deleted: false,
      value: 300,
      cycle: 'MONTHLY',
    });

    const response = await PATCH(
      buildRequest({ contaId: 'conta-1', planoId: 'plano-novo' }),
      { params: Promise.resolve({ id: 'mat-1' }) },
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('PERIODICIDADE_FAMILIAR_DIVERGENTE');
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(editarMatriculaMock).not.toHaveBeenCalled();
  });
});
