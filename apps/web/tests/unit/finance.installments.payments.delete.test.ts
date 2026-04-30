/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    installmentPlan: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    standaloneInstallmentPlan: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    charge: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    cobranca: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  },
}));

vi.mock('@alusa/finance', () => {
  class KycNotApprovedError extends Error {}

  return {
    KycNotApprovedError,
    getInstallment: vi.fn(),
    cancelInstallmentPayments: vi.fn(),
  };
});

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { cancelInstallmentPayments, getInstallment } from '@alusa/finance';
import { DELETE } from '@/app/api/finance/installments/[id]/payments/route';

describe('DELETE /api/finance/installments/[id]/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(prisma.installmentPlan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.standaloneInstallmentPlan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.charge.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('cancela no endpoint oficial do Asaas e converge cobranças acadêmicas atrasadas', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
      id: 'plan-1',
      asaasInstallmentId: 'inst_asaas_1',
      status: 'ACTIVE',
      externalReference: 'installment:plan-1',
    } as never);

    vi.mocked(getInstallment).mockResolvedValueOnce({
      id: 'inst_asaas_1',
      deleted: false,
    } as never);

    vi.mocked(cancelInstallmentPayments).mockResolvedValueOnce({
      id: 'inst_asaas_1',
      deleted: true,
      deletedPayments: [
        { id: 'pay-1', installmentNumber: 2, deleted: true },
      ],
    } as never);

    vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([
      { id: 'charge-1', cobrancaId: 'cobranca-1' },
    ] as never);

    const response = await DELETE(new NextRequest('http://localhost/api/finance/installments/plan-1/payments'), {
      params: { id: 'plan-1' },
    });

    expect(response.status).toBe(200);
    expect(getInstallment).toHaveBeenCalledWith('inst_asaas_1', { contaId: 'conta-1' });
    expect(cancelInstallmentPayments).toHaveBeenCalledWith('inst_asaas_1', { contaId: 'conta-1' });
    expect(prisma.cobranca.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cobranca-1'] },
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: { status: 'CANCELADO' },
    });

    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      message: 'Cobranças pendentes e vencidas do parcelamento canceladas com sucesso.',
      data: {
        id: 'inst_asaas_1',
        deletedPayments: [
          { id: 'pay-1', installmentNumber: 2, deleted: true },
        ],
      },
    });
  });
});