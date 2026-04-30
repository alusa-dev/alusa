/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSessionMock, buscarMatriculaPorIdMock, getSubscriptionMock, prismaMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  buscarMatriculaPorIdMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  prismaMock: {
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

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/src/server/matriculas/matricula.service', () => ({
  buscarMatriculaPorId: buscarMatriculaPorIdMock,
  atualizarDetalhesMatricula: vi.fn(),
  atualizarStatusMatricula: vi.fn(),
}));

vi.mock('@/src/server/matriculas/matricula-sync.service', async () => {
  const actual = await vi.importActual<typeof import('@/src/server/matriculas/matricula-sync.service')>(
    '@/src/server/matriculas/matricula-sync.service',
  );
  return {
    ...actual,
    syncMatriculaStatus: vi.fn(),
  };
});

vi.mock('@/features/cadastro/matriculas/mappers', () => ({
  mapMatriculaDeleteResultToDTO: vi.fn(),
  mapMatriculaRecordToCoreDTO: vi.fn(),
  mapMatriculaRecordToResumoDTO: (value: unknown) => value,
}));

vi.mock('@alusa/finance', () => ({
  getSubscription: getSubscriptionMock,
  recordAsaasReadIntent: vi.fn(),
  updateSubscription: vi.fn(),
}));

import { GET } from '@/app/api/matriculas/[id]/route';

describe('GET /api/matriculas/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1' },
    });
  });

  it('usa snapshot local da assinatura por padrão e evita GET remoto quando os dados locais são suficientes', async () => {
    buscarMatriculaPorIdMock.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_1',
      formaPagamentoTaxa: 'BOLETO',
      updatedAt: new Date('2026-03-10T12:00:00.000Z'),
      plano: { valor: 120 },
      combo: null,
      cobrancas: [
        {
          tipo: 'MENSALIDADE',
          status: 'PENDENTE',
          valor: 120,
          vencimento: new Date('2026-04-05T12:00:00.000Z'),
          formaPagamento: 'PIX',
          updatedAt: new Date('2026-03-12T12:00:00.000Z'),
        },
      ],
    });

    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-03-12T12:00:00.000Z'),
    });

    const response = await GET(new Request('http://localhost/api/matriculas/mat-1'), {
      params: { id: 'mat-1' },
    });

    expect(response.status).toBe(200);
    expect(getSubscriptionMock).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json).toMatchObject({
      matricula: {
        assinaturaSnapshot: {
          asaasSubscriptionId: 'sub_1',
          status: 'ACTIVE',
          billingType: 'PIX',
          value: 120,
          nextDueDate: expect.stringContaining('2026-04-05'),
          deleted: false,
          syncError: null,
        },
      },
    });
  });

  it('aceita fresh=1 e força leitura remota da assinatura', async () => {
    buscarMatriculaPorIdMock.mockResolvedValue({
      id: 'mat-1',
      asaasSubscriptionId: 'sub_1',
      formaPagamentoTaxa: 'BOLETO',
      updatedAt: new Date('2026-03-10T12:00:00.000Z'),
      plano: { valor: 120 },
      combo: null,
      cobrancas: [],
    });

    prismaMock.subscription.findFirst.mockResolvedValue({
      status: 'ACTIVE',
      updatedAt: new Date('2026-03-12T12:00:00.000Z'),
    });

    getSubscriptionMock.mockResolvedValue({
      id: 'sub_1',
      status: 'INACTIVE',
      billingType: 'CREDIT_CARD',
      value: 135,
      nextDueDate: '2026-04-10',
      deleted: false,
    });

    const response = await GET(new Request('http://localhost/api/matriculas/mat-1?fresh=1'), {
      params: { id: 'mat-1' },
    });

    expect(response.status).toBe(200);
    expect(getSubscriptionMock).toHaveBeenCalledWith('sub_1', { contaId: 'conta-1' });

    const json = await response.json();
    expect(json).toMatchObject({
      matricula: {
        assinaturaSnapshot: {
          asaasSubscriptionId: 'sub_1',
          status: 'INACTIVE',
          billingType: 'CREDIT_CARD',
          value: 135,
          nextDueDate: '2026-04-10',
          deleted: false,
          syncError: null,
        },
      },
    });
  });
});
