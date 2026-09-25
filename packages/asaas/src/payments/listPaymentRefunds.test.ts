import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, constructorMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock('../client/AsaasHttp', () => ({
  AsaasHttp: constructorMock,
}));

import { listPaymentRefunds } from './listPaymentRefunds';

describe('listPaymentRefunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorMock.mockImplementation(() => ({ get: getMock }));
  });

  it('percorre todas as páginas com o maior lote permitido', async () => {
    getMock
      .mockResolvedValueOnce({ data: [{ status: 'PENDING', value: 10 }], hasMore: true })
      .mockResolvedValueOnce({ data: [{ status: 'DONE', value: 20 }], hasMore: false });

    const result = await listPaymentRefunds({ apiKey: 'test-key', paymentId: 'pay-1' });

    expect(result.data).toHaveLength(2);
    expect(constructorMock).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(getMock.mock.calls).toEqual([
      ['/payments/pay-1/refunds', { params: { limit: 100, offset: 0 } }],
      ['/payments/pay-1/refunds', { params: { limit: 100, offset: 100 } }],
    ]);
  });

  it('falha de forma visível se o provedor diz que há mais dados, mas devolve página vazia', async () => {
    getMock.mockResolvedValue({ data: [], hasMore: true });

    await expect(listPaymentRefunds({ apiKey: 'test-key', paymentId: 'pay-1' }))
      .rejects.toThrow('Asaas refunds pagination reported more records without returning any.');
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('impõe um limite ao número de páginas para proteger quota e tempo de execução', async () => {
    getMock.mockResolvedValue({ data: [{ status: 'PENDING', value: 1 }], hasMore: true });

    await expect(listPaymentRefunds({ apiKey: 'test-key', paymentId: 'pay-1' }))
      .rejects.toThrow('Asaas refunds pagination exceeded the safety cap of 10 pages.');
    expect(getMock).toHaveBeenCalledTimes(10);
  });
});
