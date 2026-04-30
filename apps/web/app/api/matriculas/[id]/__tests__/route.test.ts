import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSession } from 'next-auth';

import { DELETE } from '../route';

const { prismaMock, syncMatriculaStatusMock } = vi.hoisted(() => ({
  syncMatriculaStatusMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    cobranca: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    pagamento: {
      count: vi.fn(),
    },
    subscription: {
      count: vi.fn(),
    },
    installmentPlan: {
      count: vi.fn(),
    },
    contrato: {
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/matriculas/matricula-sync.service', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/matriculas/matricula-sync.service')>(
    '@/src/server/matriculas/matricula-sync.service',
  );

  return {
    ...actual,
    syncMatriculaStatus: syncMatriculaStatusMock,
  };
});

function buildRequest(url: string, body?: Record<string, unknown>) {
  return new Request(url, {
    method: 'DELETE',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('DELETE /api/matriculas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock as never),
    );
  });

  it('cancela a matrícula quando hard delete não foi solicitado', async () => {
    syncMatriculaStatusMock.mockResolvedValue({
      matriculaId: 'matricula-1',
      previousStatus: 'ATIVA',
      newStatus: 'CANCELADA',
      asaasAction: 'DELETE',
      cobrancasAtualizadas: 2,
      paymentSync: {
        totalFromAsaas: 1,
        matched: 1,
        updated: 2,
        warnings: [],
        details: [],
        expectedWebhooks: ['SUBSCRIPTION_DELETED', 'PAYMENT_DELETED'],
      },
      nextDueDate: null,
    });

    const response = await DELETE(
      buildRequest('http://localhost:3000/api/matriculas/matricula-1?contaId=conta-1', {
        motivo: 'Encerramento solicitado',
      }),
      { params: { id: 'matricula-1' } },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.action).toBe('CANCELADA');
    expect(syncMatriculaStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matriculaId: 'matricula-1',
        contaId: 'conta-1',
        targetStatus: 'CANCELADA',
        motivo: 'Encerramento solicitado',
      }),
    );
  });

  it('bloqueia exclusão permanente quando existe histórico financeiro ou contratual', async () => {
    prismaMock.matricula.findFirst.mockResolvedValue({
      id: 'matricula-1',
      asaasSubscriptionId: 'sub_123',
    });
    prismaMock.cobranca.count.mockResolvedValue(3);
    prismaMock.pagamento.count.mockResolvedValue(1);
    prismaMock.subscription.count.mockResolvedValue(1);
    prismaMock.installmentPlan.count.mockResolvedValue(0);
    prismaMock.contrato.count.mockResolvedValue(1);
    prismaMock.cobranca.groupBy.mockResolvedValue([
      { status: 'PENDENTE', _count: { status: 1 } },
      { status: 'PAGO', _count: { status: 2 } },
    ]);

    const response = await DELETE(
      buildRequest('http://localhost:3000/api/matriculas/matricula-1?contaId=conta-1&hard=true', {
        motivo: 'Tentativa de limpeza',
      }),
      { params: { id: 'matricula-1' } },
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error.code).toBe('MATRICULA_HARD_DELETE_BLOCKED');
    expect(data.error.details.blockedBy).toEqual(
      expect.objectContaining({
        cobrancas: 3,
        pagamentos: 1,
        subscriptions: 1,
        contratoComAceite: 1,
        asaasSubscriptionId: 'sub_123',
        cobrancasPorStatus: {
          PENDENTE: 1,
          PAGO: 2,
        },
      }),
    );
    expect(syncMatriculaStatusMock).not.toHaveBeenCalled();
  });
});
