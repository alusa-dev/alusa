import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, sales, entries } = vi.hoisted(() => {
  const sales: Array<Record<string, unknown>> = [];
  const entries: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: vi.fn(async (_query: TemplateStringsArray, contaId: string, paymentId: string) => sales
      .filter((sale) => sale.contaId === contaId && sale.asaasPaymentId === paymentId && sale.eventMapOrderId === null)
      .map(({ id }) => ({ id }))),
    eventTicketSale: {
      findMany: vi.fn(async ({ where }: { where: { contaId: string; id: { in: string[] }; eventMapOrderId: null } }) => sales
        .filter((sale) => sale.contaId === where.contaId && where.id.in.includes(String(sale.id)) && sale.eventMapOrderId === where.eventMapOrderId)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const sale = sales.find(({ id }) => id === where.id);
        if (sale) Object.assign(sale, data);
        return sale;
      }),
    },
    eventFinancialEntry: {
      updateMany: vi.fn(async ({ where, data }: { where: { contaId: string; originType: string; originId: string }; data: Record<string, unknown> }) => {
        const matchingEntries = entries.filter((entry) => entry.contaId === where.contaId &&
          entry.originType === where.originType && entry.originId === where.originId);
        matchingEntries.forEach((entry) => Object.assign(entry, data));
        return { count: matchingEntries.length };
      }),
    },
  };
  return { tx, sales, entries };
});

vi.mock('@alusa/database', () => ({
  prisma: { $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) },
}));

vi.mock('@alusa/lib/events/map/event-map-order-operations', () => ({
  decimal: (value: number) => value,
  releaseSeatsForTicketSale: vi.fn(async () => {}),
  syncPublicLotQuantity: vi.fn(async () => {}),
  toMoney: (value: number | string | null | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
  },
}));

import { refundEventTicketSalesByPayment } from './refund-event-ticket-sales-by-payment';

function makeSale(id: string, totalAmount: number) {
  return { id, contaId: 'tenant-a', asaasPaymentId: 'payment-a', eventMapOrderId: null, status: 'PAID', totalAmount, refundedAmount: 0, lotId: `lot-${id}` };
}

function makeEntry(contaId: string, saleId: string) {
  return { id: `entry-${saleId}`, contaId, originType: 'TICKET_SALE', originId: saleId, status: 'RECEIVED', refundedAmount: 0, netAmount: 100, paymentStatus: 'RECEIVED' };
}

