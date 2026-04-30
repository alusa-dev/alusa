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
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  updateSubscriptionMock: vi.fn(),
  editarMatriculaMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
    plano: {
      findFirst: vi.fn(),
    },
  },
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
  });

  it('atualiza o valor do vínculo financeiro quando o plano muda', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      planoId: 'plano-antigo',
      asaasSubscriptionId: 'sub_123',
    });
    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    prismaMock.plano.findFirst.mockResolvedValue({
      id: 'plano-novo',
      nome: 'Plano Novo',
      valor: 299.9,
    });
    getSubscriptionMock.mockResolvedValue({
      id: 'sub_123',
      status: 'ACTIVE',
      deleted: false,
      value: 199.9,
      nextDueDate: '2026-04-05',
    });
    editarMatriculaMock.mockResolvedValue({ id: 'mat-1', planoId: 'plano-novo', turmaId: 'turma-2' });

    const response = await PATCH(
      buildRequest({ contaId: 'conta-1', planoId: 'plano-novo', turmaId: 'turma-2' }),
      { params: { id: 'mat-1' } },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(getSubscriptionMock).toHaveBeenCalledWith('sub_123', { contaId: 'conta-1' });
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_123',
      {
        value: 299.9,
        updatePendingPayments: true,
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
      }),
    );
    expect(data.asyncSync.message).toMatch(/valor recorrente/i);
  });
});