import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getApiKeyForConta: vi.fn(),
  logIntegration: vi.fn(),
  listCustomers: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerWithOutboundOperation: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  createCustomer: mocks.createCustomer,
  listCustomers: mocks.listCustomers,
  deleteSubscription: vi.fn(),
  createSubscription: vi.fn(),
  createPayment: vi.fn(),
  listSubscriptionPayments: vi.fn(),
}));

vi.mock('../use-cases/create-customer', () => ({
  createCustomerWithOutboundOperation: mocks.createCustomerWithOutboundOperation,
}));

import { AsaasPaymentsProviderAdapter } from './AsaasPaymentsProviderAdapter';

const payer = {
  type: 'RESPONSAVEL' as const,
  id: 'responsavel-1',
  name: 'Responsável',
  cpfCnpj: '11144477735',
};

describe('AsaasPaymentsProviderAdapter customer identity pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeyForConta.mockResolvedValue('tenant-api-key');
    mocks.logIntegration.mockResolvedValue(undefined);
    mocks.createCustomerWithOutboundOperation.mockReset();
  });

  it('falha em reconciliação quando a paginação completa encontra customer removido exato', async () => {
    mocks.listCustomers
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({ id: `cus-deleted-${index}`, externalReference: 'payer-ref', cpfCnpj: '11144477735', deleted: true })),
      })
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 100, limit: 100, hasMore: false,
        data: [{ id: 'cus-match', externalReference: 'payer-ref', cpfCnpj: '111.444.777-35', deleted: false }],
      });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');

    expect(mocks.listCustomers.mock.calls).toEqual([
      [{ apiKey: 'tenant-api-key', externalReference: 'payer-ref', offset: 0, limit: 100 }],
      [{ apiKey: 'tenant-api-key', externalReference: 'payer-ref', offset: 100, limit: 100 }],
    ]);
    expect(mocks.createCustomerWithOutboundOperation).not.toHaveBeenCalled();
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('bloqueia CPF duplicado que aparece na página posterior', async () => {
    mocks.listCustomers
      .mockResolvedValueOnce({
        object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [],
      })
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({ id: `cus-other-${index}`, cpfCnpj: `99999999${String(index).padStart(3, '0')}` })),
      })
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 100, limit: 100, hasMore: false,
        data: [{ id: 'cus-duplicate', cpfCnpj: '111.444.777-35', deleted: false }],
      });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).resolves.toEqual({ customerId: 'cus-duplicate', created: false });

    expect(mocks.listCustomers.mock.calls[2]).toEqual([
      { apiKey: 'tenant-api-key', cpfCnpj: '11144477735', offset: 100, limit: 100 },
    ]);
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('rejeita resposta de lookup com offset inconsistente', async () => {
    mocks.listCustomers.mockResolvedValueOnce({
      object: 'list', totalCount: 0, offset: 1, limit: 100, hasMore: false, data: [],
    });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_LOOKUP_INCOMPLETE:INVALID_PAGE');
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('rejeita CPF/CNPJ inválido antes de consultar credenciais ou customers', async () => {
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer: { ...payer, cpfCnpj: '00000000000' }, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_INVALID_CPF_CNPJ');
    expect(mocks.getApiKeyForConta).not.toHaveBeenCalled();
    expect(mocks.listCustomers).not.toHaveBeenCalled();
    expect(mocks.createCustomerWithOutboundOperation).not.toHaveBeenCalled();
  });

  it('não cria duplicata para customer removido com identidade exata', async () => {
    mocks.listCustomers.mockResolvedValueOnce({
      object: 'list', totalCount: 1, offset: 0, limit: 100, hasMore: false,
      data: [{ id: 'cus-deleted', externalReference: 'payer-ref', cpfCnpj: '11144477735', deleted: true }],
    });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');
    expect(mocks.createCustomerWithOutboundOperation).not.toHaveBeenCalled();
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('delega criação e timeout incerto ao protocolo durável e não faz POST direto', async () => {
    mocks.listCustomers
      .mockResolvedValueOnce({ object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [] })
      .mockResolvedValueOnce({ object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [] });
    mocks.createCustomerWithOutboundOperation.mockResolvedValueOnce({
      ok: false, disposition: 'UNKNOWN', message: 'Resultado do POST incerto; reconciliação necessária.',
    });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_CREATE_UNKNOWN');
    expect(mocks.createCustomerWithOutboundOperation).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-A', apiKey: 'tenant-api-key',
      payerIdentity: { type: 'RESPONSAVEL', id: 'responsavel-1' },
      data: expect.objectContaining({ externalReference: 'payer-ref', cpfCnpj: '11144477735' }),
    }));
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it('bloqueia a cobrança quando a confirmação durável retorna customer removido', async () => {
    mocks.listCustomers
      .mockResolvedValueOnce({ object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [] })
      .mockResolvedValueOnce({ object: 'list', totalCount: 0, offset: 0, limit: 100, hasMore: false, data: [] });
    mocks.createCustomerWithOutboundOperation.mockResolvedValueOnce({
      ok: true,
      reused: true,
      customer: {
        id: 'cus-deleted-after-initial-lookup',
        externalReference: 'payer-ref',
        cpfCnpj: '11144477735',
        deleted: true,
      },
    });
    const adapter = new AsaasPaymentsProviderAdapter({
      getApiKeyForConta: mocks.getApiKeyForConta,
      logIntegration: mocks.logIntegration,
    });

    await expect(adapter.resolveOrCreateCustomerForPayer({
      contaId: 'conta-A', payer, externalReference: 'payer-ref',
    })).rejects.toThrow('ASAAS_CUSTOMER_DELETED_REQUIRES_RECONCILIATION');
    expect(mocks.logIntegration).not.toHaveBeenCalled();
  });
});
