import { describe, it, expect, vi, beforeEach } from 'vitest';

import { listInstallmentPlans } from '../list-installment-plans';

vi.mock('@alusa/database', () => {
  return {
    prisma: {
      installmentPlan: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    },
  };
});

describe('listInstallmentPlans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve aplicar filtro por status e paginação', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.installmentPlan.count).mockResolvedValueOnce(12 as never);
    vi.mocked(prisma.installmentPlan.findMany).mockResolvedValueOnce([
      {
        id: 'ip1',
        contratoId: 'c1',
        matriculaId: 'm1',
        externalReference: 'installmentPlan:ip1',
        asaasInstallmentId: 'asaas_inst_1',
        status: 'ACTIVE',
        installmentCount: 3,
        billingType: 'BOLETO',
        value: 150,
        firstDueDate: new Date('2026-01-10T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ] as never);

    const res = await listInstallmentPlans({ contaId: 't1', limit: 5, offset: 5, status: 'ACTIVE' as never });

    expect(res.total).toBe(12);
    expect(res.items[0]).toMatchObject({
      id: 'ip1',
      installmentCount: 3,
      amount: '150',
      firstDueDate: '2026-01-10',
    });

    expect(prisma.installmentPlan.count).toHaveBeenCalledWith({ where: { contaId: 't1', status: 'ACTIVE' } });
    expect(prisma.installmentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contaId: 't1', status: 'ACTIVE' },
        take: 5,
        skip: 5,
      }),
    );
  });
});
