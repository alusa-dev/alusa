import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getPayment: vi.fn(),
  updatePayment: vi.fn(),
  allocationFindFirst: vi.fn(),
  allocationFindMany: vi.fn(),
  allocationUpdateMany: vi.fn(),
  familyAllocationUpdateMany: vi.fn(),
  chargeUpdateMany: vi.fn(),
  cobrancaUpdateMany: vi.fn(),
  matriculaUpdateMany: vi.fn(),
  logCreate: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@alusa/finance', () => ({
  getPayment: mocks.getPayment,
  updatePayment: mocks.updatePayment,
}));
vi.mock('@/src/prisma', () => ({
  prisma: {
    billingAllocation: {
      findFirst: mocks.allocationFindFirst,
      findMany: mocks.allocationFindMany,
    },
    $transaction: vi.fn(async (run) =>
      run({
        billingAllocation: { updateMany: mocks.allocationUpdateMany },
        familyFinancialAllocation: { updateMany: mocks.familyAllocationUpdateMany },
        charge: { updateMany: mocks.chargeUpdateMany },
        cobranca: { updateMany: mocks.cobrancaUpdateMany },
        matricula: { updateMany: mocks.matriculaUpdateMany },
        matriculaLog: { create: mocks.logCreate },
      }),
    ),
  },
}));

import { PUT } from './route';

const allocation = {
  id: 'allocation-1',
  contaId: 'conta-1',
  agreementId: 'agreement-1',
  matriculaId: 'matricula-1',
  netAmount: 100,
  sourceCharge: {
    id: 'charge-1',
    cobrancaId: 'cobranca-1',
    asaasPaymentId: 'payment-1',
    cobranca: { asaasPaymentId: 'payment-1' },
  },
  agreement: { id: 'agreement-1' },
};

describe('PUT /api/matriculas/[id]/taxa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' });
    mocks.allocationFindFirst.mockResolvedValue(allocation);
    mocks.allocationFindMany.mockResolvedValue([
      { id: 'allocation-1', matriculaId: 'matricula-1', netAmount: 100 },
      { id: 'allocation-2', matriculaId: 'matricula-2', netAmount: 80 },
    ]);
    mocks.getPayment.mockResolvedValue({
      id: 'payment-1',
      status: 'PENDING',
      value: 180,
      billingType: 'PIX',
      dueDate: '2026-08-10',
    });
    mocks.updatePayment.mockResolvedValue({ id: 'payment-1', value: 200 });
  });

  it('recalcula a cobrança familiar e confirma o valor remoto antes da projeção local', async () => {
    const response = await PUT(
      new Request('http://localhost/api/matriculas/matricula-1/taxa', {
        method: 'PUT',
        body: JSON.stringify({ value: 120 }),
      }),
      { params: Promise.resolve({ id: 'matricula-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updatePayment).toHaveBeenCalledWith(
      'payment-1',
      { value: 200, billingType: 'PIX', dueDate: '2026-08-10' },
      { contaId: 'conta-1' },
    );
    expect(mocks.allocationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'allocation-1', contaId: 'conta-1' },
        data: expect.objectContaining({ netAmount: 120 }),
      }),
    );
    expect(mocks.matriculaUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['matricula-1', 'matricula-2'] },
        contaId: 'conta-1',
      },
      data: { taxaMatricula: 200 },
    });
  });

  it('não altera taxa já paga', async () => {
    mocks.getPayment.mockResolvedValue({
      id: 'payment-1',
      status: 'RECEIVED',
      value: 180,
      billingType: 'PIX',
      dueDate: '2026-08-10',
    });

    const response = await PUT(
      new Request('http://localhost/api/matriculas/matricula-1/taxa', {
        method: 'PUT',
        body: JSON.stringify({ value: 120 }),
      }),
      { params: Promise.resolve({ id: 'matricula-1' }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: 'TAXA_IMUTAVEL' }) }),
    );
    expect(mocks.updatePayment).not.toHaveBeenCalled();
  });
});
