import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: { findMany: findManyMock },
  },
}));

import { getErpRevenue } from './get-erp-revenue';

describe('getErpRevenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
  });

  it('consulta cobranças pelo tenant direto da entidade', async () => {
    const result = await getErpRevenue({ contaId: 'conta-a', periodo: '2026-09' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        total: { valorBruto: 0, valorLiquido: 0, quantidadeCobrancas: 0 },
      }),
    });
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-a',
        status: 'PAGO',
        competenciaInicio: {
          gte: new Date(2026, 8, 1),
          lte: new Date(2026, 8, 30, 23, 59, 59, 999),
        },
      },
      select: expect.any(Object),
    });
  });
});
