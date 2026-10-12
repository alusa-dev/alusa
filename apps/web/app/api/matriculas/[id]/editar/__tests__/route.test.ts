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
  projectConfirmedBillingAllocationValuesMock,
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
  projectConfirmedBillingAllocationValuesMock: vi.fn(),
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
  projectConfirmedBillingAllocationValues: projectConfirmedBillingAllocationValuesMock,
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/enrollments/enrollment.service', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/enrollments/enrollment.service')>(
    '@/src/server/enrollments/enrollment.service',
  );

  return {
    ...actual,
    editarMatricula: editarMatriculaMock,
  };
});

vi.mock('@/src/server/enrollments/financial-context.service', () => ({
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
    projectConfirmedBillingAllocationValuesMock.mockResolvedValue({ id: 'agreement-1' });
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
    editarMatriculaMock.mockResolvedValue({ id: 'mat-1', financialCommandEventId: 'financial-command-1' });
  });

  it('enfileira a atualização recorrente da assinatura quando o plano muda', async () => {
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
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(projectConfirmedBillingAllocationValuesMock).not.toHaveBeenCalled();
    expect(editarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'mat-1',
        contaId: 'conta-1',
        createdById: 'user-1',
        planoId: 'plano-novo',
        turmaId: 'turma-2',
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_123',
          affectedMatriculaIds: ['mat-1'],
          remotePatch: { updatePendingPayments: true, value: 299.9 },
          allocationValues: [{ matriculaId: 'mat-1', value: 299.9 }],
        }),
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
    expect(prismaMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.charge.updateMany).not.toHaveBeenCalled();
    expect(data.asyncSync).toMatchObject({ status: 'PENDING', operationId: 'financial-command-1' });
  });

  it('enfileira valor e ciclo recorrentes quando o combo muda', async () => {
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
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(editarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        comboId: 'combo-novo',
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_123',
          remotePatch: { updatePendingPayments: true, value: 750, cycle: 'QUARTERLY' },
          allocationValues: [{ matriculaId: 'mat-1', value: 750 }],
        }),
        metadata: expect.objectContaining({
          subscriptionSync: expect.objectContaining({
            productKind: 'COMBO',
            nextValue: 750,
            nextCycle: 'QUARTERLY',
          }),
        }),
      }),
    );
    expect(data.asyncSync).toMatchObject({ status: 'PENDING', cycle: 'QUARTERLY' });
  });

  it('preserva o preço agregado do plano familiar ao editar um dos vínculos', async () => {
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
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(projectConfirmedBillingAllocationValuesMock).not.toHaveBeenCalled();
    expect(updateFamilyFinancialLocalStateMock).not.toHaveBeenCalled();
    expect(editarMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        financialCommand: expect.objectContaining({
          targetSubscriptionId: 'sub_family',
          affectedMatriculaIds: ['mat-1', 'mat-2'],
          remotePatch: { updatePendingPayments: true, value: 400 },
          allocationValues: [
            { matriculaId: 'mat-1', value: 250 },
            { matriculaId: 'mat-2', value: 150 },
          ],
        }),
      }),
    );
    expect(prismaMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(data.asyncSync).toMatchObject({ status: 'PENDING', operationId: 'financial-command-1' });
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
