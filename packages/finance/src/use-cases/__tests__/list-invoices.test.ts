import { describe, expect, it, vi, beforeEach } from 'vitest';

import { listInvoices } from '../list-invoices';

const prismaMock = vi.hoisted(() => ({
  invoice: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({ getFiscalPrisma: () => prismaMock }));

describe('listInvoices', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lista invoices paginadas', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.invoice.findMany).mockResolvedValueOnce([
      {
        id: 'i1',
        chargeId: 'c1',
        externalReference: 'invoice:i1',
        asaasInvoiceId: 'inv_1',
        status: 'SCHEDULED',
        statusUpdatedAt: new Date('2026-01-04T00:00:00.000Z'),
        number: null,
        pdfUrl: null,
        xmlUrl: null,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
      },
    ] as never);

    vi.mocked(prisma.invoice.count).mockResolvedValueOnce(1 as never);

    const result = await listInvoices({ contaId: 't1', limit: 50, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe('i1');
  });
});
