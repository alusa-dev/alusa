import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../financial-read-convergence', () => ({
  convergeSubscriptionsWithAsaas: vi.fn().mockResolvedValue(false),
}));

vi.mock('@alusa/database', () => {
  const prisma = {
    subscription: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    responsavel: {
      findMany: vi.fn(),
    },
    aluno: {
      findMany: vi.fn(),
    },
    charge: {
      findMany: vi.fn(),
    },
    standaloneSubscription: {
      findMany: vi.fn(),
    },
    auditLog: {
      findMany: vi.fn(),
    },
  };

  return { prisma };
});

import { prisma } from '@alusa/database';
import { convergeSubscriptionsWithAsaas } from '../financial-read-convergence';
import { listSubscriptions, listSubscriptionsForFinance } from '../list-subscriptions';

describe('listSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve listar e normalizar campos (sem filtro)', async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([
      {
        id: 's1',
        contratoId: 'ct1',
        matriculaId: 'm1',
        externalReference: 'subscription:s1',
        asaasSubscriptionId: null,
        status: 'REQUESTED',
        statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ] as never);

    const res = await listSubscriptions({ contaId: 'c1', limit: 10, offset: 0 });

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 's1',
      contratoId: 'ct1',
      matriculaId: 'm1',
      externalReference: 'subscription:s1',
      asaasSubscriptionId: null,
      status: 'REQUESTED',
      statusUpdatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    expect(prisma.subscription.count).toHaveBeenCalledWith({ where: { contaId: 'c1' } });
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contaId: 'c1' }, take: 10, skip: 0 }),
    );
  });

  it('deve aplicar filtro por status quando informado', async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValueOnce(2 as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([] as never);

    await listSubscriptions({ contaId: 'c1', limit: 10, offset: 0, status: 'ACTIVE' });

    expect(prisma.subscription.count).toHaveBeenCalledWith({ where: { contaId: 'c1', status: 'ACTIVE' } });
    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contaId: 'c1', status: 'ACTIVE' }, take: 10, skip: 0 }),
    );
  });

  it('reconsulta a lista quando a convergência oficial altera o estado local', async () => {
    vi.mocked(prisma.subscription.count).mockResolvedValueOnce(1 as never);
    vi.mocked(prisma.subscription.findMany)
      .mockResolvedValueOnce([
        {
          id: 's1',
          contratoId: 'ct1',
          matriculaId: 'm1',
          externalReference: 'subscription:s1',
          asaasSubscriptionId: 'asaas_sub_1',
          status: 'REQUESTED',
          statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 's1',
          contratoId: 'ct1',
          matriculaId: 'm1',
          externalReference: 'subscription:s1',
          asaasSubscriptionId: 'asaas_sub_1',
          status: 'ACTIVE',
          statusUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ] as never);
    vi.mocked(convergeSubscriptionsWithAsaas).mockResolvedValueOnce(true);

    const res = await listSubscriptions({ contaId: 'c1', limit: 10, offset: 0 });

    expect(convergeSubscriptionsWithAsaas).toHaveBeenCalledWith({
      contaId: 'c1',
      subscriptions: [
        {
          id: 's1',
          source: 'ACADEMIC',
          asaasSubscriptionId: 'asaas_sub_1',
          externalReference: 'subscription:s1',
        },
      ],
    });
    expect(prisma.subscription.findMany).toHaveBeenCalledTimes(2);
    expect(res.items[0].status).toBe('ACTIVE');
  });
});

