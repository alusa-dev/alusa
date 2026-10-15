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
              lines: { data: [{ pricing: { price_details: { price: 'price_premium_test' } } }] },
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

  it('segue todas as páginas de invoices pagas', async () => {
    const client = {
      invoices: {
        list: vi.fn()
          .mockResolvedValueOnce({
            data: [{ id: 'in_page_1', customer: 'cus_test_1', amount_paid: 1, amount_due: 1, status: 'paid', created: 1, lines: { data: [] } }],
            has_more: true,
          })
          .mockResolvedValueOnce({
            data: [{ id: 'in_page_2', customer: 'cus_test_1', amount_paid: 2, amount_due: 2, status: 'paid', created: 2, lines: { data: [] } }],
            has_more: false,
          }),
      },
    };

    const invoices = await listStripePaidInvoices(client as never, 'cus_test_1');
    expect(invoices.map((invoice) => invoice.id)).toEqual(['in_page_1', 'in_page_2']);
    expect(client.invoices.list).toHaveBeenNthCalledWith(2, {
      customer: 'cus_test_1', status: 'paid', limit: 100, starting_after: 'in_page_1',
    });
  });

  it('ignora proration em formatos moderno e legado ao reconciliar preço de invoice', async () => {
    const client = {
      invoices: {
        list: vi.fn(async () => ({
          data: [
            {
              id: 'in_mixed', customer: 'cus_test_1', amount_paid: 100, amount_due: 100, status: 'paid', created: 1,
              lines: { data: [
                { price: { id: 'price_old_proration' }, proration: true },
                { price: { id: 'price_current' }, subscription_item_details: { proration: false } },
                { pricing: { price_details: { price: 'price_modern_proration' } }, parent: { subscription_item_details: { proration: true } } },
              ] },
            },
            {
              id: 'in_proration_only', customer: 'cus_test_1', amount_paid: 100, amount_due: 100, status: 'paid', created: 2,
              lines: { data: [
                { price: { id: 'price_legacy_proration' }, subscription_item_details: { proration: true } },
              ] },
            },
          ],
          has_more: false,
        })),
      },
    };

    const invoices = await listStripePaidInvoices(client as never, 'cus_test_1');
    expect(invoices.find((invoice) => invoice.id === 'in_mixed')?.priceId).toBe('price_current');
    expect(invoices.find((invoice) => invoice.id === 'in_proration_only')?.priceId).toBeNull();
  });
});
