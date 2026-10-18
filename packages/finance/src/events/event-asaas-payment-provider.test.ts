import { describe, expect, it, vi } from 'vitest';

import {
  listCompleteEventCustomersByDocument,
  listCompleteEventPaymentsByReference,
  registerEventAsaasPaymentProvider,
  selectUniqueActiveEventPayment,
} from './event-asaas-payment-provider';

const externalReference = 'event-map-order:order-1';
const buyerDocument = '12345678901';

function page(input: { offset: number; hasMore: boolean; data: Array<{ id: string; externalReference: string; deleted?: boolean }>; totalCount?: number }) {
  const data = input.hasMore
    ? [...input.data, ...Array.from({ length: Math.max(0, 100 - input.data.length) }, (_, index) => ({
        id: `pay-page-${input.offset}-${index}`,
        externalReference: input.data[0]?.externalReference ?? externalReference,
        deleted: true,
      }))]
    : input.data;
  return { ...input, data, limit: 100, totalCount: input.totalCount ?? (input.hasMore ? Math.max(101, input.offset + data.length + 1) : input.offset + data.length) };
}
function customersPage(input: { offset: number; hasMore: boolean; data: Array<{ id: string; cpfCnpj?: string }> }) {
  const data = input.hasMore
    ? [...input.data, ...Array.from({ length: Math.max(0, 100 - input.data.length) }, (_, index) => ({
        id: `cus-page-${input.offset}-${index}`,
        cpfCnpj: '99999999999',
      }))]
    : input.data;
  return { ...input, data, limit: 100, totalCount: input.hasMore ? 101 : input.offset + data.length };
}

describe('listCompleteEventPaymentsByReference', () => {
  it('continua até a página seguinte e preserva offset/limit/hasMore', async () => {
    const listPayments = vi.fn()
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: Array.from({ length: 100 }, (_, index) => ({
        id: `pay-${index}`, externalReference,
      })) }))
      .mockResolvedValueOnce(page({ offset: 100, hasMore: false, data: [{ id: 'pay-later', externalReference }] }));
    registerEventAsaasPaymentProvider({ listPayments } as never);

    const result = await listCompleteEventPaymentsByReference({ apiKey: 'tenant-key', externalReference });

    expect(result).toHaveLength(101);
    expect(result.at(-1)?.id).toBe('pay-later');
    expect(listPayments.mock.calls).toEqual([
      [{ apiKey: 'tenant-key', externalReference, offset: 0, limit: 100 }],
      [{ apiKey: 'tenant-key', externalReference, offset: 100, limit: 100 }],
    ]);
  });

  it('falha fechada quando a paginação ainda tem páginas após atingir o teto seguro', async () => {
    const listPayments = vi.fn(async ({ offset }: { offset: number }) => page({
      offset,
      hasMore: true,
      totalCount: 10001,
      data: Array.from({ length: 100 }, (_, index) => ({ id: `pay-${offset}-${index}`, externalReference, deleted: index > 0 })),
    }));
    registerEventAsaasPaymentProvider({ listPayments } as never);

    await expect(listCompleteEventPaymentsByReference({ apiKey: 'tenant-key', externalReference }))
      .rejects.toThrow('PAGE_LIMIT_EXCEEDED');
    expect(listPayments).toHaveBeenCalledTimes(100);
    expect(listPayments).toHaveBeenLastCalledWith({ apiKey: 'tenant-key', externalReference, offset: 9900, limit: 100 });
  });

  it('não aceita match parcial quando uma página posterior falha', async () => {
    const listPayments = vi.fn()
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: [
        { id: 'pay-first', externalReference },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `pay-deleted-${index}`, externalReference, deleted: true })),
      ] }))
      .mockRejectedValueOnce(new Error('temporary provider failure'));
    registerEventAsaasPaymentProvider({ listPayments } as never);

    await expect(listCompleteEventPaymentsByReference({ apiKey: 'tenant-key', externalReference }))
      .rejects.toThrow('LOOKUP_INCOMPLETE');
    expect(listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });

  it('rejeita duplicatas ativas encontradas em páginas diferentes', async () => {
    const listPayments = vi.fn()
      .mockResolvedValueOnce(page({ offset: 0, hasMore: true, data: [
        { id: 'pay-first', externalReference },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `pay-deleted-${index}`, externalReference, deleted: true })),
      ] }))
      .mockResolvedValueOnce(page({ offset: 100, hasMore: false, data: [{ id: 'pay-later', externalReference }] }));
    registerEventAsaasPaymentProvider({ listPayments } as never);
    const candidates = await listCompleteEventPaymentsByReference({ apiKey: 'tenant-key', externalReference });

    expect(() => selectUniqueActiveEventPayment(candidates))
      .toThrow('MULTIPLE_ACTIVE_PAYMENTS');
    expect(listPayments.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });
});

describe('listCompleteEventCustomersByDocument', () => {
  it('encontra customer exato na segunda página', async () => {
    const listCustomers = vi.fn()
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: true, data: Array.from({ length: 100 }, (_, index) => ({
        id: `cus-${index}`, cpfCnpj: `99999999${String(index).padStart(3, '0')}`,
      })) }))
      .mockResolvedValueOnce(customersPage({ offset: 100, hasMore: false, data: [{ id: 'cus-buyer', cpfCnpj: buyerDocument }] }));
    registerEventAsaasPaymentProvider({ listCustomers } as never);

    const result = await listCompleteEventCustomersByDocument({ apiKey: 'tenant-key', cpfCnpj: buyerDocument });

    expect(result).toEqual([{ id: 'cus-buyer', cpfCnpj: buyerDocument }]);
    expect(listCustomers.mock.calls).toEqual([
      [{ apiKey: 'tenant-key', cpfCnpj: buyerDocument, offset: 0, limit: 100 }],
      [{ apiKey: 'tenant-key', cpfCnpj: buyerDocument, offset: 100, limit: 100 }],
    ]);
  });

  it('retorna todos os customers correspondentes para detectar duplicidade na segunda página', async () => {
    const listCustomers = vi.fn()
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: true, data: [
        { id: 'cus-first', cpfCnpj: buyerDocument },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `cus-other-${index}`, cpfCnpj: '99999999999' })),
      ] }))
      .mockResolvedValueOnce(customersPage({ offset: 100, hasMore: false, data: [{ id: 'cus-second', cpfCnpj: buyerDocument }] }));
    registerEventAsaasPaymentProvider({ listCustomers } as never);

    const result = await listCompleteEventCustomersByDocument({ apiKey: 'tenant-key', cpfCnpj: buyerDocument });

    expect(result.map((customer) => customer.id)).toEqual(['cus-first', 'cus-second']);
    expect(listCustomers.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });

  it('não retorna match parcial se a página seguinte falhar', async () => {
    const listCustomers = vi.fn()
      .mockResolvedValueOnce(customersPage({ offset: 0, hasMore: true, data: [
        { id: 'cus-first', cpfCnpj: buyerDocument },
        ...Array.from({ length: 99 }, (_, index) => ({ id: `cus-other-${index}`, cpfCnpj: '99999999999' })),
      ] }))
      .mockRejectedValueOnce(new Error('temporary provider failure'));
    registerEventAsaasPaymentProvider({ listCustomers } as never);

    await expect(listCompleteEventCustomersByDocument({ apiKey: 'tenant-key', cpfCnpj: buyerDocument }))
      .rejects.toThrow('EVENT_CUSTOMER_LOOKUP_INCOMPLETE');
    expect(listCustomers.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });
});