describe('refundEventTicketSalesByPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sales.splice(0, sales.length, makeSale('sale-a', 100), makeSale('sale-b', 50));
    entries.splice(0, entries.length, makeEntry('tenant-a', 'sale-a'), makeEntry('tenant-a', 'sale-b'));
  });

  it('does not mutate another tenant sale or financial entry with the same payment ID', async () => {
    const tenantBSale = { ...makeSale('sale-tenant-b', 75), contaId: 'tenant-b' };
    const tenantBEntry = makeEntry('tenant-b', 'sale-tenant-b');
    sales.push(tenantBSale);
    entries.push(tenantBEntry);

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 30,
    });

    expect(tenantBSale).toMatchObject({ status: 'PAID', refundedAmount: 0 });
    expect(tenantBEntry).toMatchObject({ status: 'RECEIVED', refundedAmount: 0, netAmount: 100, paymentStatus: 'RECEIVED' });
    expect(tx.$queryRaw.mock.calls[0]?.[1]).toBe('tenant-a');
    expect(tx.eventTicketSale.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'tenant-a' }),
    }));
  });

  it('preserves an existing refund or chargeback hold on a standalone sale', async () => {
    sales[0]!.paymentStatus = 'CHARGEBACK_DISPUTE';
    entries[0]!.paymentStatus = 'CHARGEBACK_DISPUTE';

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED',
      isFinalRefund: false, refundedAmount: 30,
    });

    expect(sales[0]).toMatchObject({ status: 'PAID', paymentStatus: 'CHARGEBACK_DISPUTE', refundedAmount: 30 });
    expect(entries[0]).toMatchObject({ status: 'PARTIALLY_REFUNDED', paymentStatus: 'CHARGEBACK_DISPUTE', refundedAmount: 30 });
  });

  it('persists a cumulative partial refund idempotently when the same webhook repeats', async () => {
    const params = { contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 30 };

    await refundEventTicketSalesByPayment(params);
    await refundEventTicketSalesByPayment(params);

    expect(sales.map(({ refundedAmount }) => refundedAmount)).toEqual([30, 0]);
    expect(sales.map(({ status }) => status)).toEqual(['PAID', 'PAID']);
    expect(tx.eventFinancialEntry.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', originType: 'TICKET_SALE', originId: 'sale-b' },
      data: expect.objectContaining({ refundedAmount: 0, netAmount: 50, paymentStatus: 'PARTIALLY_REFUNDED' }),
    }));
  });

  it('allocates the cumulative total across sales when a later partial refund completes', async () => {
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 30 });
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 120 });

    expect(sales.map(({ refundedAmount }) => refundedAmount)).toEqual([100, 20]);
    expect(tx.eventFinancialEntry.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', originType: 'TICKET_SALE', originId: 'sale-b' },
      data: expect.objectContaining({ refundedAmount: 20, netAmount: 30, status: 'PARTIALLY_REFUNDED' }),
    }));
  });

  it('preserves the persisted distribution and applies only a positive cumulative increment', async () => {
    sales[0]!.refundedAmount = 20;
    sales[1]!.refundedAmount = 30;

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED',
      isFinalRefund: false, refundedAmount: 60,
    });

    expect(sales.map(({ refundedAmount }) => refundedAmount)).toEqual([30, 30]);
    expect(sales.reduce((sum, { refundedAmount }) => sum + Number(refundedAmount), 0)).toBe(60);

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED',
      isFinalRefund: false, refundedAmount: 60,
    });
    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED',
      isFinalRefund: false, refundedAmount: 55,
    });

    expect(sales.map(({ refundedAmount }) => refundedAmount)).toEqual([30, 30]);
  });

  it('preserves a legacy row above gross and emits a warning instead of silently rewriting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sales[0]!.refundedAmount = 120;

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED',
      isFinalRefund: false, refundedAmount: 150,
    });

    expect(sales[0]!.refundedAmount).toBe(120);
    expect(warn.mock.calls.flat().join(' ')).toContain('finance.events.ticket_sale.refund_amount_over_gross');
    warn.mockRestore();
  });

  it('converges from a cumulative partial refund to final refund monotonically', async () => {
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 120 });
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'REFUNDED', isFinalRefund: true });
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false, refundedAmount: 120 });

    expect(sales.map(({ refundedAmount, status }) => ({ refundedAmount, status }))).toEqual([
      { refundedAmount: 100, status: 'REFUNDED' },
      { refundedAmount: 50, status: 'REFUNDED' },
    ]);
    expect(tx.eventFinancialEntry.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED', refundedAmount: 50, netAmount: 0 }),
    }));
  });

  it('does not invent a refund amount when a partial webhook has no refund details', async () => {
    await refundEventTicketSalesByPayment({ contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PARTIALLY_REFUNDED', isFinalRefund: false });

    expect(sales.map(({ refundedAmount }) => refundedAmount)).toEqual([0, 0]);
    expect(tx.eventFinancialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'PARTIALLY_REFUNDED' },
    }));
  });

  it('replaces refund-in-progress with the final refunded status on sale and ledger entry', async () => {
    sales[0]!.paymentStatus = 'REFUND_IN_PROGRESS';
    entries[0]!.paymentStatus = 'REFUND_IN_PROGRESS';

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PAYMENT_REFUNDED',
      isFinalRefund: true,
    });

    expect(sales[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100 });
    expect(entries[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100, netAmount: 0 });
  });

  it('replaces refund-in-progress with an explicit denied status without refunding the sale', async () => {
    sales[0]!.paymentStatus = 'REFUND_IN_PROGRESS';
    entries[0]!.paymentStatus = 'REFUND_IN_PROGRESS';

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'REFUND_DENIED',
      isFinalRefund: false,
    });

    expect(sales[0]).toMatchObject({ status: 'PAID', paymentStatus: 'REFUND_DENIED', refundedAmount: 0 });
    expect(entries[0]).toMatchObject({ status: 'RECEIVED', paymentStatus: 'REFUND_DENIED', refundedAmount: 0, netAmount: 100 });
  });

  it('preserves a completed refund when a delayed refund-denied webhook arrives', async () => {
    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PAYMENT_REFUNDED',
      isFinalRefund: true,
    });

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'REFUND_DENIED',
      isFinalRefund: false,
    });

    expect(sales[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100 });
    expect(entries[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100, netAmount: 0 });
  });

  it('repairs a legacy refunded sale whose payment status remained in progress', async () => {
    sales[0]!.status = 'REFUNDED';
    sales[0]!.paymentStatus = 'REFUND_IN_PROGRESS';
    sales[0]!.refundedAmount = 100;
    entries[0]!.status = 'REFUNDED';
    entries[0]!.paymentStatus = 'REFUND_IN_PROGRESS';
    entries[0]!.refundedAmount = 100;
    entries[0]!.netAmount = 0;

    await refundEventTicketSalesByPayment({
      contaId: 'tenant-a', paymentId: 'payment-a', paymentStatus: 'PAYMENT_REFUNDED',
      isFinalRefund: true,
    });

    expect(sales[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100 });
    expect(entries[0]).toMatchObject({ status: 'REFUNDED', paymentStatus: 'PAYMENT_REFUNDED', refundedAmount: 100, netAmount: 0 });
  });
});
