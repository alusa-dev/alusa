import { describe, expect, it, vi } from 'vitest';
import { listStripePaidInvoices } from '../src';

describe('@alusa/stripe invoice reconciliation operations', () => {
  it('lista apenas invoices pagas com valor efetivamente recebido', async () => {
    const client = {
      invoices: {
        list: vi.fn(async () => ({
          data: [
            {
              id: 'in_paid',
              customer: 'cus_test_1',
              subscription: null,
              status: 'paid',
              amount_due: 27900,
              amount_paid: 27900,
              currency: 'brl',
              created: 1_777_000_000,
              status_transitions: { paid_at: 1_777_000_100 },
              lines: { data: [{ price: { id: 'price_premium_test' } }] },
            },
            {
              id: 'in_zero',
              customer: 'cus_test_1',
              subscription: null,
              status: 'paid',
              amount_due: 0,
              amount_paid: 0,
              currency: 'brl',
              created: 1_776_000_000,
              status_transitions: { paid_at: 1_776_000_100 },
              lines: { data: [] },
            },
          ],
        })),
      },
    };

    await expect(listStripePaidInvoices(client as never, 'cus_test_1')).resolves.toMatchObject([
      {
        id: 'in_paid',
        customerId: 'cus_test_1',
        amountPaid: 27900,
        priceId: 'price_premium_test',
        paidAt: new Date(1_777_000_100 * 1000),
      },
    ]);
    expect(client.invoices.list).toHaveBeenCalledWith({ customer: 'cus_test_1', status: 'paid', limit: 100 });
  });
});
