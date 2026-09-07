import { describe, expect, it, vi } from 'vitest';

const customerFindFirst = vi.fn();
const customerFindUnique = vi.fn();
const customerPayerFindMany = vi.fn();
const customerPayerFindUnique = vi.fn();

vi.mock('@alusa/database', () => ({ prisma: {} }));

import { findCustomerForPayer, findSolePayerForCustomer } from './customer-identity';

const db = {
  customer: {
    findFirst: customerFindFirst,
    findUnique: customerFindUnique,
  },
  customerPayer: {
    findMany: customerPayerFindMany,
    findUnique: customerPayerFindUnique,
  },
};

describe('customer financial identity aliases', () => {
  it.each([
    {
      historicalType: 'RESPONSAVEL' as const,
      historicalId: 'responsavel-1',
      aliasType: 'ALUNO' as const,
      aliasId: 'aluno-1',
    },
    {
      historicalType: 'ALUNO' as const,
      historicalId: 'aluno-1',
      aliasType: 'RESPONSAVEL' as const,
      aliasId: 'responsavel-1',
    },
  ])('resolve os dois sentidos de alias sem escolher um proprietário', async (scenario) => {
    customerFindFirst.mockResolvedValueOnce({
      payerType: scenario.historicalType,
      payerId: scenario.historicalId,
    });
    customerPayerFindMany.mockResolvedValueOnce([
      { payerType: scenario.historicalType, payerId: scenario.historicalId },
      { payerType: scenario.aliasType, payerId: scenario.aliasId },
    ]);

    await expect(
      findSolePayerForCustomer('conta-a', 'customer-shared', db as never),
    ).resolves.toBeNull();

    customerPayerFindUnique.mockResolvedValue({
      customer: { id: 'customer-shared', asaasCustomerId: 'cus-shared' },
    });

    await expect(
      findCustomerForPayer('conta-a', scenario.historicalType, scenario.historicalId, db as never),
    ).resolves.toEqual({ id: 'customer-shared', asaasCustomerId: 'cus-shared' });
    await expect(
      findCustomerForPayer('conta-a', scenario.aliasType, scenario.aliasId, db as never),
    ).resolves.toEqual({ id: 'customer-shared', asaasCustomerId: 'cus-shared' });

    expect(customerPayerFindUnique).toHaveBeenCalledWith({
      where: {
        contaId_payerType_payerId: {
          contaId: 'conta-a',
          payerType: scenario.aliasType,
          payerId: scenario.aliasId,
        },
      },
      include: { customer: true },
    });
  });

  it('usa Customer histórico apenas quando há um único papel e mantém o tenant no filtro', async () => {
    customerFindFirst.mockResolvedValueOnce({ payerType: 'ALUNO', payerId: 'aluno-1' });
    customerPayerFindMany.mockResolvedValueOnce([]);

    await expect(
      findSolePayerForCustomer('conta-a', 'customer-legacy', db as never),
    ).resolves.toEqual({ payerType: 'ALUNO', payerId: 'aluno-1' });
    expect(customerFindFirst).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', id: 'customer-legacy' },
      select: { payerType: true, payerId: true },
    });
    expect(customerPayerFindMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-a', customerId: 'customer-legacy' },
      select: { payerType: true, payerId: true },
    });
  });
});
