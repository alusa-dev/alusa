/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getServerSessionMock,
  getSubscriptionMock,
  updateSubscriptionMock,
  atualizarStatusMatriculaMock,
  atualizarDetalhesMatriculaMock,
  buscarMatriculaPorIdMock,
  prismaMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  updateSubscriptionMock: vi.fn(),
  atualizarStatusMatriculaMock: vi.fn(),
  atualizarDetalhesMatriculaMock: vi.fn(),
  buscarMatriculaPorIdMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
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

vi.mock('@/src/server/matriculas/matricula.service', () => ({
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
  });

  it('sincroniza o novo dia de vencimento com o vínculo financeiro antes de salvar localmente', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_123',
      vencimentoDia: 5,
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
    expect(updateSubscriptionMock).toHaveBeenCalledWith(
      'sub_123',
      {
        nextDueDate: '2026-03-10',
        updatePendingPayments: true,
      },
      { contaId: 'conta-1' },
    );
    expect(atualizarDetalhesMatriculaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mat-1',
        contaId: 'conta-1',
        actorId: 'user-1',
        vencimentoDia: 10,
      }),
    );
    expect(prismaMock.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        matriculaId: 'mat-1',
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: {
        vencimento: new Date('2026-03-10T12:00:00.000Z'),
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
        dueDate: new Date('2026-03-10T12:00:00.000Z'),
      },
    });
    expect(data.asyncSync.localAlignment).toEqual({ cobrancasUpdated: 1, chargesUpdated: 1 });
    expect(data.asyncSync.message).toMatch(/alinhado com o vínculo financeiro/i);
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
});