describe('listSubscriptionsForFinance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('faz fallback para auditLog quando standaloneSubscription nao existe no runtime', async () => {
    vi.mocked(prisma.standaloneSubscription.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.responsavel.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.aluno.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        entityId: 'sub_manual_1',
        createdAt: new Date('2026-03-09T00:00:00.000Z'),
        metadata: {
          externalReference: 'alusa:standalone-subscription:sub_manual_1',
          asaasSubscriptionId: 'sub_asaas_1',
          status: 'ACTIVE',
          payerName: 'Cliente Manual',
          payerId: 'payer_1',
          cycle: 'MONTHLY',
          billingType: 'PIX',
          value: 49.9,
          description: 'Assinatura manual',
          nextDueDate: '2026-03-10',
        },
      },
    ] as never);

    const result = await listSubscriptionsForFinance({
      contaId: 'conta_1',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'sub_manual_1',
      asaasSubscriptionId: 'sub_asaas_1',
      externalReference: 'alusa:standalone-subscription:sub_manual_1',
      clienteNome: 'Cliente Manual',
      billingType: 'PIX',
      tipo: 'AVULSA',
    });
  });

  it('usa o valor oficial da próxima cobrança gerada para assinaturas acadêmicas', async () => {
    vi.mocked(prisma.standaloneSubscription.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.responsavel.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.aluno.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([
      {
        id: 'sub_academica_1',
        asaasSubscriptionId: 'asaas_sub_1',
        externalReference: 'alusa:subscription:matricula_1:plano_1',
        status: 'ACTIVE',
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
        matricula: {
          id: 'matricula_1',
          vencimentoDia: 5,
          formaPagamento: 'CARTAO_CREDITO',
          formaPagamentoTaxa: 'BOLETO',
          aluno: {
            id: 'aluno_1',
            nome: 'Bryan de Alencar Bezerra',
            dataNasc: new Date('2000-01-01T00:00:00.000Z'),
          },
          responsavelFinanceiro: null,
          plano: {
            nome: 'Plano Mensal',
            valor: 150,
            periodicidade: 'MENSAL',
            descricao: 'Plano Mensal',
          },
          combo: null,
        },
      },
    ] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([
      {
        externalReference: 'alusa:subscription:matricula_1:plano_1:payment:pay_1',
        dueDate: new Date('2099-05-05T00:00:00.000Z'),
        value: 75,
      },
    ] as never);

    const result = await listSubscriptionsForFinance({
      contaId: 'conta_1',
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'sub_academica_1',
      valor: 75,
      nextDueDate: '2099-05-05T00:00:00.000Z',
    });
  });

  it('recarrega as fontes quando a convergência da assinatura materializa estado local', async () => {
    vi.mocked(prisma.standaloneSubscription.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.auditLog.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.responsavel.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.aluno.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(prisma.subscription.findMany)
      .mockResolvedValueOnce([
        {
          id: 'sub_academica_1',
          asaasSubscriptionId: 'asaas_sub_1',
          externalReference: 'alusa:subscription:matricula_1:plano_1',
          status: 'REQUESTED',
          createdAt: new Date('2026-03-01T12:00:00.000Z'),
          matricula: {
            id: 'matricula_1',
            vencimentoDia: 5,
            formaPagamento: 'CARTAO_CREDITO',
            formaPagamentoTaxa: 'BOLETO',
            aluno: {
              id: 'aluno_1',
              nome: 'Bryan de Alencar Bezerra',
              dataNasc: new Date('2000-01-01T00:00:00.000Z'),
            },
            responsavelFinanceiro: null,
            plano: {
              nome: 'Plano Mensal',
              valor: 150,
              periodicidade: 'MENSAL',
              descricao: 'Plano Mensal',
            },
            combo: null,
          },
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'sub_academica_1',
          asaasSubscriptionId: 'asaas_sub_1',
          externalReference: 'alusa:subscription:matricula_1:plano_1',
          status: 'ACTIVE',
          createdAt: new Date('2026-03-01T12:00:00.000Z'),
          matricula: {
            id: 'matricula_1',
            vencimentoDia: 5,
            formaPagamento: 'CARTAO_CREDITO',
            formaPagamentoTaxa: 'BOLETO',
            aluno: {
              id: 'aluno_1',
              nome: 'Bryan de Alencar Bezerra',
              dataNasc: new Date('2000-01-01T00:00:00.000Z'),
            },
            responsavelFinanceiro: null,
            plano: {
              nome: 'Plano Mensal',
              valor: 150,
              periodicidade: 'MENSAL',
              descricao: 'Plano Mensal',
            },
            combo: null,
          },
        },
      ] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(convergeSubscriptionsWithAsaas).mockResolvedValueOnce(true);

    const result = await listSubscriptionsForFinance({
      contaId: 'conta_1',
      page: 1,
      pageSize: 20,
    });

    expect(convergeSubscriptionsWithAsaas).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta_1',
        subscriptions: [
          {
            id: 'sub_academica_1',
            source: 'ACADEMIC',
            asaasSubscriptionId: 'asaas_sub_1',
            externalReference: 'alusa:subscription:matricula_1:plano_1',
          },
        ],
      }),
    );
    expect(prisma.subscription.findMany).toHaveBeenCalledTimes(2);
    expect(result.items[0].status).toBe('ACTIVE');
  });

});
