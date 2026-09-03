import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contaCount: vi.fn(),
    platformBillingAccountCount: vi.fn(),
  platformBillingInvoiceAggregate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    conta: { count: mocks.contaCount },
    platformBillingAccount: { count: mocks.platformBillingAccountCount },
    platformBillingInvoice: { aggregate: mocks.platformBillingInvoiceAggregate },
  },
}));

import { getSupportOverview } from '@/features/support/queries/support-dashboard';

describe('getSupportOverview', () => {
  it('returns platform health KPIs instead of school operational metrics', async () => {
    mocks.contaCount.mockImplementation((args: { where: { status: string } }) => Promise.resolve(args.where.status === 'ATIVO' ? 12 : 3));
    mocks.platformBillingAccountCount.mockImplementation((args: { where: { status?: string } }) => Promise.resolve(args.where.status ? 2 : 1));
    mocks.platformBillingInvoiceAggregate.mockResolvedValue({ _sum: { amountPaid: 14900 } });

    const overview = await getSupportOverview();

    expect(overview).toEqual({
      contasAtivas: 12,
      contasInativas: 3,
      assinaturasEmAtraso: 2,
      cancelamentosNoMes: 1,
      receitaMensalCents: 14900,
    });
    expect(mocks.platformBillingAccountCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ environment: 'LIVE', status: { in: ['PAST_DUE', 'UNPAID'] } }),
    }));
    expect(mocks.platformBillingInvoiceAggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ environment: 'LIVE', status: 'PAID', currency: { in: ['brl', 'BRL'] } }),
    }));
  });
});
