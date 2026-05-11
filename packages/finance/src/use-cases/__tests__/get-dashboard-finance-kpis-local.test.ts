import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDashboardFinanceKpisLocal } from '../get-dashboard-finance-kpis-local';

const prismaMock = vi.hoisted(() => ({
  chargeReadModel: {
    aggregate: vi.fn(),
  },
  cobranca: {
    findMany: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

describe('getDashboardFinanceKpisLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FIN_READMODEL_ENABLED;
  });

  it('usa ChargeReadModel unificado quando a projeção está habilitada', async () => {
    process.env.FIN_READMODEL_ENABLED = 'true';
    prismaMock.chargeReadModel.aggregate.mockResolvedValue({
      _sum: { value: 325.5 },
      _count: { _all: 3 },
      _max: { projectedAt: new Date('2026-05-10T10:00:00.000Z') },
    });

    const result = await getDashboardFinanceKpisLocal({
      contaId: 'conta-1',
      now: new Date('2026-05-10T12:00:00.000Z'),
    });

    const expectedWindow = {
      gte: new Date(2026, 4, 1),
      lte: new Date(2026, 4 + 1, 0, 23, 59, 59, 999),
    };

    expect(prismaMock.chargeReadModel.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          status: { in: ['PENDING', 'OVERDUE'] },
          OR: [
            { origin: 'ACADEMIC', sourceKind: 'COBRANCA' },
            { origin: 'STANDALONE', sourceKind: 'CHARGE' },
          ],
          dueDate: expectedWindow,
        }),
      }),
    );
    expect(result.aguardandoPagamentoProximos30Dias).toMatchObject({
      valorBruto: 325.5,
      quantidadeDeCobrancas: 3,
      origemDados: 'charge_read_model',
      escopo: 'unified',
      projectedAt: '2026-05-10T10:00:00.000Z',
    });
    expect(prismaMock.cobranca.findMany).not.toHaveBeenCalled();
  });

  it('faz fallback para Cobranca quando a projeção está desligada', async () => {
    prismaMock.cobranca.findMany.mockResolvedValue([
      { valor: 100, valorFinal: null },
      { valor: 80, valorFinal: 75 },
    ]);

    const result = await getDashboardFinanceKpisLocal({
      contaId: 'conta-1',
      now: new Date('2026-05-10T12:00:00.000Z'),
    });

    const expectedWindow = {
      gte: new Date(2026, 4, 1),
      lte: new Date(2026, 4 + 1, 0, 23, 59, 59, 999),
    };

    expect(prismaMock.cobranca.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
          vencimento: expectedWindow,
        }),
      }),
    );
    expect(result.aguardandoPagamentoProximos30Dias).toMatchObject({
      valorBruto: 175,
      quantidadeDeCobrancas: 2,
      origemDados: 'cobranca',
      escopo: 'academic_only',
      projectedAt: null,
    });
    expect(prismaMock.chargeReadModel.aggregate).not.toHaveBeenCalled();
  });
});