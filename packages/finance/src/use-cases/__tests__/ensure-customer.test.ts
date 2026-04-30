import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureCustomer } from '../ensure-customer';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      customer: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
      },
      aluno: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      responsavel: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      asaasNotificationPreference: {
        findMany: vi.fn(async () => []),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getCustomer: vi.fn(),
}));

vi.mock('../create-customer', () => ({
  createAsaasCustomer: vi.fn(async () => ({
    success: true,
    data: { id: 'cust_1', externalReference: 'customer:x' },
  })),
  syncAsaasCustomerContact: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(async () => ({ id: 'fp1' })),
  },
}));

describe('ensureCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PAYMENTS_PROVIDER_MODE', 'asaas');
    vi.stubEnv('PLAYWRIGHT_TEST', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('deve bloquear quando payer é ALUNO', async () => {
    const { prisma } = await import('@alusa/database');

    vi.mocked(prisma.customer.upsert).mockResolvedValueOnce({
      id: 'custRow_1',
      asaasCustomerId: null,
      externalReference: 'financeProfile:fp1',
    } as never);

    const result = await ensureCustomer({ contaId: 't1', payer: { type: 'ALUNO', id: 'a1' } });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('PAGADOR_NAO_ENCONTRADO');
  });

  it('deve retornar customer existente e ativo para responsavel', async () => {
    const { prisma } = await import('@alusa/database');
    const { loadAsaasCredentials } = await import('@alusa/database');
    const { getCustomer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({
      apiKey: 'sandbox_x',
      contaId: 't1',
    } as never);

    vi.mocked(prisma.customer.upsert).mockResolvedValueOnce({
      id: 'custRow_r1',
      asaasCustomerId: 'cust_exist',
      externalReference: 'financeProfile:fp1',
    } as never);

    vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
      id: 'r1',
      nome: 'Resp',
      cpf: '123',
      email: 'x@x.com',
      telefone: '11999999999',
      asaasCustomerId: 'cust_exist',
    } as never);

    vi.mocked(getCustomer).mockResolvedValueOnce({ id: 'cust_exist', deleted: false } as never);

    const result = await ensureCustomer({
      contaId: 't1',
      payer: { type: 'RESPONSAVEL', id: 'r1' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerId).toBe('cust_exist');
      expect(result.data.externalReference).toBe('financeProfile:fp1');
    }
  });

  it('deve recriar customer quando responsavel está deletado no Asaas', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { createAsaasCustomer } = await import('../create-customer');
    const { getCustomer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({
      apiKey: 'sandbox_x',
      contaId: 't1',
    } as never);

    vi.mocked(prisma.customer.upsert).mockResolvedValueOnce({
      id: 'custRow_r1',
      asaasCustomerId: 'cust_deleted',
      externalReference: 'financeProfile:fp1',
    } as never);
    vi.mocked(prisma.customer.update).mockResolvedValue({} as never);

    vi.mocked(prisma.responsavel.findFirst).mockResolvedValueOnce({
      id: 'r1',
      nome: 'Resp',
      cpf: '123',
      email: 'x@x.com',
      telefone: '11999999999',
      asaasCustomerId: 'cust_deleted',
    } as never);

    vi.mocked(getCustomer)
      .mockResolvedValueOnce({ id: 'cust_deleted', deleted: true } as never)
      .mockResolvedValueOnce({ id: 'cust_deleted', deleted: true } as never);

    const result = await ensureCustomer({
      contaId: 't1',
      payer: { type: 'RESPONSAVEL', id: 'r1' },
    });

    expect(result.success).toBe(true);
    expect(createAsaasCustomer).toHaveBeenCalledWith({
      contaId: 't1',
      name: 'Resp',
      cpfCnpj: '123',
      email: 'x@x.com',
      phone: '11999999999',
      externalReference: 'financeProfile:fp1',
    });

    expect(prisma.responsavel.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { asaasCustomerId: 'cust_1' },
    });

    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: {
        contaId_payerType_payerId: {
          contaId: 't1',
          payerType: 'RESPONSAVEL',
          payerId: 'r1',
        },
      },
      data: { asaasCustomerId: 'cust_1' },
    });
  });
});
