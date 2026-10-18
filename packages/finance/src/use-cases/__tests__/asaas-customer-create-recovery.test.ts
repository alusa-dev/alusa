import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCustomers = vi.hoisted(() => vi.fn());

vi.mock('@alusa/asaas', () => ({
  listCustomers,
  AsaasHttpError: class AsaasHttpError extends Error {},
}));

import { findCustomerAfterAmbiguousCreate } from '../asaas-customer-create-recovery';

describe('findCustomerAfterAmbiguousCreate', () => {
  beforeEach(() => listCustomers.mockReset());

  it('recupera customer com referência e documento exatos na página seguinte', async () => {
    listCustomers
      .mockResolvedValueOnce({
        offset: 0, limit: 100, totalCount: 101, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `deleted-${index}`, externalReference: 'ref-A', cpfCnpj: '12345678901', deleted: true,
        })),
      })
      .mockResolvedValueOnce({
        offset: 100, limit: 100, totalCount: 101, hasMore: false,
        data: [{ id: 'cus-A', externalReference: 'ref-A', cpfCnpj: '123.456.789-01' }],
      });

    await expect(findCustomerAfterAmbiguousCreate({
      apiKey: 'tenant-key', externalReference: 'ref-A', cpfCnpj: '12345678901',
    })).resolves.toMatchObject({ id: 'cus-A' });
    expect(listCustomers).toHaveBeenNthCalledWith(2, {
      apiKey: 'tenant-key', externalReference: 'ref-A', offset: 100, limit: 100,
    });
  });

  it('falha fechada quando metadados de paginação não correspondem ao pedido', async () => {
    listCustomers.mockResolvedValueOnce({ offset: 100, limit: 100, totalCount: 0, hasMore: false, data: [] });

    await expect(findCustomerAfterAmbiguousCreate({
      apiKey: 'tenant-key', externalReference: 'ref-A', cpfCnpj: '12345678901',
    })).rejects.toThrow('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:INVALID_PAGE');
  });

  it('rejeita identidade divergente e duplicidade', async () => {
    listCustomers.mockResolvedValueOnce({
      offset: 0, limit: 100, totalCount: 2, hasMore: false,
      data: [
        { id: 'cus-1', externalReference: 'ref-A', cpfCnpj: '12345678901' },
        { id: 'cus-2', externalReference: 'ref-A', cpfCnpj: '12345678901' },
      ],
    });
    await expect(findCustomerAfterAmbiguousCreate({
      apiKey: 'tenant-key', externalReference: 'ref-A', cpfCnpj: '12345678901',
    })).rejects.toThrow('Mais de um customer');

    listCustomers.mockResolvedValueOnce({
      offset: 0, limit: 100, totalCount: 1, hasMore: false,
      data: [{ id: 'cus-other', externalReference: 'ref-A', cpfCnpj: '99999999999' }],
    });
    await expect(findCustomerAfterAmbiguousCreate({
      apiKey: 'tenant-key', externalReference: 'ref-A', cpfCnpj: '12345678901',
    })).rejects.toThrow('Mais de um customer');
  });

  it('rejeita uma página final que contradiz totalCount', async () => {
    listCustomers.mockResolvedValueOnce({
      offset: 0, limit: 100, totalCount: 1, hasMore: false, data: [],
    });
    await expect(findCustomerAfterAmbiguousCreate({
      apiKey: 'tenant-key', externalReference: 'ref-A', cpfCnpj: '12345678901',
    })).rejects.toThrow('CUSTOMER_RECOVERY_LOOKUP_INCOMPLETE:TOTAL_COUNT_MISMATCH');
  });
});
